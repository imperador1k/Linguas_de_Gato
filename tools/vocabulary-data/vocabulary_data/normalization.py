"""Text normalisation that never throws information away.

Every record keeps its original surface form. The normalised form is only a
key for joining sources: Unicode NFC, lower case, typographic apostrophes and
hyphens unified, outer whitespace trimmed. Accents, internal punctuation and
spelling are kept, so "café" and "cafe", or "colour" and "color", stay
distinct; their possible relationship is reported, never assumed.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

# Typographic apostrophes and modifier letters that mean "'" in English text.
_APOSTROPHES = {"’": "'", "‘": "'", "ʼ": "'", "ʹ": "'", "`": "'", "´": "'"}
# Unicode hyphens that mean "-" (not dashes: an en or em dash is a different symbol).
_HYPHENS = {"‐": "-", "‑": "-"}
_WHITESPACE = re.compile(r"\s+")
_ROMAN = re.compile(r"^(?=[ivxlcdm]+$)m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$")


def normalize_form(surface: str) -> str | None:
    """The join key for a surface form, or None when nothing usable is left."""
    text = unicodedata.normalize("NFC", surface)
    text = "".join(_APOSTROPHES.get(char, _HYPHENS.get(char, char)) for char in text)
    text = _WHITESPACE.sub(" ", text).strip()
    if not text:
        return None
    # lower() rather than casefold(): casefold turns "ß" into "ss", which loses the spelling.
    return text.lower()


def strip_accents(text: str) -> str:
    """The same text without combining accents ("café" -> "cafe"); used to *suggest* links, never to merge."""
    decomposed = unicodedata.normalize("NFKD", text)
    return unicodedata.normalize("NFC", "".join(char for char in decomposed if not unicodedata.combining(char)))


def comparison_key(normalized: str) -> str:
    """A looser key used only to *report* possible duplicates (accents, apostrophes, hyphens and periods removed)."""
    return re.sub(r"['\-.]", "", strip_accents(normalized))


def edit_distance(a: str, b: str) -> int:
    """Levenshtein distance (insertions, deletions, substitutions)."""
    if len(a) < len(b):
        a, b = b, a
    previous = list(range(len(b) + 1))
    for i, char_a in enumerate(a, start=1):
        current = [i]
        for j, char_b in enumerate(b, start=1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (char_a != char_b)))
        previous = current
    return previous[-1]


def is_spelling_variant_shape(a: str, b: str) -> bool:
    """Whether two spellings are close enough to be variants of one word rather than synonyms.

    colour/color, centre/center, analyse/analyze, programme/program pass;
    realise/actualise or advertise/publicise do not. Deliberately strict: a missed
    variant (plough/plow) is better than linking two different words.
    """
    limit = max(1, round(min(len(a), len(b)) * 0.25))
    return a != b and edit_distance(a, b) <= limit


def capitalization_pattern(surface: str) -> str:
    """lower | capitalized | upper | mixed | none (no cased letters)."""
    letters = [char for char in surface if char.isalpha() and char.lower() != char.upper()]
    if not letters:
        return "none"
    if all(char.islower() for char in letters):
        return "lower"
    if all(char.isupper() for char in letters):
        # A single capital letter ("I", "A") is ambiguous; call it capitalized.
        return "upper" if len(letters) > 1 else "capitalized"
    if letters[0].isupper() and all(char.islower() for char in letters[1:]):
        return "capitalized"
    return "mixed"


@dataclass(frozen=True)
class CharacterProfile:
    """What a normalised form is made of; drives exclusion rules and flags."""

    has_digit: bool
    has_period: bool
    has_apostrophe: bool
    has_hyphen: bool
    has_space: bool
    has_non_ascii_letter: bool
    has_other_symbol: bool
    letter_count: int
    is_roman_numeral: bool
    starts_with_apostrophe: bool


def character_profile(normalized: str) -> CharacterProfile:
    letters = [char for char in normalized if char.isalpha()]
    other = [char for char in normalized if not (char.isalnum() or char in "'-. ")]
    return CharacterProfile(
        has_digit=any(char.isdigit() for char in normalized),
        has_period="." in normalized,
        has_apostrophe="'" in normalized,
        has_hyphen="-" in normalized,
        has_space=" " in normalized,
        has_non_ascii_letter=any(ord(char) > 127 for char in letters),
        has_other_symbol=bool(other),
        letter_count=len(letters),
        is_roman_numeral=len(normalized) >= 2 and bool(_ROMAN.match(normalized)),
        starts_with_apostrophe=normalized.startswith("'"),
    )
