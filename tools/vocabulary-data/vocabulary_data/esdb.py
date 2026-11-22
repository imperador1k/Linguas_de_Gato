"""English Speller Database (ESDB, formerly SCOWLv2) as morphological evidence.

Read-only access to a `scowl.db` built locally from the pinned ESDB release
(see the README for the build). Only explicit data is used:
- derived forms with their lemma and form type ("books" = `ms`, the -s form of
  the noun/verb "book"; "went" = `vd`, past tense of "go" and of "wend");
- lemma entries with their part of speech, including function words that
  Open English WordNet does not cover (pronouns, prepositions, determiners...);
- spelling variants (lemmas sharing a group with different spelling codes).

ESDB-derived data is restricted (see the source register): it is used only in
the restricted analysis profile and never written to redistributable outputs.
"""

from __future__ import annotations

import hashlib
import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

# ESDB base parts of speech -> our names (one ESDB code can mean two parts of speech).
BASE_POS = {
    "n": ("noun",),
    "pl": ("noun",),
    "v": ("verb",),
    "n_v": ("noun", "verb"),
    "m": ("noun", "verb"),  # "probably a verb and could also be a noun" (ESDB README): uncertain
    "aj": ("adjective",),
    "av": ("adverb",),
    "aj_av": ("adjective", "adverb"),
    "a": ("adjective", "adverb"),  # adjective or adverb, uncertain
    "pn": ("pronoun",),
    "c": ("conjunction",),
    "pp": ("preposition",),
    "d": ("determiner",),
    "i": ("interjection",),
    "abbr": ("abbreviation",),
    "s": ("contraction",),
}
UNCERTAIN_BASE_POS = {"m", "a"}
# Not words on their own: prefixes, suffixes, parts of multiword expressions, non-words.
NON_WORD_BASE_POS = {"pre", "suf", "wp", "we", "x"}
# Possessive forms are grammar, not vocabulary relations.
POSSESSIVE_FORMS = {"np", "nsp", "nssp", "wep", "weps"}
FORM_TYPES = {
    "ns": "plural", "nss": "plural of plural", "ms": "-s form (noun plural or verb present)",
    "vd": "past tense", "vd2": "past tense (were)", "vn": "past participle", "vg": "present participle",
    "vs": "present tense -s", "vs2": "present (are)", "vs3": "present (is)", "vs4": "present plural (are)",
    "aj1": "comparative", "aj2": "superlative", "av1": "comparative", "av2": "superlative",
    "a1": "comparative", "a2": "superlative",
    "pn1": "pronoun objective", "pns": "pronoun plural", "pnd": "pronoun determiner", "pnp": "pronoun possessive",
    "pnr0": "pronoun reflexive", "pnrs": "pronoun reflexive plural", "ds": "determiner plural",
    "d1": "determiner comparative", "d2": "determiner superlative",
}
SPELLING_VARIETIES = {"A": "american", "B": "british", "Z": "british", "C": "canadian", "D": "australian"}


# ESDB sizes: 35-70 dictionary words, 80 valid in current usage, 85 "valid, but may no longer be used
# in modern English". Variant levels: 7 uncommon, 8 archaic, 9 invalid (ESDB README / variant_levels).
MINOR_SIZE = 85
MINOR_VARIANT_LEVEL = 7


@dataclass(frozen=True)
class EsdbLemma:
    written: str
    base_pos: str
    pos_class: str
    usage_note: str
    size: int | None = None

    @property
    def parts_of_speech(self) -> tuple[str, ...]:
        return BASE_POS.get(self.base_pos, ())

    @property
    def minor(self) -> bool:
        """Only in ESDB's "may no longer be used" size: recorded, but not treated as a competing reading."""
        return self.size is not None and self.size >= MINOR_SIZE


@dataclass(frozen=True)
class EsdbDerived:
    lemma: str  # normalised lemma
    base_pos: str
    form_code: str
    defn_note: str  # sense restriction, e.g. "communication" for media -> medium
    size: int | None = None
    variant_level: int | None = None

    @property
    def form_type(self) -> str:
        return FORM_TYPES.get(self.form_code, self.form_code)

    @property
    def parts_of_speech(self) -> tuple[str, ...]:
        return BASE_POS.get(self.base_pos, ())

    @property
    def minor(self) -> bool:
        """Archaic, uncommon or obsolete readings ("went" as the past of "wend"): evidence, not ambiguity."""
        return (self.variant_level is not None and self.variant_level >= MINOR_VARIANT_LEVEL) or (self.size is not None and self.size >= MINOR_SIZE)


@dataclass
class Esdb:
    source_id: str
    lemmas: dict[str, list[EsdbLemma]] = field(default_factory=dict)
    derived: dict[str, list[EsdbDerived]] = field(default_factory=dict)
    variants: dict[str, list[tuple[str, tuple[str, ...]]]] = field(default_factory=dict)
    stats: dict[str, int] = field(default_factory=dict)

    def self_entries(self, normalized: str) -> list[EsdbLemma]:
        """Entries for the form as a word in its own right (non-words such as prefixes excluded)."""
        return [entry for entry in self.lemmas.get(normalized, []) if entry.base_pos not in NON_WORD_BASE_POS]

    def derived_readings(self, normalized: str) -> list[EsdbDerived]:
        return self.derived.get(normalized, [])


def _normalize(word: str) -> str:
    from .normalization import normalize_form

    return normalize_form(word) or ""


def content_sha256(path: Path) -> str:
    """Checksum of the database *content* (its SQL dump). Two builds of the same release give different
    file bytes (SQLite page layout) but the same content, so this is what the source register pins."""
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    try:
        digest = hashlib.sha256()
        for statement in connection.iterdump():
            digest.update(statement.encode("utf-8"))
        return digest.hexdigest()
    finally:
        connection.close()


def load_esdb(path: Path, source_id: str) -> Esdb:
    """Reads a built ESDB database (opened read-only; nothing is executed from the release)."""
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    try:
        lemma_pos = dict(connection.execute("select base_pos, lemma_pos from base_poses"))
        size_of_group: dict[int, int] = dict(connection.execute("select group_id, min(size) from scowl_data group by group_id"))
        level_of_word: dict[int, int] = dict(connection.execute("select word_id, max(variant_level) from derived_variant_info group by word_id"))
        lemmas: dict[str, set[EsdbLemma]] = defaultdict(set)
        derived: dict[str, set[EsdbDerived]] = defaultdict(set)
        rows = 0
        for word_id, group_id, word, lemma, base_pos, pos, pos_class, defn_note, usage_note in connection.execute(
            "select word_id, group_id, word, lemma, base_pos, pos, pos_class, defn_note, usage_note from entries"
        ):
            rows += 1
            key = _normalize(word)
            if not key:
                continue
            size = size_of_group.get(group_id)
            if pos == lemma_pos.get(base_pos) or pos == "?":
                lemmas[key].add(EsdbLemma(written=word, base_pos=base_pos or "", pos_class=pos_class or "", usage_note=usage_note or "", size=size))
            elif pos not in POSSESSIVE_FORMS:
                derived[key].add(
                    EsdbDerived(lemma=_normalize(lemma), base_pos=base_pos or "", form_code=pos, defn_note=defn_note or "", size=size, variant_level=level_of_word.get(word_id))
                )

        # Spelling variants: lemmas of one group (one sense) whose spelling codes differ.
        by_group: dict[int, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
        for group_id, lemma, spelling in connection.execute(
            "select l.group_id, l.lemma, v.spelling from lemmas l join lemma_variant_info v using (lemma_id) where v.spelling in ('A','B','Z','C','D')"
        ):
            by_group[group_id][_normalize(lemma)].add(SPELLING_VARIETIES[spelling])
        variants: dict[str, set[tuple[str, tuple[str, ...]]]] = defaultdict(set)
        for members in by_group.values():
            for form_a, varieties_a in members.items():
                for form_b, varieties_b in members.items():
                    if form_a and form_b and form_a != form_b and varieties_a != varieties_b:
                        variants[form_a].add((form_b, tuple(sorted(varieties_b))))
    finally:
        connection.close()
    return Esdb(
        source_id=source_id,
        lemmas={key: sorted(value, key=lambda item: (item.base_pos, item.written, item.pos_class, item.usage_note, item.size or 0)) for key, value in lemmas.items()},
        derived={key: sorted(value, key=lambda item: (item.lemma, item.base_pos, item.form_code, item.defn_note, item.size or 0, item.variant_level or 0)) for key, value in derived.items()},
        variants={key: sorted(value) for key, value in variants.items()},
        stats={"entries": rows, "lemma_forms": len(lemmas), "derived_forms": len(derived), "forms_with_spelling_variants": len(variants)},
    )
