"""The pilot proposal (redistributable only) and its restricted cross-check."""

import json
import tempfile
import unittest
from pathlib import Path

from vocabulary_data import PIPELINE_VERSION
from vocabulary_data.crosscheck import write_crosscheck
from vocabulary_data.manifest import TOOL_ROOT
from vocabulary_data.outputs import OutputError, write_run
from vocabulary_data.pilot import false_positive_signals, render_pilot, write_pilot
from vocabulary_data.pipeline import run_pipeline

from .helpers import UNUSED_RAW, config, loaders, register

REGISTER_PATH = TOOL_ROOT / "sources" / "manifest.json"
# Small numbers for the tiny fixture lists (the shipped config targets about 400 entries).
PILOT = {
    "rank_bands": [10, 30, 60],
    "core_per_band": [3, 3, 3],
    "irregular": 2,
    "variant_pairs": 1,
    "review": {"capitalized_ordinary_word": 2, "acronym_likely": 1, "capitalization_ambiguous": 1, "ambiguous_explicit": 2},
}


class PilotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.base = Path(cls.directory.name)
        redistributable = run_pipeline(config("redistributable"), register(), raw_dir=UNUSED_RAW, loaders=loaders(), verify_inputs=False)
        cls.run_dir = cls.base / "redistributable" / "run"
        write_run(cls.run_dir, redistributable, config("redistributable"), TOOL_ROOT / "config" / "redistributable.json", "c" * 64, REGISTER_PATH, PIPELINE_VERSION, output_root=cls.base)
        restricted = run_pipeline(config(esdb=True), register(), raw_dir=UNUSED_RAW, loaders=loaders(), verify_inputs=False)
        cls.restricted_dir = cls.base / "restricted" / "run"
        write_run(cls.restricted_dir, restricted, config(esdb=True), TOOL_ROOT / "config" / "pipeline.json", "c" * 64, REGISTER_PATH, PIPELINE_VERSION, output_root=cls.base)
        cls.pilot_dir = cls.base / "redistributable" / "pilot"
        write_pilot(cls.run_dir, cls.pilot_dir, PILOT, output_root=cls.base)
        cls.proposal = json.loads((cls.pilot_dir / "pilot-proposal.json").read_text(encoding="utf-8"))
        cls.report = json.loads((cls.pilot_dir / "pilot-report.json").read_text(encoding="utf-8"))
        cls.entries = {entry["surface_form"]: entry for entry in cls.proposal["entries"]}

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def test_every_entry_is_traceable_and_pending_review(self):
        self.assertTrue(self.proposal["entries"])
        ids = [entry["candidate_id"] for entry in self.proposal["entries"]]
        self.assertEqual(len(ids), len(set(ids)))
        for entry in self.proposal["entries"]:
            self.assertEqual(entry["review_status"], "pending_human_review")
            self.assertEqual(entry["licensing"]["status"], "redistributable_with_attribution_per_source")
            self.assertEqual({source["id"] for source in entry["licensing"]["sources"]}, {"google-books-top-wordlists", "oewn-2025"})
            self.assertEqual(entry["source_rank"]["source"], "google-books-top-wordlists")
            self.assertTrue(entry["inclusion_reason"])
            self.assertTrue(all(value is None for key, value in entry["enrichment"].items() if key != "status"))

    def test_unverified_inflections_names_and_unknown_words_are_left_out(self):
        for form in ("books", "watches", "studied", "london", "London", "the", "zygote", "e.g", "café"):
            self.assertNotIn(form, self.entries, form)
        for entry in self.proposal["entries"]:
            self.assertNotIn("possible_regular_inflection", entry["flags"])
            self.assertNotIn("proper_name_likely", entry["flags"])
            self.assertNotEqual(entry["evidence_level"], "no_evidence")

    def test_groups_include_variants_irregular_lemmas_and_a_review_group(self):
        groups = {entry["pilot_group"] for entry in self.proposal["entries"]}
        self.assertIn("spelling_variant_pair", groups)
        self.assertEqual({self.entries.get("colour", {}).get("pilot_group"), self.entries.get("color", {}).get("pilot_group")}, {"spelling_variant_pair"})
        self.assertIn("irregular_lemma", groups)
        self.assertTrue(any(group.startswith("review:") for group in groups))
        self.assertEqual(self.entries["February"]["pilot_group"], "review:capitalized_ordinary_word")
        self.assertEqual(self.entries["DNA"]["pilot_group"], "review:acronym_likely")

    def test_small_pools_are_reported_not_padded(self):
        self.assertLess(self.report["proposed_entries"], self.report["requested_entries"])
        self.assertTrue(self.report["shortfalls"])
        self.assertEqual(self.report["proposed_entries"], len(self.proposal["entries"]))

    def test_the_proposal_is_deterministic(self):
        self.assertEqual(render_pilot(self.run_dir, PILOT), render_pilot(self.run_dir, PILOT))

    def test_only_a_redistributable_run_can_feed_the_pilot(self):
        with self.assertRaises(OutputError):
            render_pilot(self.restricted_dir, PILOT)
        with self.assertRaises(OutputError):
            write_pilot(self.run_dir, self.base / "restricted" / "pilot", PILOT, output_root=self.base)

    def test_review_groups_can_be_capped_by_rank(self):
        from vocabulary_data.pilot import build_proposal

        document = json.loads((self.run_dir / "candidates.json").read_text(encoding="utf-8"))
        entries, _context = build_proposal(document, {**PILOT, "review_max_rank": 5})
        review = [entry for entry in entries if entry["pilot_group"].startswith("review:")]
        self.assertTrue(all(entry["source_rank"]["rank"] <= 5 or (entry["source_rank"]["rank_with_folded_forms"] or 99) <= 5 for entry in review))

    def test_false_positive_signals(self):
        self.assertEqual(false_positive_signals({"normalized_form": "lan", "lexicon_lemmas": ["LAN"], "capitalization": {"pattern": "lower"}}), ["lexicon_match_by_case_only"])
        self.assertEqual(false_positive_signals({"normalized_form": "dna", "lexicon_lemmas": ["DNA"], "capitalization": {"pattern": "upper"}}), [])
        self.assertEqual(false_positive_signals({"normalized_form": "a", "lexicon_lemmas": ["a"], "capitalization": {"pattern": "lower"}}), ["single_letter"])

    def test_the_restricted_crosscheck_stays_restricted(self):
        out = self.base / "restricted" / "crosscheck"
        write_crosscheck(self.pilot_dir, self.restricted_dir, out, output_root=self.base)
        report = json.loads((out / "crosscheck.json").read_text(encoding="utf-8"))
        self.assertEqual((report["profile"], report["distribution"]), ("restricted", "restricted"))
        self.assertEqual(report["entries"], len(self.proposal["entries"]))
        with self.assertRaises(OutputError):
            write_crosscheck(self.pilot_dir, self.restricted_dir, self.base / "redistributable" / "crosscheck", output_root=self.base)
        with self.assertRaises(OutputError):
            write_crosscheck(self.pilot_dir, self.run_dir, self.base / "restricted" / "crosscheck-2", output_root=self.base)


if __name__ == "__main__":
    unittest.main()
