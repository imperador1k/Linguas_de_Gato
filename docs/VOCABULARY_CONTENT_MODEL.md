# Vocabulary content model — proposal

A proposal for the reviewed vocabulary content that will eventually feed the app. It does **not** change the current pack contract (`packages/shared/src/contracts/vocabulary-pack.ts`) or the database schema.

**Status: three layers, kept distinct.**

| Layer | State |
| --- | --- |
| This conceptual model | Language-neutral: nothing below is specific to English. It is a design, not an implementation. |
| The data pipeline (`tools/vocabulary-data`) | English-only today, through its English adapters, sources and rules (§8). The 400-entry pilot and its review package are English-only (target language `en`). |
| The app contracts (pack format, database) | English-only today, with Portuguese (Portugal) as the only support language. The changes needed for several languages are listed in §9 and are **not** made. |

French, Spanish or any other language would need their own sources, licence decisions, adapters, reviews and the app changes in §9.

## 1. The units and how they relate

```
Candidate (pipeline, one per spelling, per target language)
   │  reviewed into 0..n
   ▼
LexicalEntry  = target language + lemma + part of speech
   ├── inherent features   e.g. grammatical gender of a noun (none in English)
   ├── Form 0..n           inflected forms, each described by morphological features
   ├── Variant 0..n        other spellings, each with the varieties (locales) it belongs to and the senses it covers
   ├── Pronunciation 0..n  per variety, with its source and licence
   └── Sense 1..n          one meaning
         ├── Definition 0..n          learner-friendly, each in a stated language
         ├── Translation 0..n         separate records, per support language (§5)
         ├── ExerciseExample 0..n     an original sentence with one gap → the Form it needs
         ├── usage: register, address/politeness, regional scope, notes
         └── review status, provenance per field

Separate from lexical identity (§6):
   LevelRecommendation   (sense × scheme × context, with evidence)
   CurriculumPlacement   (sense × curriculum unit, decided by curriculum design)
```

- **Candidate:** a spelling found by the pipeline, with its evidence and flags. Nothing in it is final, and it never reaches the app.
- **LexicalEntry:** what a reviewer approves. One per target language, lemma and part of speech. A candidate can produce several entries or none.
- **Form:** an inflected form, described by a **set of features**, not by English labels like "past" or "plural".
- **Variant:** another accepted spelling, tied to the varieties (locales) where it is standard and, where needed, to specific senses.
- **Sense:** one meaning a learner must keep apart. Definitions, translations, examples, usage and level recommendations attach to senses, never to the bare word.
- **ExerciseExample:** an original sentence for one sense, with one gap. It points to the Form the gap needs, plus answers that are genuinely correct there.

The learning unit stays **lemma + part of speech + sense**.

## 2. Languages: four different roles

| Role | Meaning | Where it lives | Example tags (BCP 47) |
| --- | --- | --- | --- |
| Target language | The language being learned | `LexicalEntry.language`, packs | `en`, `fr`, `es` |
| Target variety | A regional or national standard, where it matters | Variants, pronunciations, examples, usage scope | `en-GB`, `en-US`, `fr-FR`, `fr-CA`, `es-ES`, `es-MX` |
| Support language | The language of explanations and translations | `Translation.language`, `Definition.language` (when not the target) | `pt-PT`, `en`, `es-ES` |
| Interface language | The app's own UI text | App settings and message catalogues, never content records | `pt-PT`, `en` |

Rules:
- **Tag format:** tags are BCP 47 (language, optional script and region).
- **The lemma has no locale:** an entry belongs to a target *language*. Varieties are attributes of variants, pronunciations, examples and senses (e.g. "only in `en-GB`").
- **No fixed support language:** Portuguese (Portugal) is the first one, not the only one. A learner of French through English, or of English through Spanish, uses the same records with a different support language.
- **Interface language is independent** of both target and support languages.

## 3. Record shapes

Angle-bracket values are placeholders, not content. Field names are illustrative.

```jsonc
// LexicalEntry
{
  "entry_id": "en:book:VERB",            // target language + lemma + part of speech; stable
  "language": "en",                       // target language (BCP 47)
  "lemma": "book",
  "upos": "VERB",                         // Universal Dependencies part of speech (§4)
  "kind": "word",                         // word | multiword | idiom | collocation | ...
  "features": {},                         // inherent lexical features, e.g. {"Gender": "Fem"} for a French noun
  "candidate_ids": ["en:book"],           // traceability to pipeline candidates (pipeline-side)
  "forms": [ /* Form */ ],
  "variants": [ /* Variant */ ],
  "pronunciations": [ /* Pronunciation */ ],
  "senses": [ /* Sense */ ],
  "frequency": [ { "source_id": "<redistributable source>", "rank": 0 } ],
  "review": { "status": "approved", "decision": "split_by_pos", "reviewer": "<id>", "reviewed_at": "<date>" },
  "history": [ /* EditorialEvent */ ]
}

// Form: features, not English labels
{ "form": "booked", "features": { "VerbForm": "Fin", "Tense": "Past" }, "varieties": [], "evidence": { "kind": "lexicon | review", "source_id": "<id>" } }

// Variant
{ "spelling": "colour", "varieties": ["en-GB", "en-AU", "en-CA"], "sense_ids": [], "evidence": { "source_id": "<id>" } }   // empty sense_ids = all senses

// Pronunciation
{ "variety": "en-GB", "ipa": "<IPA>", "audio": { "file": "<path>", "licence": "<licence>", "speaker": "<id>" }, "source_id": "<id>" }

// Sense
{
  "sense_id": "s1",
  "gloss": "<short reviewer gloss>",
  "definitions": [ { "language": "en", "text": "<learner-friendly definition>", "review": "<status>", "provenance": { /* … */ } } ],
  "examples": [ { "example_id": "c1", "sentence": "<sentence with ___>", "answer_form": "booked", "accepted": [], "variety": null, "provenance": { /* … */ } } ],
  "usage": { "register": "neutral", "address": null, "varieties": [], "notes": [] },
  "topics": ["<topic>"],
  "review": { "status": "draft | reviewed | approved | rejected" },
  "provenance": { "gloss": { "origin": "editorial", "created_at": "<date>" } }
}

// Translation: its own record, scoped to one sense and one support language (§5)
{
  "translation_id": "en:book:VERB#s1@pt-PT#1",
  "entry_id": "en:book:VERB", "sense_id": "s1",
  "language": "pt-PT",                     // support language
  "text": "<translation>",
  "is_primary": true,
  "context_note": "<when this translation applies>",
  "usage": { "register": null, "varieties": [] },
  "review": { "status": "draft" },
  "provenance": { "origin": "editorial | source | ai_draft", "source_id": null, "created_at": "<date>" }
}

// LevelRecommendation: separate from lexical identity (§6)
{ "entry_id": "en:book:VERB", "sense_id": "s1", "scheme": "CEFR", "level": "<level>", "context": { "support_language": null, "goal": null },
  "source_id": "<source or editorial>", "certainty": "listed | estimated | editorial", "evidence": "<why>", "review": { "status": "draft" } }

// EditorialEvent
{ "at": "<date>", "actor": "<reviewer or process>", "action": "create | edit | review | split | merge | reject", "target": "<record id>", "fields": ["text"], "note": "<why>" }
```

Each record has its own `review` and `provenance`. A translation can be approved while a definition of the same sense is still a draft.

## 4. Morphology without English assumptions

Universal Dependencies (UD) is used as a **shared foundation**: common tag and feature names, so languages describe similar things the same way. It is not a complete universal grammar. Each language uses the subset of features it actually has, adds documented language-specific features where UD falls short, and may need its own analyses (e.g. clitics, separable verbs).

- **Parts of speech** use the Universal Dependencies UPOS tag set: `NOUN`, `VERB`, `ADJ`, `ADV`, `PRON`, `DET`, `ADP`, `AUX`, `CCONJ`, `SCONJ`, `NUM`, `PART`, `INTJ`, `PROPN`.
  - **Display:** the learner-facing labels ("noun", "verb", ...) are a presentation concern.
  - **Multiword expressions** are an entry `kind`, not a part of speech.
- **Forms and inherent properties** use UD features: `Gender`, `Number`, `Person`, `Tense`, `Mood`, `VerbForm`, `Aspect`, `Polite`, `Definite`, `Degree`, `PronType`, and so on.
  - **Language-specific features** are allowed with a language prefix and must be documented per language. Examples: `es:StemChange: "e>ie"`; `fr:Elision: true` for forms like `l'`.
- **No mandatory per-language fields.** A form is a spelling plus a feature set. English simply has fewer features (no gender, few verb forms), and a language never has to fill fields it does not have.
- **Paradigms** (full conjugation or declension tables) are optional and per language. A future generator can produce them from a language-specific morphology adapter, but entries must not require them.
- **Elision, contraction and clitics** are forms of the words involved, described by features:
  - French `l'`, `j'` (the elided forms of `le`/`la`, `je`);
  - Spanish `del` = `de` + `el`;
  - attached clitics, as in Spanish `dímelo`.

  They are not new lemmas, and exercises must accept exactly the forms the sentence needs.

## 5. Translations are not word-to-word mappings

- **Scope:** each translation belongs to **one sense** and **one support language**. Different senses of the same lemma get unrelated translations ("bank" of a river vs for money).
- **Several per sense:** a sense can have several translations, with one marked primary, each with a context or usage note, a register and varieties ("in Brazil", "formal").
- **Own review and provenance:** a translation has its own review status and provenance. AI drafts are marked as drafts.
- **More support languages later** add records; they never change the entry or the sense.

## 6. Levels and pedagogy are separate from identity

- **Not part of identity:** lexical identity (language, lemma, part of speech, sense) carries no level.
- **Where levels live:** `LevelRecommendation` records attach to a sense, name their scheme (CEFR or other), their source and certainty, their evidence, and optionally the context (learner goal, support language). One sense may have several, and each is reviewed separately.
- **Curriculum placement** (which unit teaches which sense) belongs to curriculum design and may differ per curriculum and language pair.
- **Frequency is never a level.** It is evidence for selection only.

## 7. Conceptual examples

Structure only: no translations or definitions are written here.

**English (`en`).**
- *book* is two entries:
  - `en:book:NOUN`: forms `books` {Number=Plur};
  - `en:book:VERB`: forms `books` {VerbForm=Fin, Tense=Pres, Person=3, Number=Sing}, `booked` {Tense=Past}, `booking` {VerbForm=Ger}.
- *colour* / *color* is one entry with two variants: `colour` [en-GB, en-AU, en-CA] and `color` [en-US].
- *go* has the irregular form `went` {Tense=Past}. An archaic second reading of `went` (from *wend*) is evidence, not ambiguity.

**French (`fr`).**
- **Gender as an inherent feature:**
  - `fr:livre:NOUN` (book) has {Gender=Masc};
  - `fr:livre:NOUN` (pound) is a separate entry with {Gender=Fem}: different gender, different entry.

  Because both share an id, the entry id needs a homograph discriminator, e.g. `fr:livre:NOUN:2`.
- **Agreement:** `fr:beau:ADJ` has forms `belle` {Gender=Fem, Number=Sing}, `beaux` {Gender=Masc, Number=Plur}, and the pre-vowel form `bel` {Gender=Masc, Number=Sing, fr:PreVowel=true}.
- **Conjugation:** `fr:aller:VERB` has forms like `vais` {Person=1, Number=Sing, Tense=Pres, Mood=Ind}. Paradigms are optional.
- **Elision:** the articles `le`/`la` have the form `l'` {fr:Elision=true}; an exercise sentence decides which form is correct.
- **Accents:** they are part of the spelling (é, è, ê, ç). The answer matcher treats them as distinctive by default for non-English languages.
- **Address:** *tu* vs *vous* is `usage.address` / `Polite=Infm|Form` on senses and examples, not part of identity.
- **Varieties:** the same entry serves `fr-FR` and `fr-CA`; where usage differs, the sense or variant carries the variety.

**Spanish (`es`).**
- **Gender:** `es:mesa:NOUN` has {Gender=Fem}.
- **Stem changes:** `es:poder:VERB` has forms like `puedo` {Person=1, Number=Sing, Tense=Pres} plus the documented feature `es:StemChange=o>ue` at the entry level.
- **Clitics:** `dímelo` is a form of `decir` with attached clitics. It is described by features, or treated as a phrase in exercises, never as a new lemma.
- **Accents:** they can be distinctive (`tú` vs `tu`, `sí` vs `si`), which is a good reason to keep accents strict.
- **Address and varieties:**
  - `vosotros` forms carry {Person=2, Number=Plur} with varieties [es-ES];
  - `ustedes` usage applies everywhere;
  - voseo forms (e.g. `vos tenés`) carry varieties such as [es-AR] and `usage.address`.

  Examples and accepted answers record which varieties they accept.

None of these needs changes to shared concepts: they are values of `features`, `varieties` and `usage`.

## 8. Pipeline: shared core, language-specific adapters

**Reusable as is, or nearly:**
- the source register and licence and profile model;
- checksum-pinned acquisition;
- run manifests;
- deterministic CSV/JSON output;
- validation (isolation, invented-content checks);
- the evidence-level vocabulary;
- the pilot and review-package mechanics.

**Language-specific (adapters and configuration):**
- frequency sources and lexicons, with their licence decisions;
- morphology (the current WordNet suffix rules and ESDB relations are English-only);
- exclusion rules (English possessives and "'s" contractions; the pronoun "I");
- capitalisation heuristics (they would misfire for German nouns);
- spelling-variant varieties;
- foreign-word and OCR lists;
- the function-word checklist.

**Small current hardcodings to generalise when a second language is added** (no behaviour change now):
- `language: "en"` in outputs and the `en:` id prefix;
- the config check "only `en` is supported";
- the British/American/Australian/Canadian variety names, which should become BCP 47 tags (`en-GB`...).

**Normalisation:**
- **Locale-aware case:** lower-casing should use locale-aware rules (Turkish dotless i).
- **Elision:** apostrophe handling must allow French elision (`l'homme` is two tokens).

The principle: shared infrastructure; per-language adapters, morphology and licensing; one source register with per-language entries.

## 9. Gaps in the current app contract (for later, not changed now)

| Area | Current | Needed for several languages |
| --- | --- | --- |
| Target language | `LANGUAGE_CODES = ['en']`, `bcp47: 'en'` | More codes; varieties as BCP 47 tags on variants, examples, usage |
| Support language | `TRANSLATION_LANGUAGES = ['pt-PT']`; translations keyed by `pt-PT` inside the sense | Translation records per support language, with review and provenance |
| Definitions | One implicitly English `definition` | Definitions tagged with their language |
| Saved vocabulary | `portugueseExplanation` field | An explanation tagged with its support language |
| Parts of speech | English-oriented list including `phrase` | UPOS plus display labels; multiword as `kind` |
| Forms | `forms` as free label → one word | Features per form; several forms per feature set |
| Gender and agreement | Not representable | Inherent `features` on entries |
| Address and politeness | Only `register` | `usage.address` / `Polite` on senses and examples |
| Answer checking | Per-language rules; non-English defaults to accent-strict | Keep; add language rules (elision, clitics, inverted punctuation `¿¡`) as languages arrive |
| UI | `lang="en"` attributes on content, Portuguese/English explanation toggle | Content `lang` from the record's language; UI language separate |

## 10. Risks

- **Homographs need a discriminator in ids:** same lemma and part of speech, different entries (`fr:livre:NOUN` masculine and feminine).
- **Accepted answers multiply** with agreement, clitics and varieties. Examples must state the exact form and the accepted varieties.
- **Licensed sources differ per language;** some languages may lack open lexicons with morphology. The pipeline must allow "no source yet" without inventing data.
- **Feature inventories drift** unless language-specific features are documented and validated per language.
- **One review status per entry is not enough** once translations exist in several support languages. Review must stay per record.
- **Curriculum logic must not leak into lexical records,** or entries become tied to one language pair.
