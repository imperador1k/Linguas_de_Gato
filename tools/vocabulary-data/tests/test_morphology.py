"""ESDB morphology evidence (restricted profile) on a synthetic ESDB database."""

import unittest

from vocabulary_data.candidates import candidate_record
from vocabulary_data.esdb import content_sha256, load_esdb
from vocabulary_data.pipeline import run_pipeline

from .helpers import ESDB_FIXTURE, UNUSED_RAW, config, loaders, register


def records(esdb: bool):
    result = run_pipeline(config(esdb=esdb), register(), raw_dir=UNUSED_RAW, loaders=loaders(), verify_inputs=False)
    return {candidate.normalized: candidate_record(candidate, result.enabled_frequency_sources) for candidate in result.candidates}


class EsdbReaderTest(unittest.TestCase):
    def test_derived_forms_lemmas_minor_readings_and_variants(self):
        esdb = load_esdb(ESDB_FIXTURE, "esdb-2026.02.25")
        went = {(reading.lemma, reading.minor) for reading in esdb.derived_readings("went")}
        self.assertEqual(went, {("go", False), ("wend", True)})  # the archaic reading is marked minor
        self.assertEqual([reading.form_type for reading in esdb.derived_readings("watches")], ["-s form (noun plural or verb present)"])
        self.assertEqual([entry.parts_of_speech for entry in esdb.self_entries("the")], [("determiner",)])  # prefix entry ignored
        self.assertEqual(esdb.variants["colour"], [("color", ("american",))])
        self.assertEqual(esdb.derived_readings("media")[0].defn_note, "communication")

    def test_content_checksum_is_stable(self):
        self.assertEqual(content_sha256(ESDB_FIXTURE), content_sha256(ESDB_FIXTURE))


class MorphologyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.with_esdb = records(esdb=True)
        cls.without = records(esdb=False)

    def test_a_regular_form_is_folded_only_when_two_methods_agree_on_one_lemma(self):
        watches = self.with_esdb["watches"]
        self.assertEqual((watches["candidate_status"], watches["lemma"], watches["fold_basis"]), ("folded", "watch", "esdb_derived_form+morphy"))
        self.assertIn("esdb_confirmed_inflection", watches["flags"])
        self.assertNotIn("possible_regular_inflection", watches["flags"])
        self.assertEqual(watches["surface_forms"], ["watches"])  # the original spelling is kept
        self.assertIn("watches", self.with_esdb["watch"]["folded_forms"])
        # Without ESDB the same form is only a suggestion.
        self.assertEqual((self.without["watches"]["candidate_status"], self.without["watches"]["lemma_status"]), ("retained", "unresolved"))

    def test_a_form_also_listed_as_a_word_is_never_folded(self):
        books = self.with_esdb["books"]  # ESDB also lists "books" (part of speech unknown)
        self.assertEqual((books["candidate_status"], books["lemma"], books["lemma_status"]), ("retained", None, "ambiguous"))
        self.assertIn("inflection_needs_review", books["flags"])
        studied = self.with_esdb["studied"]  # a form of "study" and an adjective of its own
        self.assertEqual((studied["candidate_status"], studied["lemma_status"]), ("retained", "ambiguous"))
        self.assertIn("adjective", studied["part_of_speech"])

    def test_minor_readings_are_evidence_not_ambiguity(self):
        went = self.with_esdb["went"]
        self.assertEqual((went["candidate_status"], went["folded_into"]), ("folded", "en:go"))
        wend = [item for item in went["lemma_analyses"] if item["relation"] == "esdb_derived_form" and item["lemma"] == "wend"]
        self.assertEqual(len(wend), 1)
        self.assertTrue(wend[0]["minor"])
        self.assertNotIn("inflection_needs_review", went["flags"])

    def test_an_explicit_form_that_is_also_a_word_is_unfolded(self):
        media = self.with_esdb["media"]
        self.assertEqual(self.without["media"]["candidate_status"], "folded")  # Open English WordNet alone: form of medium
        self.assertEqual((media["candidate_status"], media["lemma_status"]), ("retained", "ambiguous"))
        sense = [item["sense_note"] for item in media["lemma_analyses"] if item["relation"] == "esdb_derived_form"]
        self.assertEqual(sense, ["communication"])

    def test_function_words_get_a_part_of_speech_from_esdb(self):
        the = self.with_esdb["the"]
        self.assertEqual((the["lemma_status"], the["part_of_speech"], the["part_of_speech_status"]), ("lemma", ["determiner"], "esdb-2026.02.25"))
        self.assertEqual(self.without["the"]["lemma_status"], "unresolved")

    def test_a_form_of_the_word_itself_is_not_a_competing_reading(self):
        you = self.with_esdb["you"]  # ESDB: "you" (pronoun) and its objective form "you"
        self.assertEqual((you["lemma_status"], you["lemma"], you["part_of_speech"]), ("lemma", "you", ["pronoun"]))
        self.assertNotIn("inflection_needs_review", you["flags"])

    def test_esdb_can_contradict_a_suffix_suggestion(self):
        after = self.with_esdb["after"]  # WordNet's rules suggest "aft" + -er; ESDB lists "after" only as a word
        self.assertEqual(self.without["after"]["lemma_status"], "ambiguous")
        self.assertEqual((after["lemma_status"], after["lemma"]), ("lemma", "after"))
        self.assertIn("suggestion_contradicted", after["flags"])
        self.assertNotIn("possible_regular_inflection", after["flags"])

    def test_absence_from_esdb_proves_nothing(self):
        self.assertEqual(self.with_esdb["zygote"]["lemma_status"], self.without["zygote"]["lemma_status"])
        self.assertEqual(self.with_esdb["zygote"]["flags"], self.without["zygote"]["flags"])

    def test_open_english_wordnet_relationships_stay_intact(self):
        for form in ("children", "book", "found", "colour"):
            self.assertEqual(self.with_esdb[form]["lemma"], self.without[form]["lemma"], form)
            self.assertEqual(self.with_esdb[form]["lemma_status"], self.without[form]["lemma_status"], form)
        self.assertEqual(self.with_esdb["children"]["fold_basis"], "oewn_explicit_form")
        oewn_variant = [v for v in self.with_esdb["colour"]["spelling_variants"] if v["evidence"].startswith("oewn")]
        self.assertEqual(len(oewn_variant), 1)


if __name__ == "__main__":
    unittest.main()
