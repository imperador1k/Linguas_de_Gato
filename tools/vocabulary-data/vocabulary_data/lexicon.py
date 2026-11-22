"""Open English WordNet (WN-LMF XML) as the lexical reference.

What it provides, all from explicit data in the release file:
- lemmas with their parts of speech (nouns, verbs, adjectives, adverbs) and
  the lexicographer files of their senses (noun.person, noun.time, ...);
- irregular or exceptional forms listed on an entry ("children" for "child");
- British/American/Australian/Canadian spelling markers on senses, which let
  two lemmas sharing a meaning be linked as spelling variants.

What it does not provide: function words, regular inflections ("books"),
frequencies. Possible regular inflections are suggested separately with
WordNet's own detachment rules (morphy) and always marked as unconfirmed.
"""

from __future__ import annotations

import gzip
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO
from xml.etree.ElementTree import iterparse

from .normalization import is_spelling_variant_shape, normalize_form

POS_NAMES = {"n": "noun", "v": "verb", "a": "adjective", "s": "adjective", "r": "adverb"}
VARIETIES = ("british", "american", "australian", "canadian")

# WordNet "morphy" detachment rules (suffix -> replacement) per part of speech. A suggestion is
# only made when the resulting base is an Open English WordNet lemma with that part of speech.
MORPHY_RULES: dict[str, tuple[tuple[str, str], ...]] = {
    "noun": (("s", ""), ("ses", "s"), ("xes", "x"), ("zes", "z"), ("ches", "ch"), ("shes", "sh"), ("men", "man"), ("ies", "y")),
    "verb": (("s", ""), ("ies", "y"), ("es", "e"), ("es", ""), ("ed", "e"), ("ed", ""), ("ing", "e"), ("ing", "")),
    "adjective": (("er", ""), ("est", ""), ("er", "e"), ("est", "e")),
}


@dataclass(frozen=True)
class LexiconLemma:
    written: str
    pos: str
    lexfiles: tuple[str, ...]
    spellings: tuple[str, ...]


@dataclass(frozen=True)
class FormOf:
    """An explicit form listed on a lexical entry: `form` is a form of `lemma` (with that part of speech)."""

    lemma: str
    pos: str


@dataclass(frozen=True)
class Variant:
    form: str  # normalised spelling of the other variant
    variety: str  # the other variant's spelling variety
    own_variety: str
    # The meanings the two spellings share: a variant can be sense-specific (storey/story: the floor of a building).
    synsets: tuple[str, ...] = ()


@dataclass
class Lexicon:
    source_id: str
    lemmas: dict[str, list[LexiconLemma]] = field(default_factory=dict)
    forms: dict[str, list[FormOf]] = field(default_factory=dict)
    variants: dict[str, list[Variant]] = field(default_factory=dict)
    stats: dict[str, int] = field(default_factory=dict)

    def lemma_entries(self, normalized: str) -> list[LexiconLemma]:
        return self.lemmas.get(normalized, [])

    def form_of(self, normalized: str) -> list[FormOf]:
        return self.forms.get(normalized, [])

    def has_lemma(self, normalized: str, pos: str | None = None) -> bool:
        return any(pos is None or entry.pos == pos for entry in self.lemma_entries(normalized))

    def possible_bases(self, normalized: str) -> list[tuple[str, str, str]]:
        """Morphy suggestions: (base, part of speech, rule) where the base is a lemma with that part of speech."""
        suggestions: set[tuple[str, str, str]] = set()
        for pos, rules in MORPHY_RULES.items():
            for suffix, replacement in rules:
                if normalized.endswith(suffix) and len(normalized) > len(suffix) + 1:
                    base = normalized[: -len(suffix)] + replacement
                    # A bare "-s" on a one- or two-letter base is almost never an inflection ("has" -> "ha", "his" -> "hi").
                    if suffix == "s" and replacement == "" and len(base) < 3:
                        continue
                    if base != normalized and self.has_lemma(base, pos):
                        suggestions.add((base, pos, f"-{suffix} -> -{replacement}" if replacement else f"-{suffix}"))
        return sorted(suggestions)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_lmf(stream: IO[bytes], source_id: str) -> Lexicon:
    """Streams a WN-LMF file; keeps only what the pipeline needs."""
    lexfile_of: dict[str, str] = {}
    raw_entries: list[tuple[str, str, list[str], list[tuple[str, tuple[str, ...]]]]] = []
    stats = {"lexical_entries": 0, "multiword_lemmas": 0, "explicit_forms": 0, "spelling_marked_senses": 0, "synsets": 0}

    for _event, element in iterparse(stream, events=("end",)):
        tag = _local(element.tag)
        if tag == "LexicalEntry":
            lemma_element = next((child for child in element if _local(child.tag) == "Lemma"), None)
            if lemma_element is not None:
                written = lemma_element.get("writtenForm", "")
                pos = POS_NAMES.get(lemma_element.get("partOfSpeech", ""), lemma_element.get("partOfSpeech", "other"))
                forms = [child.get("writtenForm", "") for child in element if _local(child.tag) == "Form" and child.get("writtenForm")]
                senses: list[tuple[str, tuple[str, ...]]] = []
                for child in element:
                    if _local(child.tag) != "Sense":
                        continue
                    marks = tuple(
                        sorted(
                            {
                                variety
                                for relation in child
                                if _local(relation.tag) == "SenseRelation" and relation.get("relType") == "exemplifies"
                                for variety in VARIETIES
                                if f"-{variety}_spelling__" in relation.get("target", "")
                            }
                        )
                    )
                    if marks:
                        stats["spelling_marked_senses"] += 1
                    senses.append((child.get("synset", ""), marks))
                raw_entries.append((written, pos, forms, senses))
                stats["lexical_entries"] += 1
                stats["explicit_forms"] += len(forms)
                if " " in written:
                    stats["multiword_lemmas"] += 1
            element.clear()
        elif tag == "Synset":
            lexfile_of[element.get("id", "")] = element.get("lexfile", "")
            stats["synsets"] += 1
            element.clear()

    lemmas: dict[str, list[LexiconLemma]] = defaultdict(list)
    forms: dict[str, set[FormOf]] = defaultdict(set)
    by_synset: dict[tuple[str, str], list[tuple[str, str]]] = defaultdict(list)
    for written, pos, entry_forms, senses in raw_entries:
        normalized = normalize_form(written)
        if normalized is None:
            continue
        lexfiles = tuple(sorted({lexfile_of.get(synset, "") for synset, _ in senses} - {""}))
        spellings = tuple(sorted({mark for _, marks in senses for mark in marks}))
        lemmas[normalized].append(LexiconLemma(written=written, pos=pos, lexfiles=lexfiles, spellings=spellings))
        for form in entry_forms:
            form_key = normalize_form(form)
            if form_key and form_key != normalized:
                forms[form_key].add(FormOf(lemma=normalized, pos=pos))
        for synset, marks in senses:
            for mark in marks:
                by_synset[(synset, pos)].append((normalized, mark))

    # Two lemmas are spelling variants when they share a synset, carry different spelling markers
    # there, and are spelled alike. The spelling check matters: a synset also holds synonyms
    # ("realise" and "actualise" are both British-marked members of one synset with "realize").
    pair_synsets: dict[tuple[str, str, str, str], set[str]] = defaultdict(set)
    for (synset, _pos), members in by_synset.items():
        for form_a, variety_a in members:
            for form_b, variety_b in members:
                if form_a != form_b and variety_a != variety_b and is_spelling_variant_shape(form_a, form_b):
                    pair_synsets[(form_a, form_b, variety_b, variety_a)].add(synset)
    variants: dict[str, set[Variant]] = defaultdict(set)
    for (form_a, form_b, variety_b, variety_a), synsets in pair_synsets.items():
        variants[form_a].add(Variant(form=form_b, variety=variety_b, own_variety=variety_a, synsets=tuple(sorted(synsets))))

    stats["distinct_lemma_forms"] = len(lemmas)
    stats["forms_with_lemma_links"] = len(forms)
    stats["spelling_variant_links"] = sum(len(value) for value in variants.values())
    return Lexicon(
        source_id=source_id,
        lemmas={key: sorted(value, key=lambda item: (item.pos, item.written)) for key, value in lemmas.items()},
        forms={key: sorted(value, key=lambda item: (item.lemma, item.pos)) for key, value in forms.items()},
        variants={key: sorted(value, key=lambda item: (item.form, item.variety, item.own_variety)) for key, value in variants.items()},
        stats=stats,
    )


def load_lexicon(path: Path, source_id: str) -> Lexicon:
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rb") as stream:
        return parse_lmf(stream, source_id)
