# Architecture — Linguas de Gato

## 1. Overview

```
┌──────────────────────────── Browser ────────────────────────────┐
│  apps/client  (React 19 + Vite + Tailwind v4)                   │
│   ├─ features/*        module UIs (listening, dashboard, …)     │
│   ├─ components/ui     owned shadcn-style primitives            │
│   ├─ lib/api-client    typed fetch wrapper, error envelope      │
│   └─ local data        IndexedDB (sessions), localStorage (theme)│
│                │ /api/* (same origin; Vite proxy in dev)         │
└────────────────┼────────────────────────────────────────────────┘
                 ▼
┌──────────────── apps/server  (Fastify 5, Node 22) ──────────────┐
│   routes/health, routes/capabilities, routes/transcriptions     │
│   (later feedback) → modules/ai (provider abstraction → Groq)   │
│   modules/transcription (streamed upload → temp dir, cleanup)   │
│   plugins/error-handler, plugins/request-guards (CSRF, rebind)  │
│   config/env (Zod-validated environment, secrets live here)     │
└────────────────┬────────────────────────────────────────────────┘
                 ▼
            Groq API (Whisper, LLM)   — server-to-server only

packages/shared — API contracts (Zod schemas + types) and pure domain
logic (languages, media validation, YouTube URL parsing, subtitle
parsing, time utilities, text comparison/WER, practice time maths,
media signatures, transcript cue building, persisted-record and
transcription schemas). Imported by both apps. No runtime I/O.
```

The architecture is deliberately small: two applications and one shared library in a single npm workspace. There is no database, no auth, and no container infrastructure.

## 2. Repository layout

```
.
├─ apps/
│  ├─ client/                 Vite + React SPA
│  │  └─ src/
│  │     ├─ app/              router, module registry
│  │     ├─ components/
│  │     │  ├─ ui/            primitives (button, card, input, …)
│  │     │  └─ layout/        shell, navigation, page header
│  │     ├─ features/
│  │     │  ├─ dashboard/
│  │     │  ├─ listening/     importer, player, practice, dictation,
│  │     │  │                 storage/ (IndexedDB), youtube/, session/,
│  │     │  │                 transcription/ (upload, options, status)
│  │     │  └─ planned/       placeholder page for planned modules
│  │     ├─ hooks/            cross-feature hooks
│  │     ├─ lib/              api client, utils, theme
│  │     └─ styles/           globals.css (design tokens)
│  └─ server/                 Fastify API
│     ├─ src/
│     │  ├─ config/           env loading and validation
│     │  ├─ plugins/          error handler, request guards
│     │  ├─ routes/           HTTP routes (thin)
│     │  ├─ modules/ai/       provider interfaces, Groq transcription
│     │  ├─ modules/transcription/  upload receiving, temp-file sweep
│     │  ├─ app.ts            buildApp() (used by tests)
│     │  └─ main.ts           process entry point
│     └─ test/                route tests (fastify.inject)
├─ packages/
│  └─ shared/                 contracts + pure domain logic (tested)
├─ docs/                      product, architecture, roadmap, design
└─ CLAUDE.md                  working agreement for AI assistants
```

## 3. Key decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | npm workspaces with `apps/*` and `packages/*` | Separate client and server, shared types, one install. No Turborepo or Nx: the project is too small for them. |
| D2 | `packages/shared` holds Zod schemas for every API contract | One source of truth for validation on the server and parsing on the client. |
| D3 | Pure domain logic (subtitles, YouTube, media rules) lives in `shared` | Deterministic, framework-free, easy to unit test, reusable by future modules. |
| D4 | Owned UI primitives in the shadcn pattern (cva + `cn`) instead of the CLI and a component runtime | Full control over the design system, fewer dependencies. Radix or Base UI can be added per component when a complex widget (combobox, popover) needs it. |
| D5 | Tailwind v4 with CSS-first tokens (`@theme inline` over CSS variables) | A single file defines the design system, with light and dark themes. |
| D6 | React Router data router (`createBrowserRouter`) | Deep links per module, nested layout route, lazy routes later. |
| D7 | Self-hosted variable fonts (`@fontsource-variable/*`) | No third-party font requests, works offline, stable rendering. |
| D8 | Server binds to `127.0.0.1` and is same-origin with the client (Vite proxy in dev, static serving in prod) | No CORS surface, and not exposed to the LAN by default. |
| D9 | AI behind a provider interface (`modules/ai`) | Groq first. Another provider can be swapped in without touching routes. |
| D10 | Environment validated with Zod at startup. Node's `process.loadEnvFile` instead of dotenv | Fail fast with clear messages, one dependency fewer. |
| D11 | No server persistence. Uploads are processed in memory or a temp file and discarded | Product requirement, smaller attack surface. |
| D12 | Capabilities endpoint drives feature availability in the UI | The UI never pretends a feature works. It asks the server what is configured. |
| D13 | Native IndexedDB behind a `ListeningRepository` interface, no `idb` package | The surface is small (a dozen operations); owning it lets us map browser failures (private mode, quota, blocked upgrades) to clear errors. An in-memory implementation of the same interface is the fallback. |
| D14 | Persisted records validated with Zod schemas from `shared` on read | A corrupt or outdated record is skipped instead of crashing the UI. The same schemas will back the M7 JSON export. |
| D15 | Local media is not copied into IndexedDB by default; opt-in copy ≤ 500 MB with a quota check | The learner already has the file. Copying it by default would duplicate large files and burn quota. On reload the session asks for the file and checks its name and size. |
| D16 | One player-agnostic `Playback` contract for local media and YouTube | Replay-line, A-B loop and dictation are written once. YouTube has no time-update event, so its adapter polls `getCurrentTime()` every 200 ms. |
| D17 | YouTube through the official IFrame Player API on `youtube-nocookie.com` | Required to read the playback position for transcript sync. CSP `script-src` adds only `https://www.youtube.com` (the API script origin). No media access. |
| D18 | Session identity in the URL (`/listening/session/:id?mode=&line=`) | A reload restores exactly where the learner was, without extra "last session" state. |
| D19 | Groq over direct HTTP (native `fetch` + `fs.openAsBlob`) instead of `groq-sdk` | No new runtime dependency; the upload streams from the temp file instead of memory; explicit abort and timeout; no silent automatic retries (the SDK retries 429/5xx twice, which would re-upload up to 100 MB). The response is validated with our own Zod schema either way, since the SDK type doesn't model word timestamps. |
| D20 | `@fastify/multipart` streaming to a per-request temp directory | The official Fastify plugin, with per-request limits. Streaming keeps memory flat for large files; the directory is removed in `finally` and swept at startup after a crash. |
| D21 | Sentence cues built from word timestamps (`buildTranscriptCues`, linear-time alignment) | Whisper segments are acoustic chunks that often split sentences, which makes poor dictation lines. Segments are used as they are when no word timing exists; timing is never invented. |
| D22 | Request guards (loopback Host, Sec-Fetch-Site, custom header) on state-changing API calls | A local server is reachable from any open web page (CSRF, DNS rebinding). The first endpoint that spends the learner's paid quota made this necessary. |
| D23 | Real upload progress, indeterminate processing | XHR reports genuine bytes sent. Groq reports no progress, so the UI shows elapsed time only and never an invented percentage. |
| D24 | Speaking feedback via Groq chat with strict Structured Outputs, then Zod, then evidence verification | Strict JSON Schema guarantees shape for supported models; Zod enforces limits and catches anything else (JSON Object Mode fallback for other models). Verifying every quote against the transcript stops invented mistakes from being shown as the learner's. |
| D25 | Transcript review before assessment, with per-segment editing | Whisper errors must never be graded as language errors. Editing per segment keeps acoustic timestamps, so feedback can point at the right moment in the recording. |
| D26 | Deterministic fluency metrics computed in `shared`, kept apart from AI feedback | Rate, pauses, repetitions and possible fillers are measurements with stated limits; the model is told not to judge fluency or pronunciation at all. |
| D27 | `AudioRecorder` as a framework-free state machine with injected browser APIs | Every lifecycle and failure path (permission, devices, formats, cancellation during the prompt, unplugged microphone) is unit-tested without a browser. |
| D28 | One app database with all migrations in `lib/storage/app-database.ts` (v2 adds speaking stores) | One place knows the schema version; feature repositories share it. The v1 → v2 migration only adds stores, and a test proves M1/M2 records survive it. |
| D29 | Recordings are not persisted by default | Transcript, feedback and fluency are saved; the audio stays in memory unless the learner opts in, and can be deleted on its own. |
| D30 | Groq HTTP error mapping extracted to `modules/ai/groq-http.ts` | Transcription and chat report failures identically (redaction, Retry-After, timeouts). |
| D31 | One structured-chat client (`modules/ai/groq-chat.ts`) shared by speaking feedback and exercise generation | Model, response-format and reasoning settings, error mapping, truncation and JSON parsing behave the same for every chat feature; each feature keeps its own prompt, strict schema and Zod validation. |
| D32 | Exercise generation is a separate provider (`modules/ai/exercise-generation/`) with one generator per module, dispatched on a request discriminated by `kind` | Generation creates material; assessment judges the learner, so they stay apart. Module-specific schemas (a speaking task, a listening question set) represent specialised content precisely; a future Writing, Grammar, Reading or Vocabulary generator adds a `kind` to the two unions in `shared` and a generator to the registry, with no generic "exercise" schema to bend. |
| D33 | Generation reuses `GROQ_CHAT_MODEL` and the assessment timeout | One chat model to manage; no separate configuration until a feature needs a different model. |
| D34 | Listening questions must quote the saved transcript; the server verifies each quote and its segment references | The transcript is the only factual source. Unverifiable or structurally inconsistent questions are dropped and counted; timestamps come from the verified span, never from the model. |
| D35 | Speaking generation never produces a model answer | A scripted answer would undermine spontaneous speaking practice; the task gives guidance, useful language and objectives instead. The learner's chosen level and format override whatever the model echoes. |
| D36 | Database v3 adds `listeningExercises` (indexed by session); generated speaking topics reuse `speakingTopics` with an optional `generated` field | Additive migration only; older topics stay valid without rewriting. Exercise sets survive a transcript replacement (flagged as based on an earlier transcript via a fingerprint) and are deleted with their session. |
| D37 | Writing and Grammar generators join the existing registry (`kind: "writing" \| "grammar"`); assessment and evaluation are separate providers (`groq-writing.ts`, `groq-grammar.ts`) on the shared chat client | Generation creates material, assessment judges the learner. Each keeps a module-specific strict schema; no generic exercise schema. |
| D38 | Writing corrections are verified against the submitted text by character span (`verifyWritingCorrections`), classified as `error` or `suggestion`, and never overlap | Invented quotes and no-op "corrections" are withheld; spans come from the text, so annotations always point at what the learner wrote. A suggestion (acceptable original) can't be a high priority. |
| D39 | The improved version is a separate, optional request after the assessment, rejected if its length departs too far from the original | The default is not to rewrite the learner's text; a revision that changes length drastically is a new text, not an improvement. |
| D40 | Grammar is scored deterministically against verified answer keys (`normalizeAnswer`, `evaluateGrammarAnswer`); generated questions are dropped when ambiguous or inconsistent (`verifyGrammarQuestions`) | Normalisation removes only harmless differences (case, quotes, spacing, final punctuation, contractions) and keeps commas and every word. An AI "second opinion" exists only for open types, only on request, against an explicit rubric, and never changes the score. |
| D41 | Database v4 adds `writingTasks`, `writingDrafts` (keyed by task: one draft per task), `writingAttempts` (indexed by task, with a task snapshot) and `grammarSets`, behind a small validated `KeyedStore` abstraction | Additive migration; one draft per task avoids duplicate copies; a submitted text moves from the draft into the attempt. The keyed store validates on write and read and has an in-memory twin for browsers without IndexedDB. |
| D42 | Reading sources are AI-generated texts and pasted text only; no URL import or scraping | Keeps content legal and the server free of fetching; the request schemas reject unknown fields such as a URL. |
| D43 | Comprehension questions cite paragraph numbers and an exact quote; `verifyReadingQuestions` checks the quote, the paragraph references and rejects answers copied verbatim (≥ 6 words) from the text | Grounding without trusting the model, and questions that test understanding rather than matching. Offsets are computed from the text for "Show in text". |
| D44 | Vocabulary lookups are contextual: the client sends the selection, its sentence (`sentenceAround`) and paragraph; the server checks the selection is in the sentence and the sentence in the paragraph, and rejects an analysis whose evidence isn't in the sentence | The same word has different meanings in different sentences; a generic or unrelated sense must never be presented as the meaning here. CEFR levels are labelled AI estimates; Portuguese is opt-in. |
| D45 | One collection entry per expression (keyed by lemma) with up to ten contextual senses; saving merges instead of duplicating | Learners meet the same expression in new senses; a duplicate entry would split its review history. A new sense makes the entry due again. |
| D46 | A fixed review ladder (0, 1, 3, 7, 16, 35 days; again / good / easy) instead of an adaptive algorithm | Simple, predictable and testable; an adaptive scheduler can replace `scheduleReview` later without changing stored records much. |
| D47 | Vocabulary practice: objective types scored deterministically; completion, paraphrase and own sentences evaluated by a separate AI rubric on request and shown apart from the score | String matching cannot judge whether a learner's own sentence is right; the rubric checks meaning, task and naturalness. |
| D48 | Database v5 adds `readingTexts` (with progress), `readingQuestionSets` (indexed by text), `vocabularyEntries` (indexed by key) and `vocabularyPracticeSets` | Additive migration. Deleting a text deletes its question sets; saved vocabulary keeps its own context sentence and the text's title, so it survives. |

## 4. Shared package consumption

`@ldg/shared` is TypeScript source compiled to `dist/` for production.

- **Client (Vite, Vitest):** a `resolve.alias` maps `@ldg/shared` to `packages/shared/src`, so changes are picked up instantly.
- **Server dev (tsx) and type checks:** tsconfig `paths` map `@ldg/shared` to the source, and tsx honours them.
- **Server build:** `tsconfig.build.json` has no `paths`, so the package resolves through `node_modules` to `dist/` (types from `dist/*.d.ts`). The root `build` script builds `shared` first.

## 5. API contracts

All responses are JSON. Every error uses one envelope:

```jsonc
// 4xx / 5xx
{ "error": { "code": "VALIDATION_ERROR", "message": "Human-readable summary", "details": [/* optional */] } }
```

Error codes: `VALIDATION_ERROR` (400), `FORBIDDEN` (403), `NOT_FOUND` (404), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `RATE_LIMITED` (429), `PROVIDER_ERROR` (502), `PROVIDER_UNAVAILABLE` (503), `PROVIDER_TIMEOUT` (504), `INTERNAL_ERROR` (500). A 500 never includes stack traces or internal messages.

State-changing requests (anything but GET/HEAD/OPTIONS) must send `X-LDG-Client: web` and pass the request guards (§7).

### 5.1 Implemented

| Method | Path | Response |
| --- | --- | --- |
| GET | `/api/health` | `{ status: "ok", version: string, uptimeSeconds: number }` |
| GET | `/api/capabilities` | `{ targetLanguages: LanguageCode[], transcription: { available, configured, provider: "groq" \| null, maxUploadBytes }, feedback: { available, configured, provider } }` |
| POST | `/api/transcriptions` | `TranscriptionResult` (below) |

**`POST /api/transcriptions`** (M2). `multipart/form-data`; the text fields come **before** the file, because the stream is parsed in order:

| Field | Values | Default |
| --- | --- | --- |
| `model` | `whisper-large-v3-turbo` ("Fast") · `whisper-large-v3` ("Higher accuracy") | turbo |
| `language` | `en` · `auto` (omits the language so Whisper detects it) | `en` |
| `file` | FLAC, MP3, MP4, MPEG, MPGA, M4A, OGG, WAV, WebM; ≤ `TRANSCRIPTION_MAX_UPLOAD_MB` | required |

Response (`transcriptionResultSchema` in `shared`):

```jsonc
{
  "provider": "groq", "model": "whisper-large-v3-turbo",
  "requestedLanguage": "en",        // null for automatic detection
  "detectedLanguage": "English",    // as reported by the provider, or null
  "durationSeconds": 30,             // or null
  "text": "…",
  "segments": [{ "id": "1", "startMs": 900, "endMs": 8600, "text": "…", "avgLogprob": -0.2, "noSpeechProb": 0.01 }],
  "words":    [{ "text": "I", "startMs": 1000, "endMs": 1500 }]   // [] when not returned
}
```

Errors: 400 invalid options/fields or empty file · 403 request guard · 413 over the limit (ours or Groq's) · 415 unsupported type, MIME mismatch or content that isn't the claimed format · 429 another transcription running, or Groq's rate limit (with Retry-After seconds) · 502 Groq error or invalid provider response · 503 not configured, key rejected or Groq unreachable · 504 timeout. If the browser disconnects, the provider call is aborted and no response is sent.

The Groq call itself (verified against https://console.groq.com/docs/speech-to-text and the official SDK's types via Context7): `POST {GROQ_API_BASE_URL}/audio/transcriptions` with `model`, `response_format=verbose_json`, `temperature=0`, `timestamp_granularities[]=segment` and `=word`, optional `language`, and the file as `audio.<ext>` (never the learner's file name).

**`POST /api/speaking/assessments`** (M3). JSON, under the global 1 MB limit, validated with `assessmentRequestSchema` (`shared`): `{ prompt: { source, promptId, title, instructions, points[], category, level }, mode: "free"|"guided", targetDurationSeconds: 30|60|120|180, recordingDurationMs, segments: [{ id, startMs, endMs, text }] }`. Limits: 1–200 segments, ≤ 1,000 characters each, ≤ 8,000 characters in total, ≥ 20 words, unique ids, no unknown fields.

Response (`assessmentResponseSchema`): `{ provider: "groq", model, createdAt, assessment }`, where `assessment` contains `overview`, `taskAchievement`, `grammar`/`vocabulary`/`coherence`/`naturalness` (each `{ level: "strong"|"developing"|"needs_attention", summary, strengths[] }`), `issues[]` (`{ category, subcategory, segmentId, startMs, original, correction, explanation, advancedAlternative|null, severity }`), `recurringPatterns[]`, `exercises[]` (`{ id, type, focus, instruction, sourceQuote, sourceSegmentId, startMs, modelAnswer }`) and `discarded: { issues, exercises }`. No scores, no CEFR labels.

The Groq call (verified against https://console.groq.com/docs/structured-outputs and the model and reasoning pages): `POST {GROQ_API_BASE_URL}/chat/completions` with `GROQ_CHAT_MODEL` (default `openai/gpt-oss-120b`), `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }` for models documented to support strict mode (otherwise `json_object` plus explicit output instructions), `max_completion_tokens`, and for GPT-OSS models `reasoning_effort` (default `medium`) with `include_reasoning: false`. No streaming (unsupported with Structured Outputs). The output is validated with `modelAssessmentSchema`, then **every quoted mistake and exercise source is located in the confirmed transcript** (`verifyAssessmentEvidence`); claims that can't be found are dropped and counted, and verified ones get their segment's timestamp. Errors map like transcription's (shared `groq-http.ts`); a truncated (`finish_reason: "length"`) or malformed output is a 502 with a safe message.

Transcription for the Speaking Lab reuses `POST /api/transcriptions` unchanged: recordings upload as `recording.webm` (or `.m4a`/`.ogg`), and the MIME check accepts codec parameters (`audio/webm;codecs=opus`).

**`POST /api/exercises/generate`** (AI exercise generation). JSON under the 1 MB limit, validated with `generationRequestSchema` (`shared`), a union discriminated by `kind`; unknown fields and kinds are rejected before any Groq call.

- `kind: "speaking"`: `{ level: "B2"|"C1"|"C2", category, interest: string ≤ 300 | null, format: "free"|"guided"|"debate"|"critical_thinking", targetDurationSeconds: 30|60|120|180, skillFocus | null, avoidTitles: string[] ≤ 10 }`. Result `{ kind: "speaking", exercise: { title, centralPrompt, instructions, discussionPoints[2–6], followUpQuestions[≤5], vocabulary[3–12] { expression, meaning, example }, objectives[1–4], level, format } }`. No model-answer field exists; an output that adds one fails validation.
- `kind: "listening"`: `{ level, questionCount: 4–10, types: (main_idea|detail|inference|speaker_intention|vocabulary_in_context)[] unique, segments: [{ id, startMs, endMs, text }] }`, 1–800 segments, ≤ 1,200 characters each, ≤ 24,000 in total, ≥ 60 words. The client prepares segments from the saved cues (`prepareListeningTranscript`: empty cues dropped, cut at a cue boundary, ids `s<cue number>`). Result `{ kind: "listening", questions: ListeningQuestion[], discarded }`, where each question is a union on `format`: `multiple_choice` (3–4 distinct options, `correctOptionIndex`) or `short_answer` (`acceptedAnswers[1–5]`), plus `id, type, difficulty, question, explanation, evidenceQuote, segmentIds, startMs, endMs`.

Response envelope (`generationResponseSchema`): `{ provider: "groq", model, createdAt, result }`. The Groq call goes through the shared chat client (strict `json_schema` named `speaking_exercise` or `listening_questions`; JSON Object Mode fallback). Listening output is parsed loosely at the top level, then **each question is validated individually** (`verifyListeningQuestions`): consistent structure, every cited segment id must exist, the evidence quote must be ≥ 3 words and occur verbatim (normalised) in the transcript, no duplicates, only requested types, capped at `questionCount`. If none survive, the response is a 502 with a clear message. Concurrency cap 2 (429), same timeout and disconnect handling as assessment (shared `routes/ai-job.ts`). Logs: kind, model, counts and timings only.

**Writing and grammar generation (M4)** use the same endpoint:

- `kind: "writing"`: `{ level, format (12 formats: argumentative/opinion/discursive essay, formal/informal email, report, proposal, article, review, summary, paraphrase, reformulation), category, interest | null, targetWords: 40–600, register: formal|neutral|informal, objective: string ≤ 200 | null, avoidTitles }`. Result `{ kind: "writing", task: { title, instructions, context, sourceText | null, wordCount { target, min, max }, requiredElements[1–8], evaluationCriteria[2–8], objectives[1–5], languageFeatures[≤8], level, format, register } }`. No model answer exists in the schema. The server keeps the learner's level, format and register, makes the word range coherent with the target, requires a source text for summary/paraphrase/reformulation and drops it otherwise.
- `kind: "grammar"`: `{ level, topic (12 areas), types (multiple_choice, gap_fill, error_correction, transformation, word_order, sentence_completion), questionCount: 4–12, focus | null, avoidTitles }`. Result `{ kind: "grammar", set: { title, instructions, level, topic, questions[] }, discarded }`, each question a union on `type` with `prompt`, `explanation`, `rule` and its own key fields (options + `correctOptionIndex` + one `distractorExplanations` entry per option; `acceptedAnswers`; `sourceSentence` + `keyword`; `words`). `verifyGrammarQuestions` drops questions with duplicate options, invalid keys, missing distractor reasons, not exactly one `___`, transformations whose answers don't use the keyword, error corrections that change nothing, word orders whose answers use other words; harmless duplicate answers are collapsed.

**`POST /api/writing/assessments`** (M4). `{ task: WritingTaskInput, text }`, text ≤ 12,000 characters and ≥ 30 words. Response `{ provider, model, createdAt, assessment }`: `overview`, seven dimensions (`grammar`, `vocabulary`, `naturalness`, `coherence`, `taskAchievement`, `register`, `sentenceVariety`, each `{ level, summary, strengths[] }`), `requiredElements[] { element, addressed, comment }`, `priorities[]`, `corrections[] { id, kind: error|suggestion, category, original, correction, explanation, priority, advancedAlternative | null, start, end }` and `discarded`. No scores or CEFR levels.

**`POST /api/writing/improvements`** (M4, optional, after the assessment). `{ task, text, corrections[{ original, correction }] }` → `{ provider, model, createdAt, improvedText, notes[] }`. Rejected (502) when the word count falls below 60% or rises above 140% (or +40 words) of the original.

**`POST /api/grammar/evaluations`** (M4, optional second opinion). `{ level, topic, question: { type: error_correction|transformation|sentence_completion, prompt, sourceSentence, keyword, acceptedAnswers, rule }, answer ≤ 400 }` → `{ provider, model, createdAt, review: { verdict: correct|acceptable|incorrect, explanation, correctedAnswer | null } }`.

All three use the shared chat client (strict schemas `writing_assessment`, `writing_improvement`, `grammar_review`), `GROQ_CHAT_MODEL`, the assessment timeout, a concurrency cap of 2 per route, disconnect aborts, the error envelope and metadata-only logs (format, word and correction counts, verdict, timings; never text).

**Reading and vocabulary generation (M5)** use `/api/exercises/generate`:

- `kind: "reading"`: `{ level, category, interest | null, textType: article|opinion_piece|informative_article|report|narrative, targetWords: 150–900, languageFocus | null, avoidTitles }` → `{ kind: "reading", text: { title, paragraphs[3–20], objectives, vocabulary[{ expression, meaning }], level, textType, wordCount, estimatedMinutes, discardedVocabulary } }`. Reading time is computed (200 wpm); vocabulary suggestions not found in the text are dropped; a passage under half the requested length is rejected.
- `kind: "reading_questions"`: `{ level, questionCount: 4–10, types (main_idea, detail, inference, author_intention, argument_analysis, vocabulary_in_context, implication), title, paragraphs[] }` (≤ 20,000 characters, ≥ 80 words) → `{ kind: "reading_questions", questions[], discarded }`, each a union on `format` (multiple choice / short answer) with `evidenceQuote`, `paragraphIndex` and character offsets when the evidence lies in one paragraph.
- `kind: "vocabulary_practice"`: `{ types (gap_fill, meaning_choice, collocation, matching, sentence_completion, paraphrase, own_sentence), questionCount: 4–12, items[{ id, expression, meaning, context }] (1–20, unique ids; matching needs ≥ 3) }` → `{ kind: "vocabulary_practice", questions[], discarded }`, each question a union on `type`; questions about unknown items, without the needed gap, with invalid keys or answers that ignore the expression are dropped.

**`POST /api/vocabulary/lookups`** (M5). `{ expression ≤ 80 chars / 8 words, sentence ≤ 600, paragraph ≤ 4,000, explanationLanguage: en|pt }` → `{ provider, model, createdAt, lookup: { expression, lemma, kind: word|phrasal_verb|idiom|collocation|expression, partOfSpeech, contextualMeaning, dictionaryMeaning, contextEvidence, collocations, synonyms, antonyms, register, examples[2–4], patterns, cefrEstimate, portugueseExplanation | null } }`. 400 if the expression isn't in the sentence or the sentence isn't in the paragraph (before any Groq call); 502 if the returned evidence isn't in the sentence.

**`POST /api/vocabulary/evaluations`** (M5). `{ expression, meaning, task: sentence_completion|paraphrase|own_sentence, prompt, exampleAnswers[], answer ≤ 400 }` → `{ …, review: { verdict: correct|partly|incorrect, usesExpressionCorrectly, feedback, improvedAnswer | null } }`.

Both use the shared chat client (strict schemas `vocabulary_lookup`, `vocabulary_evaluation`), the assessment timeout, a concurrency cap of 2, disconnect aborts and metadata-only logs.

### 5.2 Planned

Progress endpoints, if any, will be specified with that milestone.

## 6. Data boundaries

| Boundary | Rule |
| --- | --- |
| Browser ↔ Server | Only explicit, user-initiated payloads (audio for transcription, text for feedback). Validated with Zod on arrival. The microphone is requested only when the learner presses "Start recording"; nothing is uploaded until they press "Transcribe", and only the confirmed transcript (never audio) is sent for feedback. |
| Server ↔ Groq | Secrets added server-side. Responses are validated (Zod) and normalised before being returned. Uploaded audio exists only in a per-request temp directory that is deleted in `finally`, including on errors and cancellation; stale directories from a crash are swept at startup. Groq's own retention is governed by the learner's Groq account, not by this app. |
| Browser storage | Learner data stays local. A future export/import feature uses a versioned JSON schema in `shared`. |
| YouTube | IFrame embed only. The client stores the video ID, never media bytes. |

## 7. Security (OWASP-aligned)

- **Secrets:** `GROQ_API_KEY` exists only in `apps/server/.env` (git-ignored). The client bundle has no access to it (verified by scanning the build). The provider keeps it in a private class field, and any key-like text in a provider error is redacted before it reaches a response. Vite only exposes `VITE_*` variables, and none are secret. `GROQ_API_BASE_URL` accepts only https, or http on loopback, so the key never crosses a network unencrypted.
- **Input validation:** Zod for env, request bodies, multipart fields and provider responses. Uploads: an allow-listed extension, a MIME type consistent with it, the size limit enforced while streaming, a magic-byte check of the content (`detectMediaContainer`), and limits of one file and two known fields.
- **Uploads on disk:** a fresh `mkdtemp` directory per request (unpredictable name, no user-controlled path segments), a fixed file name `upload.<ext>`, mode `0600`, `wx` flag; deleted in `finally`.
- **Request guards (CSRF / DNS rebinding):** a local server is reachable by any web page the learner has open. For every state-changing request (any method but GET/HEAD/OPTIONS, **whatever the path**, because the router decodes paths and `/%61pi/…` matches `/api/…`), `plugins/request-guards.ts` requires (1) a loopback `Host` when bound to loopback, (2) no `Sec-Fetch-Site: cross-site/same-site`, and (3) the `X-LDG-Client` header, which cross-origin pages cannot send without a CORS preflight that the server never grants. It runs `onRequest`, so blocked uploads are never read.
- **Headers:** `@fastify/helmet` with a restrictive CSP. `script-src` is `'self'` plus `https://www.youtube.com` (the official IFrame API only, never inline), `frame-src` is limited to YouTube's embed origins and `media-src` to `self` and `blob:`.
- **Error handling:** one central handler maps known errors to the envelope and logs unknown errors server-side only.
- **Network exposure:** binds to `127.0.0.1` by default, has no CORS, and the global JSON body limit stays at 1 MB; only the transcription route accepts a larger body (the upload limit plus multipart overhead).
- **Prompt injection (speaking feedback, exercise generation):** transcripts, custom topics and the learner's "interest" text are untrusted. They reach the model as one JSON-encoded value (no delimiter to break out of), every system prompt forbids following instructions inside it (and revealing the prompt), the output is schema-constrained, and every quote (mistakes, listening evidence) must exist in the transcript. System prompts never leave the server.
- **Abuse limits:** at most two concurrent transcriptions, two concurrent assessments and two concurrent generations (429 beyond that), upload, transcript-length and output-count limits, and provider timeouts. Generation runs only on an explicit "Generate" click. `@fastify/rate-limit` was not added: on a single-user loopback server, the concurrency cap, the request guards and Groq's own rate limits cover the realistic risks without another dependency.
- **Logging:** metadata only (model, language, bytes, timings, counts). Never file names, audio, transcript text or headers carrying credentials.
- **Dependencies:** kept minimal and run `npm audit` in validation.

## 8. Frontend architecture

- **Routing:** `/` (overview), `/listening`, `/speaking`, `/writing`, `/grammar`, `/reading`, `/vocabulary`, `/progress`. Planned modules render an honest "Planned" page driven by the module registry (`app/modules.ts`).
- **State:** local component state and small hooks. Add a store only when cross-feature state appears (likely Progress).
- **Media:** the `useMediaPlayer` hook wraps an `HTMLMediaElement` (time, duration, rate, volume, seeking). The UI layer renders the custom controls. Subtitle cues are matched to the current time with a binary search (`findActiveCueIndex`).
- **Persistence:** `lib/storage/indexed-db.ts` holds promise helpers and the `StorageError` mapping (`unavailable`, `quota`, `blocked`, `version`, `unknown`). `lib/storage/app-database.ts` owns database `linguas-de-gato` and its migrations; it is at **version 5**:

  | Store | Key | Since | Contents |
  | --- | --- | --- | --- |
  | `sessions` | `id` | v1 | Title, source (file metadata or YouTube ID), transcript summary, playback position and rate, A-B loop, timestamps |
  | `transcripts` | `sessionId` | v1 | Cues; for generated transcripts also the provider's segments and word timestamps (optional fields added in M2) |
  | `media` | `sessionId` | v1 | Optional opt-in Blob copy of a local file |
  | `dictation` | `[sessionId, cueId]` | v1 | Reference text and the last 20 attempts |
  | `speakingAttempts` | `id` | v2 | Prompt, mode, durations, reviewed transcript segments (recognised and corrected text), Whisper word timings, fluency metrics, assessment, exercise answers |
  | `speakingRecordings` | `attemptId` | v2 | Opt-in audio Blob, kept apart so listing never loads audio |
  | `speakingTopics` | `id` | v2 | Learner-created topics; AI-generated topics add an optional `generated` field (level, format, focus, duration, guidance, follow-ups, vocabulary, objectives, model) |
  | `listeningExercises` | `id`, index `bySession` | v3 | AI-generated comprehension question sets: questions with verified evidence, transcript fingerprint, learner answers, self-assessments, `submittedAt` |
  | `writingTasks` | `id` | v4 | Saved (generated, possibly edited) writing tasks with category and model |
  | `writingDrafts` | `taskId` | v4 | One autosaved draft per task: text, optional timer time |
  | `writingAttempts` | `id`, index `byTask` | v4 | Submitted text with a task snapshot, word count, assessment and optional improved version |
  | `grammarSets` | `id` | v4 | Generated, verified grammar sets with current answers, `checkedAt`, second opinions and the history of checked rounds |
  | `readingTexts` | `id` | v5 | Generated or pasted texts (paragraphs, word count, reading time, level, objectives, suggested vocabulary) with reading progress (furthest paragraph, completion, last opened) |
  | `readingQuestionSets` | `id`, index `byText` | v5 | Verified comprehension questions per text with answers, self-assessments and `submittedAt` |
  | `vocabularyEntries` | `id`, index `byKey` | v5 | One entry per expression (lemma key) with contextual senses (context sentence, source text, meanings, examples, collocations, patterns, CEFR estimate) and review state with recent ratings |
  | `vocabularyPracticeSets` | `id` | v5 | Verified practice questions, matching shuffles, answers, AI reviews of open answers and history |

  Upgrades migrate step by step from `oldVersion`; never edit a released step. Multi-store changes (delete a session, replace a transcript, which also clears dictation) run in one transaction. `updateSession` is read-modify-write in a single transaction, so concurrent updates don't overwrite each other. Other tabs close their connection on `versionchange`, so upgrades are not blocked indefinitely. Future modules (vocabulary, mistakes) add their stores in a new version.
- **Practice:** `useBoundedPlayback` implements replay-line and A-B loops on any `Playback`. It uses interval polling (not rAF), so loops keep working in background tabs, and the pure decision lives in `resolveRangeAction` (`shared`).
- **Transcription (M2):** `features/listening/transcription/`. `useTranscriptionJob` uploads with `apiUpload` (XMLHttpRequest, because fetch can't report upload progress): genuine byte progress while uploading, then an indeterminate "processing" state with elapsed time only. Cancelling aborts the request; the server then aborts the Groq call and deletes the temp file. On success, `createTranscribedSession` turns the result into M1 shapes with `buildTranscriptCues` (`shared`), which re-cuts Whisper's acoustic segments into sentence-sized dictation lines timed by word timestamps (greedy linear alignment), and stores the session and transcript in one transaction. The learner lands on the session with "Start dictation" offered. In an existing file session, the same job feeds the workspace's transcript replacement, which confirms before clearing dictation history.
- **Speaking Lab (M3):** `features/speaking/`. Routes `/speaking` (curated library of 14 prompts, 2 per category at B2 and C1; custom topics; attempt history), `/speaking/practice/:source/:topicId` and `/speaking/attempts/:attemptId`. Flow: prepare (mode, suggested duration) → record (`AudioRecorder` + `useAudioRecorder`, live level meter on a canvas, MIME negotiated with `isTypeSupported`, max 180 s) → listen back → transcribe (M2's `useTranscriptionJob`) → review and correct per segment → the attempt is saved immediately → feedback is requested (`useAssessmentJob`) and saved to the attempt → exercises with saved answers. A router blocker and `beforeunload` guard unsaved recordings and transcripts; unmounting releases the microphone.
- **AI exercise generation:** `lib/use-generation-job.ts` is the one client hook for `POST /api/exercises/generate` (running/failed/cancelled states, abort on cancel or unmount), shown only when `/api/capabilities` reports `exerciseGeneration.available`.
  - *Speaking* (`features/speaking/topic-generator.tsx`): "Generate with AI" in "Your own topics" → settings (level B2/C1/C2, format, category, optional focus, duration, optional interest) → preview → regenerate (sends earlier titles to avoid) / edit / save as a personal topic. The practice page shows the generated guidance, objectives, useful language and (collapsed) follow-up questions, with the CEFR disclaimer.
  - *Listening* (`features/listening/exercises/`): a third practice mode, **Comprehension**, enabled once a transcript exists. The transcript panel is replaced by the list of saved sets while answering. Answers save as you go; "Check answers" locks them and reveals correct answers, explanations and the evidence passage with "Play this part" (seeks with `useBoundedPlayback`). Short answers are self-assessed against accepted answers (a word-match hint is shown, never a verdict). Updates are functional so a blur-save and a submit in the same tick can't overwrite each other. A set whose transcript fingerprint no longer matches is flagged and its playback links are hidden.
- **Writing Lab (M4):** `features/writing/`. `/writing` (task generator with preview, regenerate and edit; saved tasks with draft status; submitted texts), `/writing/tasks/:taskId` (editor: serif writing surface, live word/character count against the range, autosave with `createAutosaver` — debounced, serialised, latest value wins, flushed on blur, pagehide and hidden tab — optional timer persisted with the draft, task brief beside the editor and summarised above it on phones), `/writing/attempts/:attemptId` (submission creates the attempt and removes the draft, then requests feedback; summary with seven dimension levels, required elements and priorities; text tabs: inline-annotated corrections, original, errors fixed only, optional improved version with notes; corrections list filterable by errors/suggestions; revise the text as a new draft; assess again).
- **Grammar Lab (M4):** `features/grammar/`. `/grammar` (generator, saved sets with last/best results) and `/grammar/sets/:setId` (one card per question: radio options, gap inputs, transformation with keyword, error correction starting from the original, word tiles for word order; answers autosaved; "Check answers" locks the round, shows the key, rule, why each option is right or wrong, and offers a second opinion on unmatched open answers; "Try again" clears answers and keeps the history). Shared pieces: `ChoiceGroup`/`CheckGroup` tiles, `AutoGrowTextarea`, `useApiJob`, `useElapsedSeconds`, `lib/storage/keyed-store.ts` and `feature-storage.ts`.
- **Reading Lab (M5):** `features/reading/`. `/reading` (generate or paste; library with progress) and `/reading/texts/:textId`: a reading surface with adjustable size, spacing, width and typeface (per-device preferences in localStorage), progress from an IntersectionObserver over paragraphs plus an explicit "finished" mark, and a tools panel with **Look up** and **Comprehension**. `useTextSelection` follows `selectionchange` (mouse, keyboard, touch), accepts selections within one paragraph of up to eight words and computes paragraph offsets; typed search offers the same for keyboard users. Native selections keep the browser highlight (re-rendering would break them); only programmatic selections and question evidence are drawn as marks. On phones a compact action bar offers the lookup while the panel is off screen.
- **Vocabulary Lab (M5):** `features/vocabulary/`. `/vocabulary` (collection with search and type/status filters, row selection for practice, practice generator, practice sets), `/vocabulary/entries/:id` (dictionary-style detail per sense with the source sentence and link, review state, sense and entry deletion), `/vocabulary/review` (due queue: recall from the context sentence, reveal, rate again/good/easy, saved per rating) and `/vocabulary/practice/:setId` (autosaved answers, deterministic scoring, matching with stable seeded shuffles, AI feedback on open answers, retries with history).

## 9. Testing strategy

| Layer | Tool | Scope |
| --- | --- | --- |
| Domain (`shared`) | Vitest | Subtitle parsing, YouTube parsing, media validation and content signatures, time utilities, text comparison and WER, practice time maths, dictation progress, transcript cue building, record schemas, recording-format negotiation, fluency metrics, assessment schemas and request limits, evidence verification |
| Client speaking | Vitest + fakes | `AudioRecorder` lifecycle and failures (permission, devices, unsupported formats, cancel during the permission prompt, unplugged microphone, max duration, size), speaking repository contract and opt-in recordings, v1 → v2 migration preserving M1/M2 records, transcript review and attempt building, prompt library integrity |
| Client storage | Vitest + `fake-indexeddb` (dev only) | Repository contract run against both the IndexedDB and in-memory implementations, atomic session+transcript creation, M1-record compatibility, reload persistence, corrupt records, aborted writes, blocked upgrades, missing IndexedDB, error mapping, session creation from a transcription |
| Server | Vitest + `fastify.inject` + real sockets | Routes, error envelope, capabilities, security headers, env validation, transcription with mocked Groq responses (success, missing metadata, invalid responses, 400/401/413/429/5xx, network failure, timeout, concurrency), upload validation (type, MIME, content, size, fields), temp-file cleanup on every path including client disconnects mid-upload and mid-provider-call, request guards, key redaction, stale-upload sweep; speaking assessment with mocked chat responses (strict and JSON Object Mode requests, invalid or truncated output, invented quotes, CEFR or score fields, input limits, CSRF, timeouts, disconnects, error mapping), strict-schema structure; exercise generation with mocked chat responses (speaking and listening requests, invalid/missing/extra fields, unsupported formats and types, invented evidence, unknown segment ids, transcript injection kept as data, caps, truncation, 1 MB limit, CSRF, 429/5xx/401/404 mapping with redaction, network failure, timeout, concurrency, disconnect, capabilities). No real API key is needed. |
| Generation domain (`shared`) | Vitest | Request validation per kind, speaking and listening schemas, listening evidence verification (case/punctuation-insensitive, cross-segment spans, short or invented quotes, unknown segments, inconsistent options), transcript preparation and fingerprinting, answers, locking and result summaries |
| Client generation storage | Vitest + `fake-indexeddb` | Exercise-set contract on both repositories, answers and results, survival across transcript replacement, cascade on session delete, corrupt records, v2 → v3 migration preserving M1/M2/M3 records |
| Writing and grammar domain (`shared`) | Vitest | Word counting and range status, writing request/task/assessment/record schemas (no model answers, scores or CEFR results), correction evidence (offsets, whitespace and quote styles, invented or no-op quotes, overlaps, later occurrences, suggestion priority), annotation and error-only application; grammar request schemas, answer normalisation (harmless vs meaningful differences), question verification per type and ambiguity, deterministic scoring, attempt lifecycle, locking, retries and second-opinion rules |
| Server M4 | Vitest + `fastify.inject` | Writing and grammar generation (strict requests, settings kept, word-range normalisation, source-text rules, invalid output, discarded questions), writing assessment (verified spans, withheld invented and no-op corrections, injection kept as data, malformed output, input limits), improvement (length guard), grammar second opinion (closed types rejected, invalid verdicts), configuration, CSRF, 1 MB limit, error mapping with redaction, timeout, truncation, concurrency, strict-schema structure |
| Client M4 storage | Vitest + `fake-indexeddb` | Keyed-store contract on IndexedDB and memory, one draft per task, attempts by task, task deletion keeping attempts, invalid records rejected, draft restore after reload, corrupt records skipped, grammar rounds and retries, autosaver (debounce, flush, serialised writes, failures, dispose), v3 → v4 migration preserving M1/M2/M3 records |
| Reading and vocabulary domain (`shared`) | Vitest | Request and output schemas, paragraph splitting and import limits, reading time, sentence context, word containment, vocabulary suggestion and question verification (unsupported claims, invalid paragraph references, short quotes, copy-only answers, injection as text), answers and locking; lookup context checks, saving with duplicate and multiple-meaning handling, review ladder and due lists, practice verification per type, deterministic scoring, open answers never string-judged, lifecycle and AI-review rules |
| Server M5 | Vitest + `fastify.inject` | Reading, question and practice generation (strict requests, verified output, discarded items, no URL fields), lookups (context checks before Groq, evidence check after, Portuguese only on request, malformed output), evaluations, configuration, CSRF, 1 MB limit, error mapping with redaction, timeout, truncation, concurrency, strict-schema structure |
| Client M5 storage | Vitest + `fake-indexeddb` | Reading and vocabulary repositories on IndexedDB and memory, text deletion cascading to question sets, duplicate-free saving, review updates, practice sets, corrupt records, reload persistence, v4 → v5 migration preserving Listening, Speaking, Writing and Grammar records |
| Client | Playwright MCP (manual, scripted checks) | Navigation, Listening, Speaking, Writing, Grammar, Reading and Vocabulary flows, migrations in a real browser, responsive layout at desktop and 375 px, accessibility tree |

Component tests (Testing Library) will be added when the client gains non-trivial interactive logic beyond what `shared` covers.

## 10. Localisation

- **Target language:** `LanguageCode` and a language registry live in `shared`. All future content (exercises, vocabulary, transcripts) carries a `language` field.
- **Interface language:** English strings are in components for now. If interface localisation becomes a goal, extract the strings to message catalogs. The module registry already centralises module names and descriptions.

## 11. Design system

See [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md).
