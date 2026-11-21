# Vocabulary packs: content contract

Static, versioned vocabulary content for the Vocabulary Trainer. The contract is `vocabularyPackSchema` and `vocabularyPackIndexSchema` in `packages/shared/src/contracts/vocabulary-pack.ts`; this page explains it for whoever prepares content.

## Where packs live

```
apps/client/public/content/vocabulary/
  index.json                 catalogue: id, version, language, title, entryCount, path
  en/demo-everyday.json      one pack (the demonstration pack in this milestone)
```

- **Loading:** packs are plain static files, copied to `dist/content/vocabulary/` by the build.
  - The app fetches the catalogue when the Library opens, and a pack only when it is chosen (`features/vocabulary/library/pack-loader.ts`).
  - Packs are never part of the JavaScript bundle and never requested from `/api/`.
  - Packs are never copied into IndexedDB. Only what the learner trains joins their collection.
- **Validation:** every pack is validated twice.
  - At load time: an invalid pack is reported and not used.
  - In tests: `pack-files.test.ts` checks every file listed in the catalogue.

## Model

| Level | Field | Notes |
| --- | --- | --- |
| Pack | `id`, `version` (semver), `language`, `title`, `description`, `demo` | `language` must be supported by the app (`LANGUAGE_CODES`, English only today). |
| | `licence` `{ name, url, attribution }`, `sources[]` `{ id, name, url, licence }` | Every CEFR or frequency claim names a source id. |
| Entry | `id` | Stable across versions (e.g. `en:book:verb`). One entry per **lemma + part of speech**. |
| | `lemma`, `partOfSpeech`, `kind` | `kind` reuses the collection's kinds (word, phrasal_verb, idiom, collocation, expression). |
| | `forms` | Inflected forms by label (`past`, `plural`…). Listed, never guessed; used to recognise "right word, wrong form". |
| | `variants` | Other correct spellings of the lemma (British/American…). |
| | `topics` | From `VOCABULARY_TOPICS`. |
| | `cefr` `{ level, source, certainty }` or `null` | Optional. `certainty` is `listed` (from a named list) or `estimated`. Never required. |
| | `frequency` `{ rank, source }` or `null` | Optional. |
| | `difficulty` 1–5 | Exercise difficulty, independent of CEFR. |
| Sense | `id`, `translations['pt-PT']`, `definition`, `accepted`, `register` | One meaning. `accepted` lists true synonyms accepted for the Spelling and Definition prompts. |
| | `contexts[]` `{ id, sentence, answer, accepted, clue, difficulty }` | The sentence has **exactly one** `___`. `answer` is the form the sentence needs (must be the lemma, a listed form or a variant). Nothing else is accepted unless listed in `accepted`. |
| | `audio` | Reserved for recorded pronunciations (Audio mode, later). |

## Exercise availability

| Mode | Needs |
| --- | --- |
| Spelling | a pt-PT translation |
| Definition | a definition |
| Context | at least one context sentence |
| Audio | reserved; not offered yet |

Entries without the data for a mode are simply not used for it.

## Answer checking (what content authors should know)

- **Ignored:** case, spacing, quote styles, final punctuation, and hyphen-versus-space differences ("well known" = "well-known").
- **Accents:** optional in English ("cafe" = "café"); any other language gets strict rules by default.
- **Only listed answers count:**
  - the expected answer;
  - the context's `accepted`;
  - for Spelling and Definition, the entry's `variants` and the sense's `accepted`.
- **"Almost" is never counted correct:** a small typo (one edit in words of 4–8 letters, two in longer words; none in shorter words) or a missing accent where accents matter.
- **Right word, wrong form:** typing another listed form of the word is recognised and explained, but not accepted.
- **When a correct answer is rejected,** add it to the list; don't rely on the matcher to guess.

## Licensing

Before importing any external list, check its licence: many well-known CEFR and frequency lists can't be redistributed. Record the source and licence in `sources` and the pack `licence`. The demonstration pack is original content written for this project, and its CEFR levels are the author's estimates.
