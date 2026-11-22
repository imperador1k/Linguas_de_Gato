"""Profile isolation: the redistributable profile never touches restricted sources."""

import json
import tempfile
import unittest
from pathlib import Path

from vocabulary_data import PIPELINE_VERSION
from vocabulary_data.manifest import ManifestError, TOOL_ROOT, sha256_file, validate_config
from vocabulary_data.outputs import RESTRICTED_MARKERS, OutputError, render_outputs, validate_run, write_run
from vocabulary_data.pipeline import run_pipeline

from .helpers import UNUSED_RAW, config, loaders, register

REGISTER_PATH = TOOL_ROOT / "sources" / "manifest.json"


def forbidden(*_args):
    raise AssertionError("a restricted source was loaded in the redistributable profile")


def redistributable_run():
    restricted_loaders = loaders(wordfreq=forbidden)
    restricted_loaders.esdb = forbidden
    return run_pipeline(config("redistributable"), register(), raw_dir=UNUSED_RAW, loaders=restricted_loaders, verify_inputs=False)


class ProfileConfigTest(unittest.TestCase):
    def test_restricted_sources_are_refused_in_the_redistributable_profile(self):
        for source_id, settings in (("wordfreq", {"enabled": True, "wordlist": "large", "pool_top_n": 10}), ("esdb-2026.02.25", {"enabled": True})):
            data = config("redistributable")
            data["sources"][source_id] = settings
            problems = validate_config(data, register())
            self.assertTrue(any("not allowed in the redistributable profile" in problem for problem in problems), source_id)
        with self.assertRaises(ManifestError):
            register().usable("wordfreq", "redistributable")
        # The pipeline checks again at run time, whatever the caller passes.
        data = config("redistributable")
        data["sources"]["wordfreq"] = {"enabled": True, "wordlist": "large", "pool_top_n": 10}
        with self.assertRaises(ManifestError):
            run_pipeline(data, register(), raw_dir=UNUSED_RAW, loaders=loaders(), verify_inputs=False)

    def test_the_shipped_configs_are_valid_and_eligible(self):
        self.assertEqual(validate_config(config("redistributable"), register()), [])
        self.assertEqual(validate_config(config("restricted", esdb=True), register()), [])


class RedistributableOutputTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = redistributable_run()  # would raise if wordfreq or ESDB were loaded
        cls.rendered = render_outputs(cls.result, config("redistributable"), "c" * 64, PIPELINE_VERSION)

    def test_only_eligible_sources_are_used_and_credited(self):
        self.assertEqual(self.result.enabled_frequency_sources, ["google-books-top-wordlists"])
        self.assertEqual(sorted(source["id"] for source in self.result.used_sources), ["google-books-top-wordlists", "oewn-2025"])
        header = json.loads(self.rendered["candidates.json"])
        self.assertEqual(header["profile"], "redistributable")
        self.assertEqual(header["distribution"], "attribution")
        self.assertEqual(header["frequency_sources"], ["google-books-top-wordlists"])
        for record in header["candidates"]:
            self.assertEqual(set(record["frequency"]), {"google-books-top-wordlists"})
            self.assertFalse(any(item["relation"].startswith("esdb") for item in record["lemma_analyses"]))

    def test_no_output_mentions_a_restricted_source(self):
        for name, data in self.rendered.items():
            text = data.decode("utf-8").lower()
            for marker in RESTRICTED_MARKERS:
                self.assertNotIn(marker, text, f"{marker} in {name}")

    def test_outputs_are_deterministic(self):
        again = render_outputs(redistributable_run(), config("redistributable"), "c" * 64, PIPELINE_VERSION)
        self.assertEqual(self.rendered, again)

    def test_written_run_validates_and_profiles_cannot_overwrite_each_other(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            config_path = TOOL_ROOT / "config" / "redistributable.json"
            out = base / "redistributable" / "r1"
            manifest = write_run(out, self.result, config("redistributable"), config_path, "c" * 64, REGISTER_PATH, PIPELINE_VERSION, output_root=base)
            self.assertEqual(validate_run(out), [])
            self.assertEqual(manifest["dependencies"], {})
            self.assertEqual([source["id"] for source in manifest["sources"]], ["google-books-top-wordlists", "oewn-2025"])
            # A redistributable result cannot be written into the restricted area, and vice versa.
            with self.assertRaises(OutputError):
                write_run(base / "restricted" / "x", self.result, config("redistributable"), config_path, "c" * 64, REGISTER_PATH, PIPELINE_VERSION, output_root=base)
            restricted = run_pipeline(config(), register(), raw_dir=UNUSED_RAW, loaders=loaders(), verify_inputs=False)
            with self.assertRaises(OutputError):
                write_run(base / "redistributable" / "y", restricted, config(), TOOL_ROOT / "config" / "pipeline.json", "c" * 64, REGISTER_PATH, PIPELINE_VERSION, output_root=base)

    def test_validation_detects_restricted_data_smuggled_into_a_redistributable_run(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            out = base / "redistributable" / "r2"
            write_run(out, self.result, config("redistributable"), TOOL_ROOT / "config" / "redistributable.json", "c" * 64, REGISTER_PATH, PIPELINE_VERSION, output_root=base)
            document = json.loads((out / "candidates.json").read_text(encoding="utf-8"))
            document["candidates"][0]["frequency"]["wordfreq"] = {"rank": 1, "rank_censored": False, "value": 7.7, "with_folded_forms": None}
            (out / "candidates.json").write_text(json.dumps(document), encoding="utf-8")
            # Even with the checksum updated, the structural check and the text scan catch it.
            manifest = json.loads((out / "run-manifest.json").read_text(encoding="utf-8"))
            for output in manifest["outputs"]:
                if output["file"] == "candidates.json":
                    output["sha256"] = sha256_file(out / "candidates.json")
            (out / "run-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            problems = validate_run(out)
            self.assertTrue(any("outside the run's approved sources" in problem for problem in problems))
            self.assertTrue(any("mentions restricted sources" in problem for problem in problems))


class RestrictedAttributionTest(unittest.TestCase):
    def test_restricted_attribution_names_each_restricted_source(self):
        result = run_pipeline(config(esdb=True), register(), raw_dir=UNUSED_RAW, loaders=loaders(), verify_inputs=False)
        attribution = render_outputs(result, config(esdb=True), "c" * 64, PIPELINE_VERSION)["ATTRIBUTION.md"].decode("utf-8")
        self.assertIn("**restricted**", attribution)
        for source_id in ("google-books-top-wordlists", "wordfreq", "oewn-2025", "esdb-2026.02.25"):
            self.assertIn(f"Source id: `{source_id}`", attribution)
        self.assertIn("restricted sources (`esdb-2026.02.25`, `wordfreq`;", attribution)  # sources are listed by id


if __name__ == "__main__":
    unittest.main()
