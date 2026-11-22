"""Lexical identity, flags, exclusions and folding on synthetic sources."""

import unittest

from vocabulary_data.candidates import candidate_record
from vocabulary_data.pipeline import run_pipeline

from .helpers import UNUSED_RAW, config, loaders, register


class CandidateBuildTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = run_pipeline(config(), register(), raw_dir=UNUSED_RAW, loaders=loaders(), verify_inputs=False)
        cls.result = result
        cls.by_form = {candidate.normalized: candidate for candidate in result.candidates}
        cls.sources = result.enabled_frequency_sources

    def record(self, form):
        return candidate_record(self.by_form[form], self.sources)

    def test_duplicates_with_different_capitalisation_become_one_candidate_with_both_spellings(self):
        the = self.record("the")
        self.assertEqual(the["candidate_status"], "retained")
        self.assertIn("The", the["surface_forms"])
        self.assertIn("the", the["surface_forms"])
        self.assertEqual(sum(1 for candidate in self.result.candidates if candidate.normalized == "the"), 1)

    def test_apostrophes_contractions_and_possessives(self):
        self.assertEqual(self.record("it's")["candidate_status"], "retained")
        self.assertIn("contains_apostrophe", self.record("it's")["flags"])
        self.assertEqual(self.record("john's")["exclusion_reasons"], ["possessive_form"])
        self.assertEqual(self.record("n't")["exclusion_reasons"], ["clitic_fragment"])
        oclock = self.record("o'clock")
        self.assertEqual((oclock["candidate_status"], oclock["lemma_status"]), ("retained", "lemma"))

    def test_hyphenated_words_are_kept_and_flagged(self):
        well_known = self.record("well-known")
        self.assertEqual(well_known["candidate_status"], "retained")
        self.assertIn("contains_hyphen", well_known["flags"])
        self.assertEqual(well_known["part_of_speech"], ["adjective"])

    def test_british_and_american_spellings_are_linked_not_merged(self):
        colour, color = self.record("colour"), self.record("color")
        self.assertEqual((colour["candidate_status"], color["candidate_status"]), ("retained", "retained"))
        self.assertEqual([(v["form"], v["variety"]) for v in colour["spelling_variants"]], [("color", "american")])
        self.assertEqual([(v["form"], v["variety"]) for v in color["spelling_variants"]], [("colour", "british")])
        self.assertEqual(colour["lemma"], "colour")

    def test_irregular_forms_fold_into_their_lemma_and_add_their_frequency(self):
        children = self.record("children")
        self.assertEqual((children["candidate_status"], children["lemma"], children["folded_into"]), ("folded", "child", "en:child"))
        child = self.record("child")
        self.assertEqual(child["folded_forms"], ["children"])
        own = child["frequency"]["wordfreq"]
        self.assertLess(child["frequency"]["wordfreq"]["with_folded_forms"]["rank"], own["rank"])
        # child 2e-4 + children 3e-4 = 5e-4 of tokens; Zipf = log10(5e-4) + 9 = 5.70.
        self.assertEqual(child["frequency"]["wordfreq"]["with_folded_forms"]["value"], 5.7)
        self.assertEqual(self.record("went")["folded_into"], "en:go")

    def test_regular_inflections_are_only_flagged(self):
        books = self.record("books")
        self.assertEqual((books["candidate_status"], books["lemma"], books["lemma_status"]), ("retained", None, "unresolved"))
        self.assertIn("possible_regular_inflection", books["flags"])
        self.assertEqual({(a["lemma"], a["pos"]) for a in books["lemma_analyses"]}, {("book", "noun"), ("book", "verb")})

    def test_one_spelling_can_have_several_parts_of_speech(self):
        self.assertEqual(self.record("book")["part_of_speech"], ["noun", "verb"])
        self.assertEqual(self.record("book")["part_of_speech_status"], "oewn-2025")

    def test_ambiguous_identities_are_kept_with_every_reading(self):
        found = self.record("found")
        self.assertEqual((found["candidate_status"], found["lemma"], found["lemma_status"]), ("retained", None, "ambiguous"))
        self.assertEqual({(a["relation"], a["lemma"]) for a in found["lemma_analyses"]}, {("is_lemma", "found"), ("explicit_form", "find")})
        # "data" is a lemma and a listed form of "datum": not folded away.
        self.assertEqual((self.record("data")["candidate_status"], self.record("data")["lemma_status"]), ("retained", "ambiguous"))
        self.assertEqual(self.record("running")["lemma_status"], "ambiguous")

    def test_proper_names_months_nationalities_and_ambiguous_capitals(self):
        self.assertIn("proper_name_likely", self.record("london")["flags"])
        self.assertIn("proper_name_likely", self.record("carter")["flags"])
        self.assertIn("capitalized_ordinary_word", self.record("february")["flags"])
        self.assertIn("capitalized_ordinary_word", self.record("vietnamese")["flags"])
        self.assertIn("capitalization_ambiguous", self.record("march")["flags"])
        for form in ("london", "carter", "february", "vietnamese", "march"):
            self.assertEqual(self.record(form)["candidate_status"], "retained", form)
        self.assertEqual(self.record("london")["surface_form"], "London")
        i = self.record("i")
        self.assertFalse({"proper_name_likely", "capitalization_ambiguous"} & set(i["flags"]))

    def test_acronyms_are_flagged_not_removed(self):
        dna = self.record("dna")
        self.assertEqual(dna["candidate_status"], "retained")
        self.assertIn("acronym_likely", dna["flags"])
        self.assertEqual(dna["surface_form"], "DNA")

    def test_noise_is_excluded_with_reasons(self):
        self.assertEqual(self.record("tbe")["exclusion_reasons"], ["ocr_artefact"])
        self.assertEqual(self.record("p.")["exclusion_reasons"], ["initial"])
        self.assertEqual(self.record("1990")["exclusion_reasons"], ["contains_digit"])
        self.assertEqual(self.record("xiv")["exclusion_reasons"], ["roman_numeral"])
        self.assertEqual(self.record("mmm")["candidate_status"], "retained")
        self.assertIn("possible_roman_numeral", self.record("mmm")["flags"])
        self.assertEqual(self.record("e.g")["candidate_status"], "retained")
        self.assertIn("abbreviation", self.record("e.g")["flags"])

    def test_accented_spellings_are_only_suggested_as_variants(self):
        cafe_accent = self.record("café")
        self.assertEqual((cafe_accent["candidate_status"], cafe_accent["lemma"]), ("retained", None))
        self.assertIn("possible_accent_variant", cafe_accent["flags"])
        self.assertEqual(self.record("cafe")["lemma_status"], "lemma")

    def test_missing_frequency_data_is_explicit(self):
        zygote = self.record("zygote")
        self.assertTrue(zygote["frequency"]["wordfreq"]["rank_censored"])
        self.assertIsNone(zygote["frequency"]["wordfreq"]["value"])
        self.assertEqual(zygote["source_ids"], ["google-books-top-wordlists"])
        self.assertIn("single_source", zygote["flags"])
        self.assertIn("low_frequency", zygote["flags"])
        smartphone = self.record("smartphone")
        self.assertTrue(smartphone["frequency"]["google-books-top-wordlists"]["rank_censored"])
        self.assertEqual(smartphone["source_ids"], ["wordfreq"])

    def test_evidence_levels_never_overstate(self):
        self.assertEqual(self.record("book")["evidence_level"], "automatically_confirmed")
        self.assertEqual(self.record("children")["evidence_level"], "automatically_confirmed")  # folded explicit form
        self.assertEqual(self.record("dna")["evidence_level"], "source_confirmed_needs_review")  # acronym flag
        self.assertEqual(self.record("found")["evidence_level"], "ambiguous")
        self.assertEqual(self.record("books")["evidence_level"], "no_evidence")  # suffix suggestion only
        self.assertEqual(self.record("tbe")["evidence_level"], "excluded")
        self.assertEqual(self.record("children")["fold_basis"], "oewn_explicit_form")

    def test_nothing_is_invented(self):
        for candidate in self.result.candidates:
            record = candidate_record(candidate, self.sources)
            self.assertEqual(record["review_status"], "unreviewed")
            self.assertEqual(record["enrichment"]["status"], "not_started")
            self.assertTrue(all(value is None for key, value in record["enrichment"].items() if key != "status"))
            if record["lemma_status"] in {"unresolved", "ambiguous"}:
                self.assertIsNone(record["lemma"])
            if not candidate.parts_of_speech:
                self.assertEqual(record["part_of_speech_status"], "unknown")

    def test_every_input_form_is_accounted_for(self):
        # Nothing disappears: every distinct form from either source has a candidate (retained, excluded or folded).
        from .helpers import GOOGLE_LOWER, WORDFREQ

        forms = {form.strip().lower() for form in GOOGLE_LOWER if form.strip()} | set(WORDFREQ)
        self.assertEqual(forms - set(self.by_form), set())


if __name__ == "__main__":
    unittest.main()
