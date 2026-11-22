"""The human-review package: completeness, uniqueness, traceability and isolation."""

import csv
import json
import tempfile
import unittest
from pathlib import Path

from vocabulary_data import PIPELINE_VERSION
from vocabulary_data.manifest import TOOL_ROOT
from vocabulary_data.outputs import OutputError, write_run
from vocabulary_data.pilot import write_pilot
from vocabulary_data.pipeline import run_pipeline
from vocabulary_data.review import COLUMNS, REVIEW_COLUMNS, render_review, validate_review, write_review

from .helpers import UNUSED_RAW, config, loaders, register
from .test_pilot import PILOT

REGISTER_PATH = TOOL_ROOT / "sources" / "manifest.json"
CHECKLIST = TOOL_ROOT / "config" / "function-word-checklist.json"


class ReviewPackageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.base = Path(cls.directory.name)
        result = run_pipeline(config("redistributable"), register(), raw_dir=UNUSED_RAW, loaders=loaders(), verify_inputs=False)
        cls.run_dir = cls.base / "redistributable" / "run"
        write_run(cls.run_dir, result, config("redistributable"), TOOL_ROOT / "config" / "redistributable.json", "c" * 64, REGISTER_PATH, PIPELINE_VERSION, output_root=cls.base)
        cls.pilot_dir = cls.base / "redistributable" / "pilot"
        write_pilot(cls.run_dir, cls.pilot_dir, PILOT, output_root=cls.base)
        cls.package = cls.base / "redistributable" / "review"
        write_review(cls.pilot_dir, cls.run_dir, cls.package, CHECKLIST, batches=3, output_root=cls.base)
        cls.proposal = json.loads((cls.pilot_dir / "pilot-proposal.json").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def rows(self, name):
        with (self.package / name).open(encoding="utf-8", newline="") as handle:
            return list(csv.DictReader(handle))

    def test_every_candidate_appears_exactly_once_in_all_and_in_the_batches(self):
        pilot_ids = [entry["candidate_id"] for entry in self.proposal["entries"]]
        self.assertEqual([row["candidate_id"] for row in self.rows("review-all.csv")], pilot_ids)
        batched = [row["candidate_id"] for batch in (1, 2, 3) for row in self.rows(f"review-batch-{batch}.csv")]
        self.assertEqual(sorted(batched), sorted(pilot_ids))
        self.assertEqual(len(set(batched)), len(batched))
        self.assertEqual(validate_review(self.package, self.pilot_dir), [])

    def test_columns_provenance_and_empty_review_fields(self):
        rows = self.rows("review-all.csv")
        self.assertEqual(list(rows[0]), COLUMNS)
        for row in rows:
            self.assertTrue(row["candidate_id"].startswith("en:"))
            self.assertIn("google-books-top-wordlists:rank=", row["source_rankings"])
            self.assertIn("redistributable_with_attribution_per_source", row["licensing_status"])
            self.assertEqual(row["review_status"], "pending_human_review")
            self.assertTrue(all(row[column] == "" for column in REVIEW_COLUMNS))
        found = [row for row in rows if row["normalized_form"] == "found"]
        if found:  # ambiguous identity: no proposed lemma, every reading in the evidence
            self.assertEqual(found[0]["proposed_lemma"], "")
            self.assertIn("explicit_form find", found[0]["lemma_evidence"])

    def test_no_restricted_trace_and_function_word_report(self):
        coverage = self.rows("function-word-coverage.csv")
        the = [row for row in coverage if row["word"] == "the"][0]
        self.assertEqual(the["coverage"], "unsupported")  # not a dictionary form in the approved lexicon
        self.assertIn("auxiliary_verb", {row["category"] for row in coverage})
        for path in self.package.iterdir():
            text = path.read_text(encoding="utf-8").lower()
            for marker in ("wordfreq", "zipf", "esdb"):
                self.assertNotIn(marker, text, path.name)

    def test_deterministic_and_protected(self):
        checklist = json.loads(CHECKLIST.read_text(encoding="utf-8"))
        self.assertEqual(render_review(self.pilot_dir, self.run_dir, checklist, 3), render_review(self.pilot_dir, self.run_dir, checklist, 3))
        # The same package may be regenerated in place with replace=True; nothing else may be overwritten.
        write_review(self.pilot_dir, self.run_dir, self.package, CHECKLIST, batches=3, output_root=self.base, replace=True)
        with self.assertRaises(OutputError):
            write_review(self.pilot_dir, self.run_dir, self.package, CHECKLIST, batches=3, output_root=self.base)
        with self.assertRaises(OutputError):
            write_review(self.pilot_dir, self.run_dir, self.run_dir, CHECKLIST, batches=3, output_root=self.base, replace=True)
        with self.assertRaises(OutputError):
            write_review(self.pilot_dir, self.run_dir, self.base / "restricted" / "review", CHECKLIST, output_root=self.base)

    def test_tampering_is_detected(self):
        rows = self.rows("review-batch-1.csv")
        target = self.base / "redistributable" / "tampered"
        write_review(self.pilot_dir, self.run_dir, target, CHECKLIST, batches=3, output_root=self.base)
        with (target / "review-batch-2.csv").open("a", encoding="utf-8", newline="") as handle:
            csv.DictWriter(handle, fieldnames=COLUMNS, lineterminator="\n").writerow(rows[0])  # a duplicate row
        problems = validate_review(target, self.pilot_dir)
        self.assertTrue(any("does not match the manifest" in problem for problem in problems))
        self.assertTrue(any("lose or duplicate" in problem or "another batch" in problem for problem in problems))


if __name__ == "__main__":
    unittest.main()
