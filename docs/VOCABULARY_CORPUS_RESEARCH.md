# Vocabulary Corpus Research — `top-english-wordlists` audit

Research report, 21 November 2026. No application code, pack, schema or dependency was changed. The repository was cloned (shallow) into a temporary directory outside this project, and analysed with throw-away Python scripts.

Labels used throughout:

- **Verified**: measured on the actual files, or read from a primary source during this audit.
- **Estimate**: computed with a stated heuristic; the order of magnitude is reliable, not the exact count.
- **Recommendation**: my judgement.
- **Unverified**: could not be confirmed; stated as such.

---

## 1. Executive summary

`top-english-wordlists` is a clean, well-formed compilation of **Google Books Ngram (English, version 20120701) 1-gram rankings for 1950–2008**, in plain text with no counts.

It is useful as **one written-frequency signal and a raw candidate pool**. It is **not a suitable foundation on its own** for a learner catalogue:

- **Not learner vocabulary:** it ranks *tokens*, not lemmas or meanings. About a third of the top 20,000 are regular inflections of another entry (estimate). Irregular forms ("went", "children") are separate entries.
- **Names and artefacts:** roughly 11% of the top 20,000 are names, acronyms, initials, Roman numerals or other artefacts (estimate). Examples: "p." at rank 126, "u.s." 377, "et" 228, "tbe" (OCR for "the") 16,524.
- **Books, not speech:** it reflects edited books up to 2008, with strong academic and bibliographic traces ("pp.", "fig", "et", "chapter").
  - Everyday and spoken words rank low: "fridge" 30,355, "toothbrush" 35,128, "oops" 51,330.
  - Recent words barely exist: "smartphone" 162,545, "wifi" 106,821.
- **Single tokens only:** no multiword expressions, no phrasal verbs, no hyphenated compounds. "well-known", "look after" and "ice cream" are absent.
- **Part-of-speech lists are not usable as classifications.** They contain every word that the automatic tagger *ever* tagged that way at least 100 times. "the" is #781 in the adjective list; "children" is #17,356 in the verb list.
- **No CEFR, no definitions, no translations, no examples, no senses.**

**Licence: favourable.** The README declares CC BY 3.0 Unported for the compilation, and Google declares the same licence for the upstream dataset. There is no LICENSE file in the repository.

**Recommendation:**

- Use `top_english_words_lower_100000.txt` (ranking) and `top_english_words_mixed_100000.txt` (case evidence for names and acronyms) as **inputs**, never as the selection.
- Combine them with:
  - a multi-genre frequency source, **wordfreq** (CC BY-SA 4.0), which includes subtitles, web and news;
  - an open lexicon for lemmas, forms and variants: **Open English WordNet** (CC BY 4.0), **Wiktionary via Kaikki** (CC BY-SA 4.0) and **SCOWL/VarCon** (MIT-like);
  - curated pedagogical lists for CEFR and coverage: **CEFR-J** (free with citation), **Octanove C1/C2** (CC BY-SA 4.0) and **NGSL** (CC BY-SA 4.0).
- 15,000–20,000 entries is realistic, provided the unit is "lemma + part of speech (or multiword expression)", not "token", and size follows quality.
- **Next milestone:** a deterministic candidate pipeline (acquisition → cleaning → lemma join → scoring → candidate list with provenance). No AI enrichment and no app import yet.

---

## 2. Repository identity and inspected revision

| Item | Value (verified) |
| --- | --- |
| URL | https://github.com/david47k/top-english-wordlists |
| Author | David Atkinson |
| Inspected commit | `b7585f32cee8e140001054ad5b0bbf373245c360` ("fix markdown links", 2020-07-06 +10:00) |
| Remote `HEAD` on 2026-11-21 | the same commit (`git ls-remote`) |
| History | 4 commits, all on 2020-07-06. All data is in the initial commit `eb09165` (56 files, 5,482,811 lines); later commits only touch the README. |
| Contents | 47 word-list files, 4 shell scripts (`1_fetch_ngram_data.sh` … `4_strip_match_count.sh`), 4 Python filters (`filter.py`, `filter2.py`, `filter3.py`, `filter_strip_count.py`), `README.md` |
| LICENSE file | **None.** The licence appears only in the README (§9). |
| Clone location | a temporary scratch directory outside the project; not a submodule; nothing copied into the app |

---

## 3. Dataset inventory

### 3.1 Format facts (verified for every file)

- **Format:** plain text, UTF-8, one token per line, **CRLF** line endings, no header, **no frequency counts** (stripped by `4_strip_match_count.sh`).
- **Line counts:** every file has exactly its nominal number of lines.
- **Clean lines:** no empty lines, no leading or trailing whitespace, no UTF-8 decoding errors.
- **Duplicates:** no exact duplicates in any lower-case file.
- **Ordering:** descending summed match count, so frequency order. Ties are ordered by `LC_ALL=C sort -f`.
- **Smaller lists are exact prefixes of larger ones.** Verified for the general lists at 10k, 20k, 50k, 100k and 500k (both cases). The other categories are built the same way (`head -n` in `3_create_limited_lists.sh`).
- **`lower` vs `mixed`:** `lower` files are lower-cased *before* counts are merged, so "US"/"us", "May"/"may" and "Polish"/"polish" are summed together. `mixed` files keep case, so one word can occupy several lines ("the", "The", "THE").

### 3.2 Files

Sizes are in bytes. "Unique, case-folded" is the number of distinct entries after Unicode case folding. Every file is plain text in frequency order, from Google Books Ngram English 20120701, with mixed (mostly American) spelling (§4).

| File | Bytes (≈ MB) | Lines | Unique | Unique, case-folded | Category | Main limitations |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `top_english_words_lower_10000.txt` | 90,834 (0.09) | 10,000 | 10,000 | 10,000 | all untagged tokens | inflections, names, initials |
| `top_english_words_lower_20000.txt` | 185,454 (0.18) | 20,000 | 20,000 | 19,999 | " | " |
| `top_english_words_lower_50000.txt` | 473,325 (0.45) | 50,000 | 50,000 | 49,999 | " | more artefacts and foreign tokens |
| `top_english_words_lower_100000.txt` | 954,114 (0.91) | 100,000 | 100,000 | 99,993 | " | " |
| `top_english_words_lower_500000.txt` | 4,875,678 (4.65) | 500,000 | 500,000 | 499,884 | " | mostly noise beyond ~100k |
| `top_english_words_lower_1000000.txt` | 9,926,286 (9.47) | 1,000,000 | 1,000,000 | 999,736 | " | " |
| `top_english_words_mixed_10000.txt` | 89,017 (0.08) | 10,000 | 10,000 | 8,625 | " (case kept) | case variants as separate lines |
| `top_english_words_mixed_20000.txt` | 182,723 (0.17) | 20,000 | 20,000 | 16,624 | " | " |
| `top_english_words_mixed_50000.txt` | 464,964 (0.44) | 50,000 | 50,000 | 39,412 | " | " |
| `top_english_words_mixed_100000.txt` | 939,408 (0.90) | 100,000 | 100,000 | 76,052 | " | " |
| `top_english_words_mixed_500000.txt` | 4,807,193 (4.58) | 500,000 | 500,000 | 375,204 | " | " |
| `top_english_words_mixed_1000000.txt` | 9,744,581 (9.29) | 1,000,000 | 1,000,000 | 758,470 | " | " |
| `top_english_nouns_lower_{10000,20000,50000,100000,500000}.txt` | 90,292 / 181,840 / 461,877 / 931,328 / 4,785,141 | nominal | nominal (500k: 500,000) | 10,000 / 20,000 / 50,000 / 100,000 / 499,978 | tagged `_NOUN` | tagger noise (§5.4); plurals |
| `top_english_nouns_mixed_{10000…500000}.txt` | 89,752 / 180,621 / 456,750 / 921,697 / 4,726,224 | nominal | nominal | 8,432 / 16,227 / 39,101 / 77,355 / 390,453 | `_NOUN`, case kept | " |
| `top_english_verbs_lower_{10000,20000,50000,100000}.txt` | 93,894 / 188,343 / 473,389 / 957,110 | nominal | nominal | 10,000 / 19,999 / 49,999 / 99,995 | `_VERB` | 64% of top 2,000 are inflected forms |
| `top_english_verbs_mixed_{10000…100000}.txt` | 93,445 / 187,409 / 467,616 / 941,579 | nominal | nominal | 8,973 / 16,639 / 37,551 / 72,062 | `_VERB`, case kept | " |
| `top_english_adjs_lower_{10000,20000,50000,100000}.txt` | 97,965 / 198,239 / 500,826 / 1,009,301 | nominal | nominal | 10,000 / 20,000 / 50,000 / 99,994 | `_ADJ` | function words inside |
| `top_english_adjs_mixed_{10000…100000}.txt` | 97,052 / 196,284 / 495,589 / 996,605 | nominal | nominal | 8,619 / 16,341 / 38,453 / 74,786 | `_ADJ`, case kept | " |
| `top_english_advs_lower_10000.txt` | 106,113 (0.10) | 10,000 | 10,000 | 10,000 | `_ADV` | junk from ~rank 5,000 ("pronotum", "der", "ouly") |
| `top_english_advs_mixed_10000.txt` | 107,859 (0.10) | 10,000 | 10,000 | 8,263 | `_ADV`, case kept | " |
| `top_english_prons_lower_10000.txt` | 74,839 (0.07) | 10,000 | 10,000 | 10,000 | `_PRON` | English has ~100 pronouns; the rest is noise ("supra", "incubation") |
| `top_english_prons_mixed_10000.txt` | 72,401 (0.07) | 10,000 | 10,000 | 8,465 | `_PRON`, case kept | " |
| `top_english_adps_lower_500.txt` | 3,373 | 500 | 500 | 500 | `_ADP` (prepositions) | tail: "amplifier", "aspirin", "a.m." |
| `top_english_conjs_lower_500.txt` | 3,686 | 500 | 500 | 499 | `_CONJ` | "v.", "n", "et", "glabrous" |
| `top_english_dets_lower_500.txt` | 3,415 | 500 | 500 | 500 | `_DET` | tail: "rainfall", "arrow", "tort" |
| `top_english_nums_lower_500.txt` | 3,050 | 500 | 500 | 500 | `_NUM` | "p.", "°", "•", "§" in the top 15 |
| `top_english_prts_lower_500.txt` | 2,993 | 500 | 500 | 500 | `_PRT` (particles) | "s", "t", "i.e.", "na" |

There are no interjection or "other" (`_X`) lists. Upstream tags `_X`, `_.` and a bare `_` exist but were dropped by `filter2.py` (verified in the raw `x` file, §4.2).

---

## 4. Source methodology and frequency interpretation

### 4.1 How the lists were built (verified from the scripts)

1. **`1_fetch_ngram_data.sh`** streams `googlebooks-eng-all-1gram-20120701-{a…z}.gz` through `filter.py`.
   - `filter.py` keeps years **≥ 1950** and sums `match_count` per exact token. Tagged and untagged tokens are kept separately.
   - Tokens summing to **fewer than 100** occurrences are dropped.
   - Only the 26 letter files are fetched. Google's `0–9`, `other`, `punctuation` and `pos` files are not, so tokens starting with a digit or symbol are almost entirely absent.
2. **`2_extract_lists.sh`** runs `filter2.py`.
   - The general list takes **untagged** tokens only. Each category list takes tokens ending in that tag, with the tag removed.
   - It optionally lower-cases, then `filter3.py` merges duplicates by summing, and the result is sorted by count.
3. **`3_create_limited_lists.sh`** cuts the prefixes with `head -n`.
4. **`4_strip_match_count.sh`** removes the counts.

### 4.2 Facts about the source

| Question | Answer | Status |
| --- | --- | --- |
| Corpus | Google Books Ngram, English ("eng-all"), version **20120701** (generated July 2012) | Verified (scripts; Google datasets page) |
| Years represented | Script keeps ≥ 1950. The 2012 dataset's last year is **2008** (`googlebooks-eng-all-totalcounts-20120701.txt` runs 1505–2008). **The README's "1950 to 2012" is wrong**: the effective window is 1950–2008. | Verified |
| Corpus size in that window | 357,245,749,160 1-gram tokens (sum of total counts 1950–2008) | Verified |
| Written or spoken | Written: scanned printed books only | Verified |
| Frequency measure | **Raw match counts summed over 59 years**, not normalised per year. Later years weigh more (2008 alone holds 19.5 billion tokens). Published files keep only the rank. | Verified |
| Upstream threshold | Google includes only ngrams occurring more than 40 times | Verified (datasets page) |
| Case | Upstream is case-sensitive; the repo offers `mixed` (kept) and `lower` (merged) | Verified |
| Punctuation and names | Not removed. Initials ("p.", "j."), abbreviations ("e.g.", "mr."), names and URLs ("http://") remain. The README warns about this. | Verified |
| POS tags | Assigned **automatically** by Google's tagger. Google's FAQ: "for modern English we expect the accuracy of the part-of-speech tags to be around 95%", trained on "a mere million words for English". The tagging paper is Lin et al. 2012, *Syntactic Annotations for the Google Books Ngram Corpus*, ACL 2012 demos, pp. 169–174 (metadata verified; full text not retrieved). | Verified (FAQ) |
| How tags appear | Each word appears untagged and with every tag it received: `xerox`, `xerox_NOUN`, `xerox_VERB`, `xerox_ADJ`, plus spurious `xerox_PRON`, `xerox_NUM`, `xerox_DET`, `xerox_X`, `xerox_.`. The `x` file holds 66,100 distinct tokens, 37,547 of them tagged. | Verified (raw `x` file) |
| Tokenisation | Contractions are split ("they're" → "they 're", per Google's FAQ), so "don't" ranks only 44,698 while "n't" ranks 31,608. Hyphenated words are split: `x-ray` does not occur in the raw `x` file, and the 1M list has only 590 tokens containing a hyphen, mostly initials such as "j.-p.". | Verified |
| Lemmas or forms | **Surface forms only.** No lemmatisation anywhere. | Verified |
| Language variety | Mixed, mostly American. In the lower list "color" is 1,209 and "colour" 3,056; "center" 666 vs "centre" 1,625; "organize" 5,311 vs "organise" 17,638. "theatre" (2,663) beats "theater" (3,939). | Verified |
| Genre bias | Strong academic and reference traces: "p." 126, "pp." 298, "et" 228, "figure", "table", "chapter", "journal" are among the most frequent capitalised forms. Published work has documented the scientific-literature bias of this corpus: Pechenick, Danforth & Dodds 2015, *PLOS ONE* 10(10) e0137041 (cited as background; not re-read during this audit). | Data verified; paper unverified here |

### 4.3 What the source can and cannot tell us

**It can tell us:**

- how common a written token form was in English-language books from 1950 to 2008;
- whether a word is usually capitalised (names, acronyms);
- a rough idea of whether a spelling appears at all.

**It cannot tell us:**

- spoken or everyday frequency;
- frequency after 2008;
- frequency of a *meaning* or a *lemma*;
- the dominant part of speech (no counts per tag);
- multiword expressions;
- learner difficulty or CEFR level;
- topical usefulness.

A word near the top of this list is common in **books**. That is evidence, not proof, of everyday use.

---

## 5. Statistical data-quality analysis

All figures refer to `top_english_words_lower_*` unless stated otherwise.

### 5.1 Character classes and normalisation (verified)

| Class | Top 10k | Top 20k | Top 50k | Top 100k | Examples |
| --- | ---: | ---: | ---: | ---: | --- |
| Not plain `[a-z]+` | 83 | 185 | 870 | 2,408 | — |
| Contains "." | 78 | 140 | 522 | 1,016 | p. (126), j. (183), u.s. (377), mr. (510), e.g. (893), st. (983) |
| Contains a digit | 2 | 31 | 215 | 764 | co2, f.2d, a2, i960 |
| Non-ASCII | 1 | 8 | 77 | 512 | à, für, être, daß, josé, в |
| Apostrophe | 3 | 10 | 68 | 226 | o'clock, ma'am (legitimate); o'brien, c'est, qu'il |
| Other symbols | 0 | 0 | 7 | 25 | http://, yahoo!, mg/m2 |
| Single character | 27 | 28 | 36 | 58 | a, i, s, b, x |
| Hyphen | 0 | 0 | 0 | 10 | j.-p., b.c.-a.d. |

**Collisions after folding case, accents, periods, apostrophes and hyphens:**

- top 20k: 121 groups ("us"/"u.s.", "am"/"a.m.", "la"/"l.a.", "a"/"à");
- top 100k: 1,279 groups ("the"/"thé"/"thè", "for"/"för").

**Case variants:** in the `mixed` top 100k, 19,988 lower-case keys appear in more than one casing, covering 43,936 lines.

**Safe to normalise automatically:**

- CRLF line endings;
- Unicode NFC normalisation;
- dropping tokens with digits, symbols or URLs;
- dropping single letters other than "a" and "I";
- dropping initials matching `^([a-z]\.)+$`;
- using the lower list for counting and the mixed list for case evidence.

**Needs a lexicon or a human:**

- abbreviations that are real vocabulary ("e.g.", "a.m.", "Mr");
- apostrophe words ("o'clock", "ma'am");
- accented loanwords ("café", "naïve", "fiancé");
- British/American pairs: keep both, linked as variants, never deduplicated by rank;
- "us"/"US", "may"/"May", "polish"/"Polish": the lower list has merged these and cannot separate them.

### 5.2 Inflection and lemmatisation

**Irregular forms are independent entries (verified ranks):**

| Lemma | Forms and ranks |
| --- | --- |
| run | run 694 · running 1,393 · ran 1,876 · runs 3,112 |
| go | go 189 · going 308 · went 339 · gone 1,112 · goes 1,358 |
| child | children **163** · child 294 (the plural outranks the lemma) |
| good | good 128 · best 296 · better 323 |
| buy | buy 1,864 · bought 2,872 |
| teach | taught **2,120** · teach 2,737 |

**Regular inflections (estimate).** A suffix heuristic (‑s, ‑es, ‑ies, ‑ed, ‑ied, ‑ing, ‑er, ‑est, with the base also present) finds a plausible base for 3,253 of the top 10k (32.5%) and 6,646 of the top 20k (33.2%).

The same heuristic shows why rules alone are unsafe. It wrongly proposes "this" → "thi", "indeed" → "inde", "earnest" → "earn" and "hearted" → "heart". It also cannot tell ‑er comparatives ("faster") from agent nouns ("driver", "employer"), which are separate lemmas.

**Recommendation.** Add a **separate morphological stage driven by a lexicon, not by rules**:

- map each surface form to (lemma, part of speech) candidates using Wiktionary/Kaikki inflection tables, Open English WordNet's exception lists and SCOWL's AGID inflections;
- sum the frequency of all forms of a lemma;
- keep the per-form counts, because the pack's `forms` and the "wrong form" check need them.

Distinguish:

- **Lemma:** the dictionary form, the unit of an entry.
- **Inflected form:** belongs in `forms`, never its own entry.
- **Part of speech:** a different entry ("book" the noun vs the verb; the current contract already does this).
- **Different meanings:** senses inside one entry, each with its own translation and definition.
- **Phrasal verbs and multiword expressions:** their own entries with `kind` set to `phrasal_verb`, `idiom`, `collocation` or `expression`. They must come from other sources, because this repository contains **none**: 0 tokens with spaces, and "look after", "well-known", "ice cream" and "by the way" are absent.

### 5.3 Proper nouns and irrelevant entries (estimate)

The heuristic flags a plain word as a name or acronym when its capitalised or upper-case form is at least 10× more frequent than the lower-case form in the `mixed` list.

| Bucket | Top 20k | Top 50k | Examples |
| --- | ---: | ---: | --- |
| Capitalised-dominant (names, places, nationalities, days and months) | 1,947 (9.7%) | 7,444 (14.9%) | Louisville, Carter, Rachel, Zealand, Oxford, Canada, Gonzalez, Bernstein |
| Upper-case-dominant (acronyms) | 64 (0.3%) | 379 (0.8%) | CEO, FBI, DNA, GDP, BBC, UNESCO, OPEC, USSR |
| Roman numerals | 44 | 84 | xvii, xxiv, viii. The pattern also catches abbreviations ("mm", "ml", "div") and can catch real words ("mix"), so this bucket needs review. |
| Single characters | 28 | 36 | a, i, x, β |
| Not plain a–z | 183 | 860 | u.s.a., ph.d., dept., f.2d, même |
| **Total flagged** | **2,266 (11.3%)** | **8,803 (17.6%)** | |

**Do not discard flagged words blindly.**

- **Legitimate vocabulary caught by the capitalisation test:** "February", "Mondays", "Vietnamese", "Algerian".
- **Acronyms that are vocabulary:** "CEO", "DNA", "GDP", "TV", "UK", "EU".

**Other noise found:**

- OCR errors: "tho" 8,400, "bo" 10,292, "tbe" 16,524, "tlie" 22,366, "aud" 30,011, "thc" 31,792. Long‑s errors ("fuch", "moft") appear only beyond rank 89k.
- Foreign function words: "de" 138, "et" 228, "la" 388, "die" 766, "der" 993, "des" 1,073, "und" 1,520. Some are also English: "die", "la", "en".
- Bibliographic artefacts: "pp." 298, "viz" #5,001 in the noun list.

### 5.4 Part-of-speech reliability (verified)

**Overlaps between the top lists** (nouns, verbs and adjectives top 20k; adverbs top 10k):

- nouns ∩ verbs: 5,448;
- adjectives ∩ nouns: 5,926;
- adjectives ∩ verbs: 6,380;
- in all four lists: 836 ("as", "it", "on", "by", "time", "out", "up"…);
- general top-20k words found in **none** of the content lists: only 4 ("who", "yeah", "yourselves", "thereto").

The category lists include almost everything, so they are not filters.

| Word | Noun # | Verb # | Adjective # | Adverb # |
| --- | ---: | ---: | ---: | ---: |
| the | 6,899 | 35,629 | **781** | — |
| and | 13,544 | 22,659 | **518** | — |
| of | 36,420 | 29,657 | **488** | — |
| is | 8,433 | 1 | 4,701 | — |
| happy | 23,889 | 16,637 | 236 | — |
| book | 61 | 8,334 | 2,178 | — |
| light | 211 | 1,971 | 179 | 2,547 |
| children | 19 | 17,356 | 40,330 | — |
| went | — | 53 | 15,123 | — |

**Why the lists look like this:**

- A token enters a list if the tagger gave it that tag at least 100 times in 59 years of books. At billions of tokens, even a 1% tagging error rate produces thousands of spurious memberships.
- Counts are stripped, so we cannot compute "share of uses as a noun".
- Some multi-category memberships are real ("light": noun, verb, adjective; "fast": adjective, adverb, verb, noun). Part of speech is genuinely not exclusive, which is why the pack models one entry per lemma + part of speech.

**Inflected forms dominate the category lists:**

- 64.4% of the top 2,000 verbs end in ‑ed, ‑ing or ‑s ("is", "was", "has", "used", "being");
- 25.5% of the top 2,000 nouns look plural.

**Recommendation:**

- Treat these lists only as weak evidence that a word *can* take a part of speech.
- Take the part of speech from a lexicon (Open English WordNet, Wiktionary) and from CEFR-J/Octanove, which list part of speech per headword.
- If tag shares are needed, regenerate them from the raw tagged 1-grams *with counts* (§13, optional).
- Closed classes (prepositions, conjunctions, determiners, pronouns, numbers) should come from a hand-checked list. The 500-entry lists are noisy after the first ~50 entries.

### 5.5 Coverage (verified ranks; topic labels are not inferable from this data)

| Area | Ranks in the general list |
| --- | --- |
| Everyday or spoken | please 1,859 · thanks 2,799 · sorry 3,140 · okay 4,056 · yeah 5,242 · hello 8,596 · gonna 9,048 · wow 17,771 · oops 51,330 |
| Family | dad 3,989 · mom 4,777 · grandmother 5,810 · nephew 9,731 · grandma 13,045 · mum 14,308 · sibling 14,777 · stepmother 24,229 |
| Food | breakfast 4,302 · sandwich 11,040 · spoon 11,212 · refrigerator 11,480 · pasta 15,635 · cucumber 22,894 · broccoli 24,995 · fridge 30,355 |
| Shopping and money | discount 6,410 · receipt 7,118 · bargain 8,571 · invoice 16,834 · refund 16,933 · wallet 18,075 · cashier 24,053 · checkout 34,257 |
| Travel | airport 5,436 · boarding 10,872 · passport 12,663 · luggage 14,576 · suitcase 16,942 · itinerary 23,809 · sightseeing 29,275 |
| Health | nurse 3,121 · headache 8,175 · prescription 8,440 · vaccine 10,096 · sore 10,324 · pharmacy 13,131 · allergy 13,328 |
| Technology | computer 879 · internet 2,559 · online 3,954 · app 7,079 · website 8,814 · email 10,226 · password 10,472 · download 15,927 · laptop 23,490 · wifi 106,821 · smartphone 162,545 |
| Work | meeting 841 · interview 1,989 · salary 4,574 · colleague 8,725 · deadline 11,540 · stakeholder 23,412 |
| Academic | significant 627 · whereas 1,452 · furthermore 2,217 · hypothesis 2,581 · empirical 2,996 · methodology 5,200 |
| Emotions | happy 1,605 · angry 3,414 · anxious 4,100 · worried 4,889 · grateful 5,168 · lonely 6,555 · embarrassed 8,940 · jealous 9,480 |

**Conclusion:**

- **Academic and literary vocabulary** is over-ranked relative to its learning priority.
- **Concrete everyday and spoken vocabulary** sits between 10k and 35k.
- **Post-2008 technology** is nearly absent.

The raw material contains most of what we need in the top ~50k–100k tokens, but frequency alone puts it in the wrong order. **Recommendation:** classify topics in a later enrichment stage (AI-assisted, human-reviewed, constrained to a fixed list), using the definition and example of each sense, not the bare word.

---

## 6. Linguistic limitations (summary)

1. Tokens, not lemmas or senses. Homographs ("bank", "light", "may") are merged.
2. No multiword expressions, phrasal verbs, idioms, collocations or hyphenated compounds.
3. Category lists are tagger noise without counts.
4. Edited books from 1950–2008: under-represents speech, informal language and recent vocabulary; over-represents academic and bibliographic tokens.
5. American-leaning, mixed variety; no variant links.
6. Names, acronyms, OCR errors and foreign fragments remain.
7. Only ranks survive. Without counts we cannot compute Zipf values, dispersion or tag shares.

---

## 7. Frequency versus educational usefulness

These are distinct properties, and the data proves it.

**CEFR levels against frequency** (verified). Each CEFR-J/Octanove headword is placed by its lowest listed level and its rank in this repository's list. 8,501 single-word headwords; 257 not found, mostly slash-joined variant headwords such as "analyze/analyse".

| Rank band | A1 | A2 | B1 | B2 | C1 | C2 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1–2,000 | 553 | 395 | 331 | 114 | 5 | 1 |
| 2,001–5,000 | 266 | 308 | 539 | 340 | 50 | 15 |
| 5,001–10,000 | 134 | 224 | 536 | 566 | 148 | 58 |
| 10,001–20,000 | 62 | 163 | 397 | 685 | 237 | 164 |
| 20,001–50,000 | 10 | 68 | 188 | 455 | 293 | 357 |
| 50,001–100,000 | 0 | 10 | 33 | 97 | 111 | 149 |
| > 100,000 | 0 | 2 | 13 | 31 | 42 | 94 |

Examples:

- A1/A2 words far down the list: homework A1 10,863 · sandwich A1 11,040 · supermarket A1 16,040 · sightseeing A2 29,275 · fridge A2 30,355 · toothbrush A2 35,128.
- C1/C2 words near the top: thereby C1 2,525 · hypothesis C2 2,581 · notwithstanding C1 6,388.

A "top 20,000 tokens" cut would include about 2,000 names and artefacts, miss many A1–A2 items, and contain no multiword expressions at all.

| Concept | Source of evidence | Computed or judged |
| --- | --- | --- |
| Written (book) frequency | this repository / Google 2012 | Computed |
| Multi-genre frequency incl. subtitles | wordfreq (subtitles, web, news, Wikipedia, books) | Computed |
| Spoken frequency | wordfreq's subtitle component (blended); OANC spoken (3.2M words, small) | Computed, approximate |
| General usefulness | curated lists (NGSL core coverage, CEFR-J), plus frequency agreement across sources | Computed from curated lists |
| CEFR difficulty | CEFR-J (A1–B2), Octanove (C1–C2), else an estimate | Listed or estimated |
| Subject importance | NAWL for academic; topic quotas reviewed by a human | Judged, with frequency checks |
| Acquisition priority | CEFR band, then frequency within the band | Derived |

**Recommended selection strategy (transparent, no invented weights).** Use ordered gates and tiers, each with a recorded reason, instead of a weighted score.

- **Gate:** the candidate must be a real English lemma, part of speech or multiword expression found in a lexicon (Open English WordNet or Wiktionary). It must not be a name, acronym without learner value, OCR error, foreign fragment, or a word labelled obsolete or archaic. Offensive words are kept only if flagged.
- **Tier 1, curated pedagogical lists:** CEFR-J A1–B2, Octanove C1–C2, NGSL core, NAWL academic. Included unless review rejects them.
- **Tier 2, frequency:** the remaining lemmas in wordfreq order (lemma-summed). The cut-off is **calibrated to the target size and written into the config**, not chosen in advance. Google's book rank is a secondary signal: a large gap between book rank and wordfreq rank marks literary or academic vocabulary (or speech-only vocabulary) for review.
- **Tier 3, topic coverage:** per topic, a reviewed list of everyday items missing from tiers 1–2 (the "fridge" and "checkout" problem). Each one must still pass the gate and a frequency floor.
- **Ordering within the catalogue:** CEFR band (listed or estimated), then lemma frequency.

**Computed deterministically:**

- counts, normalisation, lemma mapping, list membership;
- the name/acronym case ratio;
- frequency joins and thresholds;
- de-duplication, IDs, validation and pack splitting.

**AI-assisted, then human-reviewed:**

- splitting and choosing senses;
- pt-PT translations, learner definitions, context sentences and accepted answers;
- register and topic labels;
- CEFR estimates for unlisted items;
- borderline usefulness decisions (specialist terms);
- sensitivity flags.

---

## 8. CEFR feasibility

- **The repository has no CEFR metadata** (verified).
- **No mapping from these lists to CEFR is possible without external resources.**

**Open CEFR resources** (verified from https://github.com/openlanguageprofiles/olp-en-cefrj, commit `d4e45b7`; files counted locally):

| Resource | Rows | Distinct headwords | Levels | Notes | Terms |
| --- | ---: | ---: | --- | --- | --- |
| CEFR-J Wordlist v1.5 (Tono Laboratory, TUFS) | 7,799 | 6,867 | A1 1,164 · A2 1,411 · B1 2,446 · B2 2,778 | Level per (headword, part of speech); 847 headwords have several parts of speech; 142 multiword headwords ("according to", "air conditioning"); 199 slash-joined variant headwords ("adviser/advisor") across both files | "can be used for research and commercial purposes with no charge, provided that you cite the dataset properly"; copyright Tono Laboratory, TUFS |
| Octanove Vocabulary Profile C1/C2 v1.0 (Octanove Labs) | 2,136 | 1,955 | C1 1,111 · C2 1,025 | 11 multiword headwords ("bulk up", "dole out", "bona fide"); minor defects: part of speech "vern", one empty part of speech, trailing spaces | CC BY-SA 4.0 |

Together these give 8,653 distinct headwords; 165 headwords appear in both files.

- CEFR-J was designed for Japanese learners, and Octanove's methodology is not documented in that repository. Treat both as **listed by a named source, not as ground truth**.
- The **English Vocabulary Profile** (Cambridge) and the **Oxford 3000/5000** are well-known proprietary lists. They were not investigated here and should not be used without permission.

**Recommended method:**

1. `cefr = {level, source: 'cefr-j' | 'octanove', certainty: 'listed'}` when (lemma, part of speech) matches a listed row; slash headwords expand to variants.
2. Otherwise an **estimate**, `certainty: 'estimated'` with source `ldg-estimate`. It is produced from features (frequency band, list membership, morphological complexity) plus an AI proposal for each sense, reviewed by a human.
3. Otherwise `null`. Exercises work without CEFR, which is already true in the trainer.
4. **Meanings can have different levels** ("run a company" is harder than "run fast"). The current contract stores CEFR per entry. A later schema version may add an optional per-sense override (§11).

CEFR remains metadata used for filtering and ordering, never a gate for exercises.

---

## 9. Licensing and redistribution assessment

Not legal advice. Facts are quoted from the sources; open questions are listed at the end.

| Layer | What the source says | Status |
| --- | --- | --- |
| Repository compilation | README: "This compilation is licensed under a Creative Commons Attribution 3.0 Unported License." No LICENSE file. The scripts carry no licence. | Verified |
| Upstream data | Google's datasets page: "This compilation is licensed under a Creative Commons Attribution 3.0 Unported License." It lists Version 20120701 as still downloadable. The old URL `datasetsv2.html` now returns 404; the current page is `https://storage.googleapis.com/books/ngrams/books/datasetsv3.html`. | Verified |
| Underlying books | Copyrighted works; the dataset releases only aggregate counts, under Google's licence above | Context |

**What we may do, on my reading of CC BY 3.0** (https://creativecommons.org/licenses/by/3.0/):

- download the lists, process and transform them, and store selected entries in our own JSON;
- redistribute the derived catalogue inside the app, including commercially;
- in return, give attribution, link the licence, and indicate the changes.

Individual words and ranks are largely factual data. The licence still has to be honoured.

**Attribution to preserve:**

```
Frequency data derived from the Google Books Ngram Viewer dataset,
English, Version 20120701 (googlebooks-eng-all-1gram-20120701), by Google,
licensed under CC BY 3.0 Unported (https://creativecommons.org/licenses/by/3.0/).
Dataset page: https://storage.googleapis.com/books/ngrams/books/datasetsv3.html
Via "top-english-wordlists" by David Atkinson (https://github.com/david47k/top-english-wordlists,
commit b7585f3), CC BY 3.0 Unported. Accessed 2026-11-21.
Changes: years 1950–2008 summed; lower-cased; ranks only; filtered, lemmatised and
combined with other sources; used as one selection signal.
```

**The real licensing decision is downstream.** Several of the best complementary sources are **share-alike (CC BY-SA 4.0)**: wordfreq data, Wiktionary/Kaikki, NGSL and Octanove. If our packs embed their data (frequency values, levels, forms, adapted definitions), the packs must be CC BY-SA 4.0. CC BY 3.0 and CC BY 4.0 material (Google, Open English WordNet) can be included in a CC BY-SA 4.0 pack.

**Recommendation:**

- License **production vocabulary packs as CC BY-SA 4.0**, with a per-pack `sources` list.
- Keep the application code under its own licence; packs are separate data files.
- A future commercial app can still ship CC BY-SA content, but the packs themselves must stay share-alike and attributed.

**Unresolved:**

1. **CEFR-J's terms are custom.** They grant use "for research and commercial purposes … provided that you cite". They do not say whether the levels may be redistributed inside a CC BY-SA pack. Confirm with the CEFR-J project, or keep the CEFR-J level as clearly cited metadata and accept a small risk.
2. **SUBTLEX-US.** No licence on the official page. A mirror reports CC BY-NC-ND 3.0, which I could not open (404). wordfreq reports e-mail permission from Marc Brysbaert for its own redistribution. **Do not use SUBTLEX-US directly**; use it only through wordfreq, under wordfreq's terms.
3. **SCOWL's exact terms** sit in its `Copyright` file, which was not read ("MIT-like" per the README).
4. **Lingua Libre** (future audio): the licence could not be verified in this audit.
5. **wordfreq** warns that converting its data to CSV loses the attribution it requires. Our pipeline must carry attribution with any stored values.

---

## 10. Complementary dataset comparison

| Source | Main purpose | Strengths | Limitations | Licence (as verified) | Recommended use |
| --- | --- | --- | --- | --- | --- |
| **top-english-wordlists** (Google 2012) | Written frequency, candidate pool | Huge corpus, simple files, permissive | Books only, ≤ 2008, tokens, no counts, noisy tags | CC BY 3.0 (README; Google page) | Raw pool and book-frequency signal; case evidence |
| **wordfreq** (R. Speer) | Multi-genre frequency (Zipf) | Blends Wikipedia, OpenSubtitles 2018 + SUBTLEX, NewsCrawl, GlobalVoices, Google Books 2012, OSCAR, Twitter, Reddit; more spoken and contemporary | Frozen "snapshot … up through 2021" (sunset note, Sept 2024); tokens, not lemmas | Code Apache-2.0; data CC BY-SA 4.0 | **Primary frequency signal** (lemma-summed) |
| **SUBTLEX-US** | Spoken-like frequency (51M words of subtitles) | Good predictor of everyday use; Zipf and contextual diversity | Licence unclear | Unclear (see §9) | Only through wordfreq |
| **OANC** | Contemporary American English corpus | 14.6M words, 22% spoken (Switchboard, Charlotte); open for commercial development | Small; dated; footer says "All rights reserved" despite open-use wording | "unrestricted in terms of usage and redistribution" (site) | Not needed initially; optional check of spoken frequency |
| **CEFR-J v1.5** | A1–B2 levels | Level and part of speech per headword; 142 multiword headwords | Japanese-learner orientation; per headword, not per sense | Free for research and commercial use with citation | **Listed CEFR A1–B2** |
| **Octanove C1/C2 v1.0** | C1–C2 levels | Fills the advanced levels | Small (2,136); methodology undocumented; minor defects | CC BY-SA 4.0 | **Listed CEFR C1–C2** |
| **NGSL 1.2** | Core vocabulary | 2,809 lemmatised headwords, "92%+ coverage of general English" | Small by design | CC BY-SA 4.0 | Coverage check for the core; NAWL for academic (licence to confirm) |
| **Open English WordNet** (2025 edition) | Lemmas, part of speech, senses, glosses | 161,875 words, 120,564 synsets; maintained (released 31 Dec 2025) | Senses too fine-grained and glosses too terse for learners | CC BY 4.0; credit both Princeton and the Open English WordNet team | Validate lemma and part of speech; candidate senses; definition drafts |
| **Wiktionary via Kaikki/wiktextract** | Forms, variants, labels, translations | Inflection tables, British/American labels, "obsolete"/"archaic" tags, Portuguese translations, audio links (dump dated 2026-10-01) | Uneven quality; Portuguese translations often not marked pt-PT vs pt-BR | Wiktionary: CC BY-SA 4.0 + GFDL (wiktextract code is MIT) | **Forms, variants, obsolete flags**; pt-PT translation *candidates* only |
| **SCOWL / VarCon / AGID** | Spelling variants, inflections | Deterministic US/GB/CA/AU variant codes; inflections | Spelling only, no meaning | "MIT-like" (README; Copyright file not read) | **Variants** and a second inflection check |

Sources such as Lingua Libre and Wikimedia Commons audio belong to the later Audio milestone and are not needed now.

---

## 11. Compatibility with the existing pack format

Reviewed: `packages/shared/src/contracts/vocabulary-pack.ts`, `docs/VOCABULARY_PACKS.md`, the demo pack (47 entries, 49 senses, 63 contexts, about 680 bytes per entry pretty-printed), and the trainer.

| Field the catalogue needs | In the contract? | From this repository? | Where it must come from |
| --- | --- | --- | --- |
| Stable entry ID | ✅ `id` (e.g. `en:book:verb`) | — | Derived deterministically from lemma + part of speech, never from row order |
| Lemma | ✅ `lemma` | ❌ (tokens only) | Lexicon join (Open English WordNet, Wiktionary) |
| Language | ✅ pack `language` | — | — |
| Part of speech | ✅ `partOfSpeech` (10 values incl. `phrase`) | ⚠️ unreliable | Lexicon, CEFR-J/Octanove |
| Inflected forms | ✅ `forms` (label → one word) | ⚠️ forms present as separate tokens | Wiktionary, AGID |
| Spelling variants | ✅ `variants` (lemma only) | ⚠️ both spellings present, unlinked | VarCon, Wiktionary |
| Frequency rank and source | ✅ `frequency {rank, source}` (one signal) | ✅ rank (book) | wordfreq (primary), Google (secondary) |
| CEFR and provenance | ✅ `cefr {level, source, certainty}` per entry | ❌ | CEFR-J, Octanove, or an estimate |
| Topics | ✅ `topics` (1–4 of 11) | ❌ | AI-assisted, reviewed |
| Multiple senses | ✅ `senses` (≤ 8) | ❌ | Lexicon candidates, then AI selection, then review |
| pt-PT translations | ✅ per sense | ❌ | AI drafting (Wiktionary as hints), human review |
| English definitions | ✅ per sense, optional | ❌ | Learner-style definitions drafted from WordNet/Wiktionary glosses, reviewed |
| Example and context sentences | ✅ `contexts` (one gap, `answer`, `accepted`, `clue`) | ❌ | Written fresh (AI-assisted), validated by the pack schema and pack-file tests |
| Explicit accepted answers | ✅ `accepted` per sense and per context | ❌ | Review |
| Register | ✅ per sense (formal / neutral / informal) | ❌ | Wiktionary labels and review |
| Source attribution and licence | ✅ pack `sources` + `licence` | — | Manifest |
| Review status | ❌ | — | **Needs a schema addition** |

**Gaps to resolve in a future schema version** (recommendations only; nothing changed now):

1. **Review status and provenance per sense**: for example `review: 'draft' | 'reviewed'`, and which source or process produced the translation, definition and contexts. Without this, AI-drafted and reviewed content are indistinguishable.
2. **Topic list:** 11 topics are too few for the brief (family, shopping, transport, science, society and politics, academic, professional…). `topics.min(1)` also forces a topic onto general words such as "however". Add `general` or allow an empty list.
3. **Source metadata:** `packSourceSchema` has `name`, `url` and `licence`, but no `revision`, `accessed` or `transformation` fields for the attribution block in §9.
4. **Form variants:** `forms` maps one label to one word, so "learned"/"learnt" needs either two labels or an array.
5. **Per-sense CEFR override** (optional).
6. **Pack size and splitting:** 15k entries at the demo's density would be about 10 MB of JSON, validated with Zod on the main thread when opened. Split into packs of roughly 1,500–3,000 entries by band or purpose (`en-core-a1a2`, `en-b1`, `en-b2`, `en-c1`, `en-c2`, `en-academic`, `en-phrasal-verbs`). The catalogue already supports up to 200 packs. The Library currently browses one pack at a time, so cross-pack search is a UI task for the import milestone.

**Not every entry needs every mode:**

- **Spelling** needs pt-PT translations.
- **Definition** needs a definition.
- **Context** needs a validated sentence.
- **Audio** needs licensed audio.

The trainer already uses only what exists.

---

## 12. Recommended catalogue architecture

- **Units counted separately:**
  - **entries**: lemma + part of speech, or a multiword expression;
  - **senses**: meanings inside an entry;
  - **forms**: inflections inside an entry, never counted as entries;
  - **contexts**: exercise sentences inside a sense.

  "15,000–20,000" refers to **entries**.
- **One entry per lemma and part of speech**, with senses for distinct meanings. Unrelated homographs of the same part of speech ("bank" of a river vs "bank" for money) stay senses of one entry, each with its own translation. Translations are never merged across senses.
- **Multiword expressions as first-class entries** (`kind`: `phrasal_verb`, `idiom`, `collocation`, `expression`; `partOfSpeech: 'phrase'` or the head's part of speech).
- **Provenance everywhere:** pack `sources` carry the manifest data; each value with an external origin names its source id (`frequency.source`, `cefr.source`, and per-sense provenance after the schema change).
- **Packs are generated artefacts.** Only the pipeline writes them. They are validated by the same Zod schema the app uses, and are reproducible from pinned inputs plus the cached, reviewed enrichment.
- **Learner progress remains separate** (unchanged).

---

## 13. Recommended data-preparation pipeline

Raw inputs live **outside** the app repository, in a cache, recorded by URL and SHA-256. The pipeline code and its small, reviewed intermediate files can live in a `tools/vocabulary-pipeline/` folder in a later milestone.

| # | Stage | Tool | Deterministic? | Output |
| --- | --- | --- | --- | --- |
| 1 | Acquisition | Python stdlib (`urllib`, `gzip`) | ✅ | `manifest.json`: URL, revision or commit, SHA-256, size, date |
| 2 | Licence and provenance | Hand-edited YAML/JSON, checked by a script | ✅ | `sources.json` (feeds pack `sources`) |
| 3 | Parsing | Python | ✅ | Normalised token tables (CSV/JSONL), CRLF and NFC handled |
| 4 | Cleaning | Python, rules in config | ✅ | Tokens with reject reasons (digit, symbol, initials, OCR list, foreign list) |
| 5 | Duplicate detection | Python | ✅ | Case, accent and punctuation groups; variant candidates |
| 6 | Lemma and inflection analysis | Python + Wiktionary/Kaikki forms, Open English WordNet exceptions, AGID | ✅ | form → (lemma, part of speech); summed lemma frequency |
| 7 | Part-of-speech assignment | Python: lexicon + CEFR-J/Octanove; Google tags as weak evidence | ✅ | (lemma, part of speech) candidates |
| 8 | Frequency aggregation | Python + `wordfreq` (in the pipeline's own virtual environment, not an app dependency) | ✅ | wordfreq Zipf (primary), Google rank (secondary), gap flag |
| 9 | Candidate scoring | Python: gates and tiers (§7) | ✅ | Candidates with tier and reason |
| 10 | Candidate selection | Python, cut-offs calibrated in config | ✅ | `candidates.csv`, about 18–22k rows for review |
| 11 | CEFR enrichment | Python join (listed) + AI estimate for unlisted | Listed ✅ / estimate cached | `cefr` with source and certainty |
| 12 | pt-PT translation | AI (structured output, batches of about 20–50 entries, one entry's data per item) | Cached | Draft translations per sense |
| 13 | Definitions | AI, drafting from Open English WordNet/Wiktionary glosses | Cached | Learner definitions |
| 14 | Topic classification | AI constrained to the fixed topic list | Cached | Topics |
| 15 | Example sentences | AI-assisted, original sentences | Cached | Contexts with one gap |
| 16 | Accepted answers | Deterministic checks (`matchVocabularyAnswer`, forms and variants consistency) + review | ✅ checks | Accepted lists |
| 17 | Quality review | Human (sampling by band; all A1–B1) | — | `review` status |
| 18 | Schema validation | **TypeScript, reusing `vocabularyPackSchema` from `@ldg/shared`** | ✅ | Pass/fail report |
| 19 | Pack generation | TypeScript: split, stable sort by ID, minified JSON, catalogue entry | ✅ | Packs + `index.json` |

**Reproducibility:**

- Pinned input checksums, a versioned config, and stable sort keys (rank, then lemma by code point).
- AI outputs are stored as reviewed artefacts, keyed by entry id + input hash + prompt version + model id. A rerun reuses the cache, so identical inputs and config produce identical packs; only changed items call the model.
- No stage sends whole lists to a model.

**Optional, if part-of-speech shares or real book counts become necessary:** regenerate the Google 2012 1-gram statistics *with counts* by streaming the raw files, as the original scripts do. They are large (`a` 343 MB, `s` 444 MB, `e` 205 MB, `t` 265 MB compressed; several GB for all 26 letters, estimated), but streaming needs no local storage beyond the output.

---

## 14. Proposed 15,000–20,000-entry selection strategy

**Indicative candidate pool (estimate).** After dropping non-plain tokens, single letters, Roman numerals and probable names or acronyms, then folding regular inflections:

| Top N tokens | Plain common tokens | After the inflection fold |
| ---: | ---: | ---: |
| 20,000 | 17,734 | 12,152 |
| 30,000 | 25,851 | 17,626 |
| 50,000 | 41,197 | 28,381 |
| 100,000 | 75,912 | 53,933 |

A 15–20k selection therefore needs a pool drawn from roughly the **top 50k–100k** tokens, because review will reject many rare or specialist lemmas and everyday items sit deep in the list. This is why the recommendation is the 100k files, not the 20k ones.

**Indicative first catalogue.** These are entry counts for planning, **not quotas**; final numbers follow quality.

| Band or type | Entries (indicative) | Why |
| --- | ---: | --- |
| A1–A2 core | 2,000–2,600 | CEFR-J lists 2,575 A1–A2 rows; a small closed core; all three modes; fully reviewed |
| B1–B2 | 5,000–6,000 | CEFR-J lists 5,224 B1–B2 rows; this is where vocabulary grows fastest and this learner's B2→C1 goal sits |
| C1–C2 | 4,000–6,000 | Octanove lists 2,136; the rest are estimated from frequency + review; open-ended and topic-dependent, so selective |
| Academic and professional | 1,000–2,000 | NAWL-type academic vocabulary, workplace language; overlaps the bands above |
| Phrasal verbs, idioms, collocations, fixed phrases | 1,500–3,000 | Absent from this repository. Sourced from CEFR-J/Octanove multiword headwords (153), Wiktionary categories and AI proposals, checked against Google 2-/3-gram or wordfreq evidence |
| **Total entries** | **≈ 15,000–19,000** | Senses ≈ 1.2–1.4 × entries; contexts ≥ 1 per sense where a good sentence exists |

**Why not equal distribution:**

- A-level vocabulary is small and critical, so every item must be complete and reviewed.
- B-level vocabulary is the bulk of independent use.
- C-level vocabulary is long-tailed: more entries, but each matters less, so selection is stricter.
- Multiword expressions are disproportionately useful at B2–C1, the learner's level, and deserve a dedicated share.

---

## 15. Risks and unresolved questions

| Risk or question | Impact | Mitigation |
| --- | --- | --- |
| Share-alike obligations (wordfreq, Wiktionary, Octanove, NGSL) | Packs must be CC BY-SA 4.0 | Decide the pack licence before the import (§9) |
| CEFR-J redistribution scope | Legal uncertainty | Ask the CEFR-J project; cite properly |
| SUBTLEX-US terms | Cannot be used directly | Only through wordfreq |
| Books-only, pre-2008 bias | Wrong priorities | wordfreq as the primary signal; topic fill tier |
| Lemmatisation errors | Duplicate or merged entries | Lexicon-driven mapping; review of high-frequency forms |
| Part-of-speech noise | Wrong entries | Never use the repository's category lists as truth |
| Sense granularity | Translations fused across meanings | Senses chosen per learner relevance (≤ 3 for most entries) |
| AI enrichment quality and pt-PT vs pt-BR | Wrong translations taught | Human review; pt-PT checklist; `review` status shown |
| Scale of human review (15k entries) | Time | Review A1–B1 fully, sample B2–C2 by band, ship by band |
| Pack size and Zod validation cost | Slow Library | Split packs (§11) |
| Library browses one pack at a time | UX limits | Multi-pack Library in the import milestone |
| wordfreq frozen at 2021 | Recent words missing | Acceptable; add curated items by topic |

---

## 16. Final recommendation

Use `top-english-wordlists` as **one input**, not the foundation. Build the catalogue on a small, licence-checked stack:

- **frequency:** wordfreq (primary) and Google 2012 (secondary);
- **lemmas, forms and variants:** Open English WordNet, Wiktionary/Kaikki and SCOWL/VarCon;
- **levels and coverage:** CEFR-J, Octanove and NGSL/NAWL.

Selection uses transparent gates and tiers, and enrichment is AI-assisted with recorded review. Packs are licensed CC BY-SA 4.0, generated and validated against the existing Zod contract, and split by band.

### Direct answers

1. **Is `top-english-wordlists` a suitable foundation?** As a raw candidate pool and a written-frequency signal, yes: it is clean, permissively licensed and reproducible. As *the* foundation, no. It is book-only (1950–2008), token-based, noisy, lacks multiword expressions and counts, and its part-of-speech lists are not classifications.
2. **Which exact files?**
   - `top_english_words_lower_100000.txt`: ranking and candidate pool.
   - `top_english_words_mixed_100000.txt`: case evidence for names and acronyms.
   - Optionally `top_english_{nouns,verbs,adjs}_lower_100000.txt` and `top_english_advs_lower_10000.txt`, only as weak "can be this part of speech" hints.
   - Not the 500k/1M files (noise), and not the 500-entry closed-class lists.
3. **Combine the general list with the category lists?** Only as weak evidence. Never derive entries or the part of speech from them: they include "the" as an adjective and "children" as a verb. Take the part of speech from a lexicon and CEFR-J/Octanove.
4. **Supplement with another frequency corpus?** Yes: **wordfreq** as the primary, multi-genre signal (subtitles, web, news). SUBTLEX-US only through wordfreq. OANC is optional.
5. **Is 15,000–20,000 entries realistic and useful?** Yes, counted as lemma + part of speech or multiword entries, with about 1.2–1.4 senses each and forms not counted. The source pool supports it (§14). Let quality set the final number; about 15–17k is a sensible first release.
6. **Most important cleaning steps:**
   - drop artefacts: initials, digits, symbols, URLs, OCR errors, foreign fragments;
   - detect names and acronyms by case ratio, keeping legitimate capitalised vocabulary;
   - map forms to lemmas using a lexicon;
   - link British/American variants;
   - add multiword expressions from other sources;
   - de-duplicate case, accent and punctuation variants.
7. **What must be added before entries can power the three exercises:**
   - lemma, part of speech, forms and variants (for all three modes and the wrong-form check);
   - senses;
   - **Spelling:** pt-PT translations;
   - **Definition:** learner definitions;
   - **Context:** original context sentences with one gap, the exact answer form and accepted alternatives;
   - register, topics, CEFR with provenance, and review status.
8. **Order of implementation:**
   1. Acquisition and manifest.
   2. Parse and clean.
   3. Lemma, part of speech and variant join.
   4. Frequency aggregation.
   5. Gates and tiers into a reviewed candidate list.
   6. Pack schema v2 decisions (review status, topics, source metadata).
   7. An enrichment **pilot** on about 300–500 A1–B1 entries, to measure quality and cost.
   8. Scale enrichment band by band.
   9. TypeScript validation and pack generation.
   10. Multi-pack Library support in the app.
9. **Licensing requirements to preserve:**
   - **Google Books Ngram 20120701 and `top-english-wordlists`:** CC BY 3.0. Credit, licence link, changes; the block in §9.
   - **wordfreq, Wiktionary, Octanove, NGSL:** CC BY-SA 4.0, so the packs become BY-SA with attribution.
   - **Open English WordNet:** CC BY 4.0, crediting both Princeton WordNet and the Open English WordNet team.
   - **CEFR-J:** citation, plus confirmation of the redistribution scope.
   - **SCOWL:** its Copyright notice.
   - **Every source:** name, URL, revision, access date and transformation recorded in the manifest and the pack `sources`.
10. **Next milestone: "Vocabulary candidate pipeline: deterministic stage".**
    - **Builds:** a reproducible Python pipeline (outside the app runtime) covering stages 1–10. It produces `candidates.csv` with provenance, reject reasons, tiers and signals, a coverage report, and a short licence decision record (pack licence; CEFR-J query).
    - **Excludes:** AI enrichment, app changes and pack import.
    - **Followed by:** the enrichment pilot and schema v2.

---

### Sources

- Repository: https://github.com/david47k/top-english-wordlists (commit `b7585f3`)
- Google Books Ngram datasets (licence, format, versions): https://storage.googleapis.com/books/ngrams/books/datasetsv3.html
- Google Books Ngram Viewer info and FAQ (tags, POS accuracy, tokenisation): https://books.google.com/ngrams/info
- Google 2012 totals: http://storage.googleapis.com/books/ngrams/books/googlebooks-eng-all-totalcounts-20120701.txt
- Lin et al. 2012: https://aclanthology.org/P12-3029/
- CC BY 3.0: https://creativecommons.org/licenses/by/3.0/ · CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/
- CEFR-J / Octanove: https://github.com/openlanguageprofiles/olp-en-cefrj (commit `d4e45b7`)
- wordfreq: https://github.com/rspeer/wordfreq and its `SUNSET.md`
- SUBTLEX-US: https://www.ugent.be/pp/experimentele-psychologie/en/research/documents/subtlexus/overview.htm
- OANC: https://anc.org/data/oanc/
- NGSL: https://www.newgeneralservicelist.com/new-general-service-list
- Open English WordNet: https://github.com/globalwordnet/english-wordnet
- Wiktionary copyrights: https://en.wiktionary.org/wiki/Wiktionary:Copyrights · Kaikki: https://kaikki.org/
- SCOWL: https://github.com/en-wl/wordlist
