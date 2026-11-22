import unittest

from vocabulary_data.normalization import (
    capitalization_pattern,
    character_profile,
    comparison_key,
    edit_distance,
    is_spelling_variant_shape,
    normalize_form,
    strip_accents,
)


class NormalizeFormTest(unittest.TestCase):
    def test_unicode_composition_is_unified(self):
        decomposed = "café"  # e + combining acute accent
        self.assertEqual(normalize_form(decomposed), "café")
        self.assertEqual(normalize_form("café"), "café")

    def test_case_and_outer_whitespace(self):
        self.assertEqual(normalize_form("  The \t"), "the")
        self.assertEqual(normalize_form("New   York"), "new york")

    def test_typographic_apostrophes_and_hyphens(self):
        self.assertEqual(normalize_form("don’t"), "don't")
        self.assertEqual(normalize_form("o‘clock"), "o'clock")
        self.assertEqual(normalize_form("well‐known"), "well-known")
        # An en dash is a different symbol and is kept.
        self.assertEqual(normalize_form("1990–1995"), "1990–1995")

    def test_empty_records(self):
        self.assertIsNone(normalize_form(""))
        self.assertIsNone(normalize_form("   "))

    def test_spelling_is_never_changed(self):
        # lower(), not casefold(): the German sharp s survives; accents and British spellings stay.
        self.assertEqual(normalize_form("Straße"), "straße")
        self.assertEqual(normalize_form("colour"), "colour")
        self.assertNotEqual(normalize_form("café"), normalize_form("cafe"))


class CapitalizationTest(unittest.TestCase):
    def test_patterns(self):
        self.assertEqual(capitalization_pattern("london"), "lower")
        self.assertEqual(capitalization_pattern("London"), "capitalized")
        self.assertEqual(capitalization_pattern("DNA"), "upper")
        self.assertEqual(capitalization_pattern("iPhone"), "mixed")
        self.assertEqual(capitalization_pattern("I"), "capitalized")  # one capital letter is not an acronym
        self.assertEqual(capitalization_pattern("1990"), "none")


class CharacterProfileTest(unittest.TestCase):
    def test_profiles(self):
        self.assertTrue(character_profile("co2").has_digit)
        self.assertTrue(character_profile("e.g").has_period)
        self.assertTrue(character_profile("don't").has_apostrophe)
        self.assertTrue(character_profile("well-known").has_hyphen)
        self.assertTrue(character_profile("café").has_non_ascii_letter)
        self.assertTrue(character_profile("http://").has_other_symbol)
        self.assertTrue(character_profile("'tween").starts_with_apostrophe)

    def test_roman_numerals(self):
        self.assertTrue(character_profile("xiv").is_roman_numeral)
        self.assertTrue(character_profile("mix").is_roman_numeral)  # also a word: the lexicon protects it
        self.assertFalse(character_profile("i").is_roman_numeral)  # single letters are handled separately
        self.assertFalse(character_profile("mild").is_roman_numeral)


class VariantShapeTest(unittest.TestCase):
    def test_edit_distance(self):
        self.assertEqual(edit_distance("colour", "color"), 1)
        self.assertEqual(edit_distance("centre", "center"), 2)
        self.assertEqual(edit_distance("", "abc"), 3)

    def test_variants_versus_synonyms(self):
        for a, b in [("colour", "color"), ("centre", "center"), ("analyse", "analyze"), ("programme", "program"), ("aesthetics", "esthetics"), ("mum", "mom")]:
            self.assertTrue(is_spelling_variant_shape(a, b), (a, b))
        for a, b in [("realise", "actualise"), ("advertise", "publicise"), ("colour", "colour")]:
            self.assertFalse(is_spelling_variant_shape(a, b), (a, b))

    def test_accent_helpers_only_suggest(self):
        self.assertEqual(strip_accents("café"), "cafe")
        self.assertEqual(strip_accents("naïve"), "naive")
        self.assertEqual(comparison_key("o'clock"), "oclock")
        self.assertEqual(comparison_key("u.s."), "us")


if __name__ == "__main__":
    unittest.main()
