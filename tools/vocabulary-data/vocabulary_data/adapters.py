"""Source adapters: each turns one source's raw records into the same shape.

A frequency source becomes a `FrequencySource`: normalised form -> rank (1 =
most frequent), an optional source-native value (wordfreq's Zipf), and every
surface spelling observed. Ranks from different sources are never added
together here; ranking.py decides how they are compared.
"""

from __future__ import annotations

import bisect
import math
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from .normalization import capitalization_pattern, normalize_form


@dataclass
class SourceEntry:
    rank: int
    value: float | None
    surfaces: list[str]
    # Proportion of tokens, for sources that provide it (wordfreq); lets forms of one lemma be summed.
    frequency: float | None = None


@dataclass
class FrequencySource:
    source_id: str
    entries: dict[str, SourceEntry]
    order: list[str]
    # Ranks are only known down to this list's length; absent words are "rarer than the cut-off".
    list_length: int
    value_name: str | None = None
    stats: dict[str, int] = field(default_factory=dict)
    _ascending: list[float] | None = field(default=None, repr=False)
    _has_frequencies: bool | None = field(default=None, repr=False)

    def top(self, count: int) -> list[str]:
        return self.order[:count]

    @property
    def has_frequencies(self) -> bool:
        # Computed once: it is asked for every lemma with folded forms (thousands of times per run).
        if self._has_frequencies is None:
            self._has_frequencies = bool(self.entries) and all(entry.frequency is not None for entry in self.entries.values())
        return self._has_frequencies

    def rank_for_frequency(self, frequency: float) -> int:
        """The rank a word with this frequency would have in this source (1 + number of words more frequent)."""
        if self._ascending is None:
            self._ascending = sorted(entry.frequency for entry in self.entries.values() if entry.frequency is not None)
        return len(self._ascending) - bisect.bisect_right(self._ascending, frequency) + 1


def read_lines(path: Path) -> list[str]:
    # Files are read as UTF-8 and split on line breaks only; nothing is stripped beyond the line ending.
    return path.read_text(encoding="utf-8").splitlines()


def rank_list(source_id: str, lines: Iterable[str]) -> FrequencySource:
    """A list ordered from most to least frequent, one token per line (e.g. the Google Books lists)."""
    entries: dict[str, SourceEntry] = {}
    order: list[str] = []
    stats = {"raw_records": 0, "invalid_records": 0, "duplicate_records": 0}
    for line in lines:
        stats["raw_records"] += 1
        surface = line.strip()
        normalized = normalize_form(surface) if surface else None
        if normalized is None:
            stats["invalid_records"] += 1
            continue
        existing = entries.get(normalized)
        if existing is not None:
            # The first (most frequent) occurrence keeps the rank; the spelling is still recorded.
            stats["duplicate_records"] += 1
            if surface not in existing.surfaces:
                existing.surfaces.append(surface)
            continue
        entries[normalized] = SourceEntry(rank=len(order) + 1, value=None, surfaces=[surface])
        order.append(normalized)
    stats["parsed_records"] = stats["raw_records"] - stats["invalid_records"]
    stats["unique_forms"] = len(order)
    return FrequencySource(source_id=source_id, entries=entries, order=order, list_length=len(order), stats=stats)


@dataclass(frozen=True)
class CaseEvidence:
    """Best rank of each capitalisation of a word in a case-preserving list."""

    ranks: dict[str, int]  # pattern -> best rank
    surfaces: dict[str, str]  # pattern -> spelling at that rank

    def dominant(self) -> str | None:
        if not self.ranks:
            return None
        return min(self.ranks, key=lambda pattern: (self.ranks[pattern], pattern))

    def ratio(self, pattern: str, against: str = "lower") -> float | None:
        """How many times more frequent `pattern` is than `against`, approximated from ranks (Zipf: frequency ~ 1/rank).

        None when `pattern` is absent; infinity when only `pattern` occurs.
        """
        if pattern not in self.ranks:
            return None
        if against not in self.ranks:
            return math.inf
        return self.ranks[against] / self.ranks[pattern]


def case_evidence(lines: Iterable[str]) -> tuple[dict[str, CaseEvidence], dict[str, int]]:
    """Capitalisation evidence per normalised form from a mixed-case ranked list."""
    ranks: dict[str, dict[str, int]] = defaultdict(dict)
    surfaces: dict[str, dict[str, str]] = defaultdict(dict)
    stats = {"raw_records": 0, "invalid_records": 0}
    for rank, line in enumerate(lines, start=1):
        stats["raw_records"] += 1
        surface = line.strip()
        normalized = normalize_form(surface) if surface else None
        if normalized is None:
            stats["invalid_records"] += 1
            continue
        pattern = capitalization_pattern(surface)
        if pattern not in ranks[normalized]:
            ranks[normalized][pattern] = rank
            surfaces[normalized][pattern] = surface
    stats["parsed_records"] = stats["raw_records"] - stats["invalid_records"]
    stats["unique_forms"] = len(ranks)
    return {form: CaseEvidence(dict(ranks[form]), dict(surfaces[form])) for form in ranks}, stats


def zipf(frequency: float) -> float:
    """Zipf scale: log10 of occurrences per billion words (Brysbaert; used by wordfreq)."""
    return round(math.log10(frequency) + 9, 2)


def frequency_dict_source(source_id: str, frequencies: dict[str, float]) -> FrequencySource:
    """A source given as word -> frequency (proportion of tokens), e.g. wordfreq's frequency dictionary.

    Ranks are assigned deterministically: higher frequency first, ties broken by the word itself
    (wordfreq bins frequencies, so ties are common). The native value kept is the Zipf frequency.
    """
    entries: dict[str, SourceEntry] = {}
    stats = {"raw_records": 0, "invalid_records": 0, "duplicate_records": 0}
    best: dict[str, tuple[float, str]] = {}
    for word, frequency in frequencies.items():
        stats["raw_records"] += 1
        normalized = normalize_form(word) if isinstance(word, str) else None
        if normalized is None or not isinstance(frequency, (int, float)) or frequency <= 0:
            stats["invalid_records"] += 1
            continue
        if normalized in best:
            stats["duplicate_records"] += 1
            if frequency <= best[normalized][0]:
                continue
        best[normalized] = (float(frequency), word)
    order = sorted(best, key=lambda form: (-best[form][0], form))
    for rank, form in enumerate(order, start=1):
        frequency, word = best[form]
        entries[form] = SourceEntry(rank=rank, value=zipf(frequency), surfaces=[word], frequency=frequency)
    stats["parsed_records"] = stats["raw_records"] - stats["invalid_records"]
    stats["unique_forms"] = len(order)
    return FrequencySource(source_id=source_id, entries=entries, order=order, list_length=len(order), value_name="zipf", stats=stats)


def load_wordfreq(source_id: str, wordlist: str) -> FrequencySource:
    """wordfreq's English frequency dictionary (requires the pinned wordfreq package)."""
    from wordfreq import get_frequency_dict  # imported here so the core runs without wordfreq installed

    return frequency_dict_source(source_id, get_frequency_dict("en", wordlist=wordlist))
