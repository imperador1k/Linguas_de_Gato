"""Source register validation, fetching, deterministic outputs and run validation."""

import copy
import csv
import io
import json
import tempfile
import unittest
from pathlib import Path

from vocabulary_data import PIPELINE_VERSION
from vocabulary_data.fetch import SourceError, fetch_source
from vocabulary_data.manifest import ManifestError, SourceRegister, TOOL_ROOT, sha256_bytes, validate_config, validate_manifest
from vocabulary_data.outputs import OutputError, compare_runs, render_outputs, validate_run, write_run
from vocabulary_data.pipeline import run_pipeline

from .helpers import UNUSED_RAW, config, loaders, register

MANIFEST = json.loads((TOOL_ROOT / "sources" / "manifest.json").read_text(encoding="utf-8"))


def run(**kwargs):
    return run_pipeline(config(), register(), raw_dir=UNUSED_RAW, loaders=loaders(**kwargs), verify_inputs=False)


class RegisterValidationTest(unittest.TestCase):
    def test_the_shipped_register_and_config_are_valid(self):
        self.assertEqual(validate_manifest(MANIFEST), [])
        self.assertEqual(validate_config(config(), register()), [])

    def mutated(self, source_id, change):
        data = copy.deepcopy(MANIFEST)
        source = next(item for item in data["sources"] if item["id"] == source_id)
        change(source)
        return validate_manifest(data)

    def test_a_usable_source_needs_a_complete_licence(self):
        problems = self.mutated("google-books-top-wordlists", lambda source: source["licence"].pop("redistribution"))
        self.assertTrue(any("licence.redistribution" in problem for problem in problems))

    def test_a_usable_source_must_allow_commercial_use(self):
        def deny(source):
            source["licence"]["commercial_use"] = False

        self.assertTrue(any("commercial use" in problem for problem in self.mutated("oewn-2025", deny)))

    def test_pinned_checksums_and_plain_file_names(self):
        def bad_hash(source):
            source["files"][0]["sha256"] = "abc"

        def bad_name(source):
            source["files"][0]["name"] = "../escape.txt"

        self.assertTrue(self.mutated("oewn-2025", bad_hash))
        self.assertTrue(self.mutated("oewn-2025", bad_name))

    def test_deferred_sources_explain_why_and_duplicates_are_refused(self):
        self.assertTrue(self.mutated("cefr-j-octanove", lambda source: source.pop("deferred_reason")))
        data = copy.deepcopy(MANIFEST)
        data["sources"].append(copy.deepcopy(data["sources"][0]))
        self.assertTrue(any("duplicate" in problem for problem in validate_manifest(data)))

    def test_the_config_cannot_enable_an_unapproved_source(self):
        settings = config()
        settings["sources"]["cefr-j-octanove"] = {"enabled": True}
        problems = validate_config(settings, register())
        self.assertTrue(any("cefr-j-octanove" in problem for problem in problems))
        with self.assertRaises(ManifestError):
            register().usable("subtlex-us")

    def test_restricted_sources_cannot_claim_redistribution(self):
        def make_redistributable(source):
            source["profiles"] = ["restricted", "redistributable"]

        self.assertTrue(any("never in the redistributable profile" in problem for problem in self.mutated("wordfreq", make_redistributable)))
        self.assertTrue(any("never in the redistributable profile" in problem for problem in self.mutated("esdb-2026.02.25", make_redistributable)))

        def unpin_build(source):
            source["build"]["commit"] = "rel-2026.02.25"

        self.assertTrue(any("full commit hash" in problem for problem in self.mutated("esdb-2026.02.25", unpin_build)))


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class FetchTest(unittest.TestCase):
    def register_with(self, payload: bytes) -> SourceRegister:
        data = copy.deepcopy(MANIFEST)
        source = next(item for item in data["sources"] if item["id"] == "oewn-2025")
        source["files"] = [{"name": "tiny.txt", "url": "https://example.invalid/tiny.txt", "sha256": sha256_bytes(payload)}]
        return SourceRegister(data)

    def test_downloads_verify_and_never_overwrite(self):
        payload = b"hello\n"
        with tempfile.TemporaryDirectory() as directory:
            raw = Path(directory)
            calls = []

            def opener(request, timeout):
                calls.append(request.full_url)
                self.assertNotIn("@", request.get_header("User-agent"))  # generic client name only
                return FakeResponse(payload)

            lines = fetch_source(self.register_with(payload), "oewn-2025", raw, opener=opener)
            self.assertIn("downloaded and verified", lines[0])
            self.assertEqual((raw / "oewn-2025" / "tiny.txt").read_bytes(), payload)
            again = fetch_source(self.register_with(payload), "oewn-2025", raw, opener=opener)
            self.assertIn("already present", again[0])
            self.assertEqual(len(calls), 1)

    def test_a_modified_download_is_rejected_and_nothing_is_saved(self):
        with tempfile.TemporaryDirectory() as directory:
            raw = Path(directory)
            with self.assertRaises(SourceError):
                fetch_source(self.register_with(b"expected"), "oewn-2025", raw, opener=lambda request, timeout: FakeResponse(b"tampered"))
            self.assertEqual([path.name for path in (raw / "oewn-2025").iterdir()], [])

    def test_an_existing_file_with_another_checksum_is_left_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            raw = Path(directory)
            (raw / "oewn-2025").mkdir()
            (raw / "oewn-2025" / "tiny.txt").write_bytes(b"local edit")
            with self.assertRaises(SourceError):
                fetch_source(self.register_with(b"expected"), "oewn-2025", raw, opener=lambda request, timeout: FakeResponse(b"expected"))
            self.assertEqual((raw / "oewn-2025" / "tiny.txt").read_bytes(), b"local edit")


class DeterminismAndOutputTest(unittest.TestCase):
    def test_same_inputs_and_config_give_identical_outputs(self):
        first = render_outputs(run(), config(), "c" * 64, PIPELINE_VERSION)
        second = render_outputs(run(), config(), "c" * 64, PIPELINE_VERSION)
        self.assertEqual(first, second)

    def test_input_order_does_not_change_the_frequency_ranking(self):
        from .helpers import WORDFREQ

        reversed_frequencies = dict(reversed(list(WORDFREQ.items())))
        self.assertEqual(render_outputs(run(frequencies=reversed_frequencies), config(), "c" * 64, PIPELINE_VERSION), render_outputs(run(), config(), "c" * 64, PIPELINE_VERSION))

    def test_written_runs_validate_compare_and_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            config_path = TOOL_ROOT / "config" / "pipeline.json"
            register_path = TOOL_ROOT / "sources" / "manifest.json"
            result = run()
            a, b = base / "restricted" / "a", base / "restricted" / "b"
            manifest = write_run(a, result, config(), config_path, "c" * 64, register_path, PIPELINE_VERSION, output_root=base)
            write_run(b, run(), config(), config_path, "c" * 64, register_path, PIPELINE_VERSION, output_root=base)
            self.assertEqual(validate_run(a), [])
            self.assertEqual(compare_runs(a, b), [])
            self.assertEqual(manifest["distribution"], "restricted")  # wordfreq is share-alike, internal only
            self.assertEqual(manifest["profile"], "restricted")
            self.assertEqual(manifest["config"]["file"], "config/pipeline.json")
            self.assertNotIn(directory, json.dumps(manifest))
            with self.assertRaises(OutputError):
                write_run(a, result, config(), config_path, "c" * 64, register_path, PIPELINE_VERSION, output_root=base)

            rows = list(csv.DictReader((a / "candidates.csv").open(encoding="utf-8", newline="")))
            document = json.loads((a / "candidates.json").read_text(encoding="utf-8"))
            self.assertEqual([row["candidate_id"] for row in rows], [item["candidate_id"] for item in document["candidates"]])
            attribution = (a / "ATTRIBUTION.md").read_text(encoding="utf-8")
            for source_id in ("google-books-top-wordlists", "wordfreq", "oewn-2025"):
                self.assertIn(f"`{source_id}`", attribution)

    def test_validation_catches_tampering_and_invented_enrichment(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "restricted" / "run"
            write_run(out, run(), config(), TOOL_ROOT / "config" / "pipeline.json", "c" * 64, TOOL_ROOT / "sources" / "manifest.json", PIPELINE_VERSION, output_root=Path(directory))
            document = json.loads((out / "candidates.json").read_text(encoding="utf-8"))
            document["candidates"][0]["enrichment"]["translations_pt_pt"] = ["inventado"]
            (out / "candidates.json").write_text(json.dumps(document), encoding="utf-8")
            problems = validate_run(out)
            self.assertTrue(any("checksum" in problem for problem in problems))
            self.assertTrue(any("must not invent" in problem for problem in problems))


if __name__ == "__main__":
    unittest.main()
