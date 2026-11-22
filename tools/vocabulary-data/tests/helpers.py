"""Synthetic fixtures for offline tests. The words are real English; every rank, frequency and database row is invented."""

from __future__ import annotations

import copy
import json
import sqlite3
import tempfile
from pathlib import Path

from vocabulary_data.adapters import case_evidence, frequency_dict_source, rank_list
from vocabulary_data.esdb import load_esdb
from vocabulary_data.lexicon import load_lexicon
from vocabulary_data.manifest import ESDB, TOOL_ROOT, load_register
from vocabulary_data.pipeline import Loaders

FIXTURES = Path(__file__).parent / "fixtures"
# Injected loaders ignore the raw folder; this placeholder is never read.
UNUSED_RAW = Path("raw-not-used-in-tests")

# Books-style ranked list (lower case), most frequent first.
GOOGLE_LOWER = [
    "the", "is", "i", "children", "child", "went", "go", "book", "books", "found", "find", "data", "datum",
    "london", "color", "colour", "february", "march", "dna", "tbe", "p.", "e.g", "1990", "ibid", "o'clock",
    "carter", "vietnamese", "café", "cafe", "running", "run", "xiv", "mmm", "n't", "zygote", "well-known", "  ", "The",
    "after", "watches", "watch", "studied", "study", "media", "medium",
]
# Case-preserving list: capitalisation evidence (rank = position).
GOOGLE_MIXED = [
    "the", "March", "I", "The", "is", "London", "February", "DNA", "children", "Carter", "Vietnamese", "went", "go",
    "book", "books", "found", "find", "data", "color", "colour", "café", "cafe", "running", "run", "ibid",
    "march", "o'clock", "tbe", "child", "datum", "zygote", "after", "watches", "watch", "studied", "study", "media", "medium",
]
# wordfreq-style proportions of tokens.
WORDFREQ = {
    "the": 0.05, "is": 0.01, "i": 0.02, "it's": 0.004, "children": 3e-4, "child": 2e-4, "went": 3e-4, "go": 1e-3,
    "book": 2e-4, "books": 1e-4, "found": 3e-4, "find": 4e-4, "data": 2e-4, "datum": 3e-7, "london": 2e-4,
    "color": 1e-4, "colour": 5e-5, "february": 1e-4, "march": 2e-4, "dna": 3e-5, "tbe": 4e-7, "e.g": 3e-5,
    "ibid": 5e-7, "carter": 2e-5, "vietnamese": 1e-5, "café": 1e-5, "cafe": 2e-5, "running": 2e-4, "run": 4e-4,
    "john's": 1e-5, "o'clock": 2e-5, "mmm": 1e-5, "xiv": 1e-6, "smartphone": 1e-5, "well-known": 1e-5,
    "after": 6e-4, "you": 0.015, "watches": 2e-5, "watch": 2e-4, "studied": 3e-5, "study": 2e-4, "media": 1e-4, "medium": 5e-5,
}

# A miniature ESDB database: the tables and columns the adapter reads, with rows shaped like real ESDB data.
# (word, lemma, base_pos, pos, defn_note, size, derived_variant_level)
ESDB_ROWS = [
    ("book", "book", "n_v", "m0", "", 35, None),
    ("books", "book", "n_v", "ms", "", 35, None),
    ("books", "books", "", "?", "", 80, None),  # also listed as a word of unknown part of speech
    ("watch", "watch", "n_v", "m0", "", 35, None),
    ("watches", "watch", "n_v", "ms", "", 35, None),  # one lemma, no independent entry
    ("study", "study", "n_v", "m0", "", 35, None),
    ("studied", "study", "n_v", "vd", "", 35, None),
    ("studied", "studied", "aj", "aj0", "", 35, None),  # also an adjective of its own
    ("go", "go", "v", "v0", "", 35, None),
    ("went", "go", "v", "vd", "", 35, None),
    ("went", "wend", "v", "vd", "", 50, 8),  # archaic reading: minor
    ("child", "child", "n", "n0", "", 35, None),
    ("children", "child", "n", "ns", "", 35, None),
    ("media", "media", "n", "n0", "", 35, None),  # a word of its own as well as a plural
    ("media", "medium", "n", "ns", "communication", 35, None),
    ("medium", "medium", "n", "n0", "", 35, None),
    ("the", "the", "d", "d", "", 35, None),
    ("the", "the", "pre", "pre", "", 80, None),  # non-word entry: ignored
    ("you", "you", "pn", "pn0", "", 35, None),
    ("you", "you", "pn", "pn1", "", 35, None),  # objective form of itself: not a competing reading
    ("after", "after", "pp", "pp", "", 35, None),
    ("after", "after", "c", "c", "", 35, None),
    ("colour", "colour", "n_v", "m0", "", 35, None),
    ("color", "color", "n_v", "m0", "", 35, None),
]
ESDB_SPELLINGS = [("colour", "B"), ("color", "A")]


def build_esdb_fixture(path: Path) -> Path:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        create table base_poses (base_pos text, lemma_pos text);
        create table scowl_data (group_id integer, size integer);
        create table derived_variant_info (word_id integer, variant_level integer);
        create table entries (word_id integer, group_id integer, word text, lemma text, base_pos text, pos text,
                              pos_class text, defn_note text, usage_note text);
        create table lemmas (lemma_id integer, group_id integer, lemma text);
        create table lemma_variant_info (lemma_id integer, spelling text);
        """
    )
    connection.executemany(
        "insert into base_poses values (?, ?)",
        [("", "?"), ("n", "n0"), ("v", "v0"), ("n_v", "m0"), ("aj", "aj0"), ("pp", "pp"), ("c", "c"), ("d", "d"), ("pre", "pre"), ("pn", "pn0")],
    )
    groups: dict[tuple[str, str], int] = {}
    for word_id, (word, lemma, base_pos, pos, note, size, level) in enumerate(ESDB_ROWS, start=1):
        group_id = groups.setdefault((lemma, base_pos), len(groups) + 1)
        connection.execute("insert into entries values (?, ?, ?, ?, ?, ?, '', ?, '')", (word_id, group_id, word, lemma, base_pos, pos, note))
        connection.execute("insert into scowl_data values (?, ?)", (group_id, size))
        if level is not None:
            connection.execute("insert into derived_variant_info values (?, ?)", (word_id, level))
    # colour / color share one group (one sense) with different spelling codes.
    connection.executemany("insert into lemmas values (?, ?, ?)", [(1, 900, "colour"), (2, 900, "color")])
    connection.executemany("insert into lemma_variant_info values (?, ?)", [(1, "B"), (2, "A")])
    connection.commit()
    connection.close()
    return path


_ESDB_DIR = tempfile.TemporaryDirectory()
ESDB_FIXTURE = build_esdb_fixture(Path(_ESDB_DIR.name) / "scowl.db")


def register():
    return load_register(TOOL_ROOT / "sources" / "manifest.json")


def config(profile: str = "restricted", esdb: bool = False, **overrides):
    """The shipped configuration of a profile. ESDB is off unless asked for, so OEWN-only behaviour stays testable."""
    name = "pipeline.json" if profile == "restricted" else "redistributable.json"
    data = copy.deepcopy(json.loads((TOOL_ROOT / "config" / name).read_text(encoding="utf-8")))
    if profile == "restricted":
        data["sources"][ESDB]["enabled"] = esdb
    for key, value in overrides.items():
        data[key] = value
    return data


def loaders(lower=None, mixed=None, frequencies=None, lexicon_file="mini-lmf.xml", wordfreq=None) -> Loaders:
    def google(_settings, _directory):
        ranked = rank_list("google-books-top-wordlists", GOOGLE_LOWER if lower is None else lower)
        case, stats = case_evidence(GOOGLE_MIXED if mixed is None else mixed)
        return ranked, case, stats

    return Loaders(
        google=google,
        wordfreq=wordfreq or (lambda _settings: frequency_dict_source("wordfreq", WORDFREQ if frequencies is None else frequencies)),
        lexicon=lambda _settings, _directory: load_lexicon(FIXTURES / lexicon_file, "oewn-2025"),
        esdb=lambda _settings, _directory: load_esdb(ESDB_FIXTURE, ESDB),
    )
