# Vocabulary data pipeline

Offline tooling that turns raw English frequency lists and lexical references into a **reviewable list of vocabulary candidates**, and a **human-review proposal** for the enrichment pilot, for the future Linguas de Gato library. It is isolated from the app: the app never imports it, it never imports the app, and it adds no JavaScript dependency.

Pipeline version 0.1.0. Python ≥ 3.11 (tested with 3.11.9).

## 1. What it does

1. Verifies each input against the checksum pinned in the source register (`sources/manifest.json`).
2. Reads the sources enabled for the chosen **profile** (§2).
3. Builds one candidate per normalised spelling from the top N of each frequency source.
4. For each candidate, records:
   - every observed spelling;
   - per-source ranks and values (never added together across sources);
   - lexical and morphological analyses with their evidence;
   - parts of speech and where they come from;
   - spelling variants and capitalisation evidence;
   - flags and an **evidence level** (§9);
   - an explicit status: **retained**, **excluded** (with a machine-readable reason) or **folded** (a confirmed form attached to its lemma).
5. Writes deterministic CSV and JSON, a quality report, an attribution file and a run manifest.
6. From a redistributable run, proposes a stratified selection for the enrichment pilot (§7).

## 2. Two profiles

| | Profile A: restricted analysis | Profile B: redistributable research |
| --- | --- | --- |
| Configuration | `config/pipeline.json` (the default) | `config/redistributable.json` |
| Sources | wordfreq, Google Books top lists, Open English WordNet, ESDB | Google Books top lists (CC BY 3.0) and Open English WordNet (CC BY 4.0) only |
| Primary ranking | wordfreq (multi-genre) | Google Books rank |
| Morphology | Open English WordNet + ESDB | Open English WordNet only |
| Outputs | `output/restricted/…`, distribution **restricted** | `output/redistributable/…`, distribution **attribution** |
| Use | Local research and comparison; never committed, published or shipped | Candidate research that may be shared with attribution, and the pilot proposal |

How the separation is enforced:
- **Source register:** each source lists the profiles it may be used in. Restricted sources (`approved_internal`) can never list `redistributable`.
- **Configuration checks:** a configuration is refused if it enables a source outside its profile. The pipeline checks again at run time and only calls the loaders of allowed sources, so the redistributable profile never imports wordfreq or opens the ESDB database.
- **Output folders:** a run can only be written under `output/<its profile>/`, never into an existing folder.
- **Validation of redistributable runs:** `validate` fails if any frequency source outside the run's approved sources appears, if any ESDB evidence appears, if restricted package versions are listed, or if any output mentions a restricted source (`wordfreq`, `zipf`, `esdb`, `subtlex`, `opensubtitles`).
- **Attribution:** the attribution file lists exactly the sources the run used. No single licence is claimed for a combination; each source keeps its own.

## 3. What it deliberately does not do

- It does **not** produce translations, definitions, example sentences, accepted answers, topics or CEFR levels. These fields exist only as explicit `null`s with `"status": "not_started"`, and `validate` fails if anything fills them.
- It does **not** set a lemma from suffix rules. A suffix rule only ever produces a `possible_regular_inflection` flag.
- It does **not** merge British and American spellings, accented and unaccented spellings, or different parts of speech. It links and flags them.
- It does **not** fold an ambiguous word.
- It does **not** treat absence from a source as evidence.
- It does **not** download or build anything during a run.
- It does **not** delete questionable words. Flags never exclude; exclusions keep the record and its reason.

## 4. Install and acquire the sources

```bash
cd tools/vocabulary-data
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-wordfreq.txt     # Windows
.venv/bin/python -m pip install -r requirements-wordfreq.txt         # macOS / Linux
```

The core and the tests use only the standard library. `requirements-wordfreq.txt` pins wordfreq 3.1.1 and every transitive dependency; it is only needed for Profile A.

In the examples below, `python` means the environment's interpreter, run from `tools/vocabulary-data`.

```bash
python -m vocabulary_data check-sources                                   # Profile A: register, config, local checksums
python -m vocabulary_data --config config/redistributable.json check-sources
python -m vocabulary_data fetch --all                                     # Google lists and Open English WordNet into raw/
```

- **`fetch`:** downloads only pinned URLs, verifies each SHA-256 and never overwrites a file. **wordfreq** is installed as the pinned package; `check-sources` verifies its data file.

**ESDB (Profile A only) is built by a person, never by this tool.** Its build runs the upstream project's own Python code, so it is a deliberate manual step:

```bash
git -c core.autocrlf=false clone --depth 1 --branch rel-2026.02.25 https://github.com/en-wl/wordlist.git esdb-src
mkdir esdb-build && cp -r esdb-src/combine.py esdb-src/libscowl esdb-src/data esdb-build/
cd esdb-build
env -i PATH="$PATH" SYSTEMROOT="$SYSTEMROOT" python -I -X utf8 combine.py create-db scowl.db
# then copy scowl.db to tools/vocabulary-data/raw/esdb-2026.02.25/scowl.db
```

Notes on the build:
- **Line endings:** `core.autocrlf=false` keeps the published bytes, so the register's input checksums match.
- **UTF-8 mode:** `-X utf8` is needed on Windows, because `combine.py` opens files with the platform's default encoding.
- **What was reviewed:** statically, before the first build. The script uses only the standard library and SQLite, reads only `data/*` and its own `libscowl/*.sql`, writes only the new `scowl.db` (and refuses to overwrite one), and reads three environment variables (`SCOWL_OPTS`, `SCOWL_DB`, `SCOWL_DEBUG_SQL`). It makes no network access, starts no subprocesses and loads no extensions.
- **Duration:** about 2 minutes 15 seconds, with 26 upstream warnings ("could not find match: skipping group" in `data/compounds-auto`).
- **Pinning:** SQLite files differ byte-wise between builds, so the register pins the **content** checksum (the SHA-256 of the database's SQL dump). Two independent builds matched.

## 5. Run, validate, compare

```bash
python -m vocabulary_data run --out r1                                             # -> output/restricted/r1
python -m vocabulary_data --config config/redistributable.json run --out d1        # -> output/redistributable/d1
python -m vocabulary_data validate output/redistributable/d1
python -m vocabulary_data compare output/redistributable/d1 output/redistributable/d2
python -m unittest discover -s tests -t .
```

What each command does:
- **`--out`:** takes a run name (placed under the profile's folder) or a path inside it.
- **`validate`:** checks:
  - output checksums against the run manifest;
  - that the CSV and JSON list the same candidates in the same order;
  - statuses, ranks and evidence levels;
  - attribution;
  - profile isolation;
  - that no machine path appears and nothing is invented.
- **`compare`:** checks that two runs produced byte-identical deterministic outputs.

Each run writes:

| File | Content |
| --- | --- |
| `candidates.csv` / `candidates.json` | One record per candidate, ordered by `combined_rank` (JSON: header plus one candidate per line). |
| `quality-report.md` / `.json` | Evidence levels, counts, flags, exclusion reasons, coverage, morphology (Profile A), samples. |
| `ATTRIBUTION.md` | The sources used, their licences and attribution, the run's distribution status. |
| `run-manifest.json` | Profile, execution date, Python and dependency versions (Profile A), config and register checksums, input checksums, output checksums. The only non-deterministic file. |

## 6. Configuration

The fields of `config/*.json`:
- **`profile`:** `restricted` or `redistributable`.
- **`sources.<id>`:** `enabled`, `pool_top_n` (how many top forms each frequency source contributes to the pool), and file names.
- **`ranking`:**
  - **`method`:** `primary` orders by the primary source's rank, then the secondary's, then the word. `mean_log_rank` uses the geometric mean of the ranks, with equal weights and no calibration; it is offered for comparison only.
  - **Missing words:** a word missing from a ranked list gets the rank just past its end, marked `rank_censored`.
  - **Folded forms:** a lemma with folded forms is ranked on its summed wordfreq frequency (Profile A) or the group's best Google rank. Both values are kept beside the lemma's own.
- **`flags`:**
  - case ratios for names and acronyms;
  - `low_frequency_zipf` (wordfreq only);
  - single letters kept;
  - lexicographer files whose capitalised words are ordinary vocabulary;
  - foreign function words and OCR artefacts;
  - the bases of "'s" contractions.
- **`exclusions.<reason>`:** turn each exclusion rule on or off.
- **`pilot`** (redistributable only):
  - rank bands and core entries per band;
  - the number of irregular lemmas and spelling-variant pairs;
  - the size of each review group.

## 7. The pilot proposal

```bash
python -m vocabulary_data --config config/redistributable.json propose-pilot --run d1 --out pilot-1
python -m vocabulary_data crosscheck-pilot --pilot pilot-1 --run r1 --out crosscheck-1    # restricted, local only
```

`propose-pilot` reads **only a redistributable run** (it refuses anything else) and writes:
- `pilot-proposal.json` / `.csv`;
- `pilot-report.md` / `.json`;
- `ATTRIBUTION.md` and `pilot-manifest.json`.

**What it represents:** a stratified selection for human review, made by evenly spaced picks inside each group and rank band. The groups are:
- core dictionary forms, by rank band;
- lemmas with explicit irregular forms;
- British/American pairs (both members);
- a review group: capitalised ordinary words, acronyms that are dictionary entries, common words that are also names, and explicitly ambiguous forms.

Every entry carries:
- its candidate id and surface form;
- the proposed dictionary form or its readings;
- its parts of speech and their source;
- its Google rank and band;
- its group and the reason it was included;
- its morphology evidence and flags;
- potential false-positive signals;
- its licensing status, per source;
- `review_status: pending_human_review`.

**What it does not represent:** production-ready content, verified linguistics, or a final count. It excludes:
- unverified inflections;
- words without lexical evidence (including function words);
- likely names and abbreviations;
- possible foreign tokens;
- candidates with potential false-positive signals, which are listed in the report.

If a group has fewer eligible candidates than requested, the shortfall is reported and nothing is padded.

`crosscheck-pilot` looks up each proposed entry in a restricted run (ESDB readings, everyday frequency) to help reviewers. Its output is restricted, stays under `output/restricted/`, and never feeds back into the proposal.

## 8. Sources and licences

The source register records, for every source evaluated:
- name, URL, publisher, exact version, access date;
- licence with the evidence it was read from;
- the licence questions (commercial use, modification, redistribution, attribution, share-alike);
- status, distribution, profiles, attribution, role and limitations.

| Source | Status / profiles | Licence | Role |
| --- | --- | --- | --- |
| `google-books-top-wordlists` (commit b7585f3) | approved · A, B | CC BY 3.0 (README; Google's dataset page) | Book rank, capitalisation evidence |
| `oewn-2025` | approved · A, B | CC BY 4.0; credit Princeton WordNet and the Open English WordNet team | Lemmas, parts of speech, irregular forms, spelling variants |
| `wordfreq` 3.1.1 | approved_internal · A | Apache-2.0 code; CC BY-SA 4.0 data built from several corpora | Everyday frequency |
| `esdb-2026.02.25` (ESDB, formerly SCOWLv2; tag rel-2026.02.25, commit 7e99eda) | approved_internal · A | ESDB/SCOWL permission notice with conditional notices | Explicit inflections, parts of speech for function words, spelling variants |
| `cefr-j-octanove` | deferred | CEFR-J custom terms; Octanove CC BY-SA 4.0 | CEFR (out of scope) |
| `subtlex-us` | rejected | unclear | Reaches the pipeline only through wordfreq |
| `wiktionary-kaikki` | deferred | CC BY-SA 4.0 / GFDL | Future forms, labels and translation hints |

**Why wordfreq is restricted:** its data is CC BY-SA 4.0, built from several corpora, and its README states that converting it to CSV "does not follow the CC-By-SA license", because attribution is lost.

**Why ESDB is restricted:** its Copyright file grants broad permission, but for "results from the database that is not a speller dictionary or generated word list" it says the UKACD and Australian notices "may apply depending on the parts you use", and that the WordNet licence "MIGHT apply" to part-of-speech information. Some data also comes from COCA under an NDA. Which records carry which notice is not documented. Lemma relationships, inflection mappings and parts of speech are exactly that kind of result, so until the author clarifies:
- ESDB-derived fields (`lemma_analyses` relations `esdb_*`, ESDB parts of speech, ESDB-based folding and variant links) stay in restricted outputs;
- they are excluded from Profile B and from the pilot proposal.

This is a statement of uncertainty, not legal advice.

**To add a source:**
1. Add a register entry with every field, verified from a primary source, with pinned inputs and its profiles.
2. Write an adapter, load it in `pipeline.py`, and add its id to `CONFIG_SOURCES`.
3. Enable it in the right profile's config.
4. Add tests, then run, validate and compare.

## 9. Reading the report

**Evidence levels.** No candidate is linguistically verified.

| Level | Meaning |
| --- | --- |
| `automatically_confirmed` | A source lists the spelling as a dictionary form, or as an explicit form of one, with a single reading, and no attention flag was raised. Folded forms count here. |
| `source_confirmed_needs_review` | The same, but an attention flag needs a human look (acronym, capitalisation, not in Open English WordNet…). |
| `ambiguous` | Several readings: a dictionary form and a form of another word, several lemmas, a form that is also listed as a word. |
| `no_evidence` | No source establishes a dictionary form (includes suffix-only suggestions). |
| `excluded` | A non-lexical token, with its reason. |

**Morphology (Profile A).** A regular form is confirmed, and folded, only when all three hold:
- ESDB lists it as a form of exactly one lemma;
- WordNet's rules give that same lemma, which Open English WordNet has;
- neither source lists the form as a word in its own right.

Everything else follows these rules:
- **Several lemmas, or the form also listed as a word:** ambiguous, flagged `inflection_needs_review`.
- **Minor readings** (archaic, uncommon or "no longer used" in ESDB, e.g. "went" as the past of "wend"): recorded, but they never create ambiguity on their own.
- **ESDB lists only the form itself, with no derived reading:** the suffix suggestion is marked `suggestion_contradicted`.
- **Absent from ESDB:** proves nothing.

**Flags, disagreement, duplicates and samples:** as described in the report itself. Counts are not evidence of quality; read the samples.

## 10. Reproducing a run

1. Check out the commit whose `sources/manifest.json` and config match the checksums in `run-manifest.json`.
2. Recreate the environment from `requirements-wordfreq.txt`, and compare with `dependencies` (Profile A).
3. Acquire the sources (§4) and run `check-sources`. Every input must verify, including ESDB's content checksum.
4. Run into a new folder, then `compare` with the old run or check the `outputs[].sha256` values.

## 11. Known limitations

- **Profile B has no explicit regular-inflection source:** "books" or "walked" stay unresolved there, so they are excluded from the pilot rather than merged.
- **Function words lack a part of speech in Profile B** (the, of, which, would); ESDB provides them in Profile A only.
- **No multiword expressions or hyphenated compounds come from the frequency sources.** Open English WordNet holds 53,060 multiword lemmas for a later stage.
- **Profile B's ranking comes from printed books (1950–2008):** everyday and recent words are under-ranked or missing; smartphone is not in the top 100,000.
- **The 2025 base edition of Open English WordNet omits most proper nouns:** names are flagged by capitalisation evidence.
- **Spelling-variant links are deliberately strict:** plough/plow is missed. They can be sense-specific; see `shared_synsets`.
- **ESDB relations are about spelling, not meaning:** sense notes are rare ("media" → "medium" only in the communication sense).

## 12. From candidates to app packs (later; nothing in the app changes now)

A reviewed pilot entry maps onto the app's pack contract (`packages/shared/src/contracts/vocabulary-pack.ts`):
- `id` comes from the reviewed lemma and part of speech;
- `forms` from folded and confirmed forms;
- `variants` from spelling variants checked per sense;
- `frequency` from a redistributable rank only.

CEFR, topics, senses, translations, definitions, contexts and accepted answers come from the enrichment pilot, with provenance.

Recommended format additions (not made):
- a per-sense review status and provenance;
- source revision, access date and transformation fields;
- form variants as arrays;
- a `general` topic;
- packs split by band.

## Candidate fields

| Field | Meaning |
| --- | --- |
| `candidate_id` | `en:` + normalised form; stable while normalisation rules are unchanged. |
| `surface_form`, `normalized_form`, `surface_forms` | Display spelling, join key (NFC, lower case, unified apostrophes and hyphens), every observed spelling. |
| `candidate_kind`, `candidate_status` | `word` / `inflected_form` / `non_lexical_token`; `retained` / `excluded` / `folded`. |
| `exclusion_reasons` | contains_digit, initial, non_letter_symbol, single_letter, roman_numeral, ocr_artefact, clitic_fragment, possessive_form. |
| `folded_into`, `folded_forms`, `fold_basis` | The lemma a confirmed form was attached to, and on what basis (`oewn_explicit_form`, `esdb_derived_form+morphy`). |
| `lemma`, `lemma_status`, `evidence_level` | Set only when established; see §9. |
| `lemma_analyses` | Every reading with its relation, part of speech and evidence: `is_lemma`, `explicit_form`, `possible_regular_inflection`, `possible_accent_variant`, and in Profile A `esdb_derived_form` (form type, sense note, minor) and `esdb_lemma`. |
| `part_of_speech`, `part_of_speech_status` | Parts of speech, and the source ids they come from (or `unknown`). |
| `lexicon_lemmas`, `lexfiles`, `spelling_variants` | Matching lexicon spellings, lexicographer files, variants with their evidence. |
| `source_ids`, `source_coverage`, `frequency.<source>` | Where the form was observed; rank, censoring, value, `with_folded_forms`. |
| `combined_rank`, `retained_rank`, `frequency_disagreement`, `capitalization` | Ordering, book-versus-everyday disagreement (Profile A), capitalisation evidence. |
| `flags`, `origin`, `review_status`, `enrichment` | See `vocabulary_data/candidates.py`; `review_status` is always `unreviewed`; `enrichment` is all `null`. |
