"""Source adapters, frequency handling, deduplication and the Open English WordNet reader."""

import math
import unittest

from vocabulary_data.adapters import case_evidence, frequency_dict_source, rank_list
from vocabulary_data.lexicon import load_lexicon
from vocabulary_data.ranking import SourceRank, disagreement, ordering_key, source_rank

from .helpers import FIXTURES


class RankListTest(unittest.TestCase):
    def test_duplicates_with_different_capitalisation_keep_the_best_rank_and_every_spelling(self):
        source = rank_list("s", ["the", "The", "cat", "THE", ""])
        self.assertEqual(source.entries["the"].rank, 1)
        self.assertEqual(source.entries["the"].surfaces, ["the", "The", "THE"])
        self.assertEqual(source.entries["cat"].rank, 2)
        self.assertEqual(source.stats, {"raw_records": 5, "invalid_records": 1, "duplicate_records": 2, "parsed_records": 4, "unique_forms": 2})

    def test_missing_words_are_censored_past_the_end(self):
        source = rank_list("s", ["a", "b"])
        self.assertEqual(source_rank(source, "zzz"), SourceRank(rank=3, censored=True, value=None))


class CaseEvidenceTest(unittest.TestCase):
    def test_ratios_from_ranks(self):
        evidence, stats = case_evidence(["London", "the", "march", "March", "DNA"])
        self.assertEqual(evidence["london"].dominant(), "capitalized")
        self.assertTrue(math.isinf(evidence["london"].ratio("capitalized")))
        self.assertEqual(evidence["march"].ratio("capitalized"), 3 / 4)
        self.assertEqual(evidence["dna"].dominant(), "upper")
        self.assertEqual(stats["unique_forms"], 4)


class FrequencyDictTest(unittest.TestCase):
    def test_ranks_are_deterministic_with_ties(self):
        source = frequency_dict_source("wf", {"beta": 0.001, "alpha": 0.001, "gamma": 0.01})
        self.assertEqual(source.order, ["gamma", "alpha", "beta"])
        self.assertEqual(source.entries["gamma"].value, 7.0)  # Zipf = log10(0.01) + 9

    def test_invalid_values_are_counted_not_used(self):
        source = frequency_dict_source("wf", {"ok": 0.1, "": 0.1, "zero": 0.0, "neg": -1})
        self.assertEqual(source.order, ["ok"])
        self.assertEqual(source.stats["invalid_records"], 3)

    def test_rank_for_a_summed_frequency(self):
        source = frequency_dict_source("wf", {"a": 0.5, "b": 0.3, "c": 0.1})
        self.assertEqual(source.rank_for_frequency(0.4), 2)
        self.assertEqual(source.rank_for_frequency(0.6), 1)
        self.assertEqual(source.rank_for_frequency(0.01), 4)


class RankingTest(unittest.TestCase):
    def test_primary_method_orders_by_primary_then_secondary(self):
        ranks_a = {"wf": SourceRank(1, False, 7.0), "g": SourceRank(5, False, None)}
        ranks_b = {"wf": SourceRank(1, False, 7.0), "g": SourceRank(2, False, None)}
        self.assertLess(ordering_key(ranks_b, "b", "primary", "wf", "g"), ordering_key(ranks_a, "a", "primary", "wf", "g"))

    def test_mean_log_rank_is_a_geometric_mean(self):
        key = ordering_key({"wf": SourceRank(10, False, None), "g": SourceRank(1000, False, None)}, "x", "mean_log_rank", None, None)
        self.assertAlmostEqual(key[0], 100.0)

    def test_conflicting_rankings_are_reported_in_both_directions(self):
        books = disagreement(SourceRank(50, False, None), SourceRank(5000, False, 2.0), 1.0)
        self.assertEqual(books["direction"], "books_higher")
        everyday = disagreement(SourceRank(100001, True, None), SourceRank(100, False, 5.0), 1.0)
        self.assertEqual(everyday, {"log10_rank_ratio": 3.0, "direction": "everyday_higher", "bound": True})
        self.assertIsNone(disagreement(SourceRank(10, False, None), SourceRank(20, False, 6.0), 1.0))


class LexiconTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lexicon = load_lexicon(FIXTURES / "mini-lmf.xml", "oewn-2025")

    def test_parts_of_speech_and_lexicographer_files(self):
        book = self.lexicon.lemma_entries("book")
        self.assertEqual(sorted(entry.pos for entry in book), ["noun", "verb"])
        self.assertEqual(self.lexicon.lemma_entries("february")[0].lexfiles, ("noun.time",))
        self.assertEqual(self.lexicon.lemma_entries("well-known")[0].pos, "adjective")  # satellite adjective
        self.assertEqual(self.lexicon.stats["multiword_lemmas"], 1)

    def test_explicit_irregular_forms(self):
        self.assertEqual([(link.lemma, link.pos) for link in self.lexicon.form_of("children")], [("child", "noun")])
        self.assertEqual([(link.lemma, link.pos) for link in self.lexicon.form_of("went")], [("go", "verb")])

    def test_spelling_variants_need_markers_and_similar_spelling(self):
        colour = {(variant.form, variant.variety) for variant in self.lexicon.variants["colour"]}
        self.assertEqual(colour, {("color", "american")})
        realise = {variant.form for variant in self.lexicon.variants["realise"]}
        self.assertEqual(realise, {"realize"})  # "actualise" shares the synset but is a synonym, not a spelling
        self.assertNotIn("actualise", self.lexicon.variants)

    def test_morphy_suggestions_require_an_existing_base(self):
        self.assertEqual(self.lexicon.possible_bases("books"), [("book", "noun", "-s"), ("book", "verb", "-s")])
        self.assertEqual(self.lexicon.possible_bases("zygotes"), [])


if __name__ == "__main__":
    unittest.main()
