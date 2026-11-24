# Product audit: from Pre-A1 to C2

Audit date: 22 November 2026. Branch `feat/vocabulary-data-pipeline` (`main` at `706e61e` plus the vocabulary pipeline). This is a read-only audit: no code, schema, pipeline or content was changed.

Companion documents: `docs/LEARNING_FRAMEWORK.md` (the level framework and the beginner journey) and `docs/ROADMAP_NEXT_PHASES.md` (milestones).

## 1. Summary

Línguas de Gato is a well-engineered **practice workspace for an advanced learner**, and it says so. The product specification describes "a personal … workspace … for an advanced learner", with the current level "B2 (CEFR) English" and the goal "C1, then C2" (`docs/PRODUCT_SPEC.md`).

The code enforces that audience in the shared contracts:
- **Every generator is B2–C2 only:** `GENERATION_LEVELS`, `GRAMMAR_LEVELS`, `READING_LEVELS`, `SPEAKING_LEVELS` and `WRITING_LEVELS` are all `['B2', 'C1', 'C2']`.
- **Advanced grammar topics:** inversion, cleft sentences, participle clauses…
- **Advanced built-in speaking prompts:** B2 and C1 only.

A complete beginner cannot start. The gap is not a missing screen; four things are absent:
1. **A course:** there is no sequence of what to learn first; the app is a set of tools, organised by module.
2. **Teaching:** every module tests or gives feedback, and none presents new language before asking for it.
3. **Beginner-accessible input:** there are no A1 texts, no built-in audio and no slow, graded listening. Listening needs the learner's own media.
4. **A support language in the interface:** the whole UI, every instruction and all grammar explanations are in English (`<html lang="en">`, no message catalogue). Portuguese appears only as an optional explanation in vocabulary lookups.

The foundations are good and reusable:
- local-first persistence and backups;
- evidence-based AI feedback with verified quotes;
- the Learning Engine's traceable observations;
- the vocabulary content contract and the licence-aware data pipeline;
- the design system and testing discipline.

What is missing is the pedagogical layer underneath them: a curriculum, lessons and graded content.

## 2. Method and evidence

The audit read the implementation, not only the documents:
- **Routes:** `apps/client/src/app/router.tsx`.
- **Features:** every folder in `apps/client/src/features`.
- **Contracts:** the shared contracts and domain logic, including levels, the grammar topics, the 32-category taxonomy (`packages/shared/src/learning/taxonomy.ts`), metrics, recommendations and the review ladder.
- **Server:** routes, AI modules, configuration and request guards.
- **Tests:** 23 shared, 23 client and 8 server test files (898 tests); 87 pipeline tests.

The documentation is broadly accurate. Where it differs, the difference is noted.

## 3. What exists today

| Area | State | Evidence and notes |
| --- | --- | --- |
| Today / dashboard | Works | Continue, recent activity, reviews due, shortcuts. On first run it shows "Where to start": a list of all seven modules. There is no onboarding, no level question, and no first step chosen for the learner. |
| Listening | Works, at an advanced level | Own media or YouTube embed, subtitle import, Whisper transcription, dictation with word-level diff, AI comprehension questions (B2–C2), persistence. **No built-in content**: the learner must bring audio or video. |
| Speaking | Works, at an advanced level | 14-prompt library (B2/C1), AI-generated tasks (B2–C2), recording, transcript review, AI feedback on grammar, vocabulary, coherence, naturalness and task, fluency measurements. **Pronunciation is not assessed** ("planned"). |
| Writing | Works, at an advanced level | 12 formats (essays, reports, proposals…), B2–C2, drafts, AI feedback separating errors from suggestions. |
| Grammar | Works, at an advanced level | AI-generated question sets on 12 advanced topics. Rules are shown **after** checking. There is no grammar instruction before practice and no beginner topics (to be, present simple, articles at A1 level, word order). |
| Reading | Works, at an advanced level | AI-generated B2–C2 texts or pasted texts, reading view, lookups (optional Portuguese explanation), grounded questions. |
| Vocabulary | Works | Collection from Reading lookups, simple review ladder `[0,1,3,7,16,35]` days, AI practice. Library and Trainer: 47 demonstration entries, typed Spelling / Context / Definition rounds, hints, graded feedback. |
| Learning Engine / Progress | Works | Observations from all modules, a 32-category taxonomy (no pronunciation category), insights with thresholds, recommendations, targeted practice (B2–C2), metrics over time ranges. |
| Settings & data | Works | Theme, reading view, Portuguese explanation toggle, backups (export, merge/replace import), storage. No interface language, no learner profile, no goals. |
| Persistence | Works | IndexedDB v6 per browser, versioned JSON backups, media kept in the browser by default. |
| AI integration | Works | Groq (Whisper; `openai/gpt-oss-120b` for chat) through a local server. The learner's own key lives in `apps/server/.env`. Structured outputs and server-side verification. |
| Security | Fit for a local, single-user app | Bound to `127.0.0.1`; state-changing requests need a loopback Host header, `Sec-Fetch-Site` same-origin and a custom header; no persistence on the server. No authentication, no per-user data, no rate limiting beyond transcription concurrency. |
| Vocabulary data pipeline | Works (offline tool) | Two licence profiles, a 400-candidate English pilot and its review package. Not connected to the app. |
| Placement / level test | Missing | |
| Course, units, lessons | Missing | |
| Graded content below B2 | Missing | The contracts reject it. |
| Built-in audio (TTS or recordings) | Missing | The trainer's Audio mode is reserved. |
| Pronunciation | Missing | Documented as planned. |
| Interface in Portuguese | Missing | |
| Multi-user, accounts, sync | Missing (by design) | |

## 4. The complete beginner

**Persona:** Portuguese, no English, no basic vocabulary, cannot form a sentence, does not know grammar terminology, struggles with spoken English, and needs clear explanations and guided practice.

**Can this person start? No.** Walking through a first session:
1. **Opening the app (Today):** "No practice is saved in this browser yet. … Where to start." Seven cards appear: Listening, Speaking, Writing, Grammar, Reading, Vocabulary, Progress. Each summary is in English. Nothing says which to choose; for this learner, all seven are wrong.
2. **Grammar:** the choices are "conditionals", "inversion", "cleft sentences", "participle clauses" at level B2, C1 or C2, with six question types such as "transformation" and "error correction". The terminology alone is a barrier, before any English.
3. **Reading:** generates a B2–C2 text (opinion piece, report…) or asks for pasted text. A lookup explains words in English, with an optional Portuguese paraphrase. Reading a B2 text word by word is not comprehensible input.
4. **Listening:** "drop a file or paste a YouTube link". There is nothing to listen to unless the learner finds it, and dictation of native-speed audio is out of reach.
5. **Speaking:** prompts such as debates and critical-thinking tasks at B2/C1. The feedback (grammar, coherence, naturalness, task achievement) presupposes producing paragraphs.
6. **Writing:** essays, reports and proposals at B2–C2.
7. **Vocabulary Trainer:** the closest to usable.
   - **Spelling** shows a Portuguese meaning and asks for the English word, but the learner has never *seen* the word: it tests recall without prior teaching.
   - **Definition** shows an English definition, which is unreadable at A1.
   - **No sound:** there is no audio, so the learner never hears the word.
   - **Demo content:** the 47 demo words are a demonstration, not a sequence.

**Every point where prior knowledge is assumed:**

| Point | Assumption | Concrete example |
| --- | --- | --- |
| Interface language | The learner reads English UI text | "Practise the 4 that were hard", "Right word, wrong form", "Show the first letter" |
| Onboarding | The learner knows what they need | A module menu, with no goal, level or first step |
| Level | B2 or above | Contracts reject A1–B1 for every generator |
| Lesson structure | None needed | No units, no "learn → practise → use" sequence |
| Vocabulary introduction | Words come from texts the learner reads | The Reading lookup flow presumes reading ability |
| Grammar explanations | English metalanguage, after the fact | Rules shown after a check, in English |
| Exercise instructions | English, terse | "Complete the sentence with the missing word, in the form the sentence needs." |
| Listening difficulty | Native-speed authentic media | YouTube, own files, dictation |
| Speaking support | Paragraph-level production | Debate prompts, coherence feedback |
| Reading difficulty | B2+ texts | Generator levels B2–C2 |
| Writing feedback | Long texts | Essay-oriented dimensions |
| Hints | Recall with partial letters | Length → first letter → letters; no picture, audio or translation hint |
| Error explanations | Grammar terminology in English | "subject_verb_agreement", "participle_clauses" in Progress |
| Progress feedback | Self-directed improvement on an error taxonomy | Recurring "inversion" errors are meaningless to a beginner |
| Navigation and cognitive load | Freedom to choose among 7 modules | Equal weight for every module; no path |

## 5. The Vocabulary Trainer by level

| Level band | Fit | Why |
| --- | --- | --- |
| Pre-A1 / A1 | Poor | Productive typed recall before any exposure; English definitions; no audio, pictures or recognition; no sequence. |
| A2 / B1 | Partial | Spelling and Context are useful once words have been met; Definition becomes usable around B1. Still needs recognition first, audio, and a sequence linked to lessons. |
| B2 / C1 / C2 | Good basis | Context with exact forms, wrong-form detection and hints fit. Still missing: collocations, multiple meanings, word families and phrasal verbs, and (for C1/C2) register and nuance. |

Exercise types, in priority order (only those that are genuinely needed):
1. **Recognition (receptive):** see or hear the word and choose the meaning, from options or pictures. This is the first contact for a beginner, and the trainer has nothing like it.
2. **Listening recognition:** hear the word or phrase, then choose or write it. Essential, because beginners must map sound to form. It needs audio (`ROADMAP_NEXT_PHASES.md`, M13).
3. **Meaning recall (Portuguese → English, typed):** exists (Spelling).
4. **Context (gap fill with exact form):** exists. It should become multiple choice at A1–A2 and typed from A2.
5. **Sentence production:** use the word in a short sentence, with AI feedback only where needed. B1+.
6. **Word forms and families:** walk / walked / walking; decide / decision. A2–B2.
7. **Collocations and phrasal verbs:** B1–C1. Partly covered by AI practice today.
8. **Multiple meanings:** sense discrimination in context. B2+.
9. **Pronunciation:** listen, repeat and compare. It needs reliable assessment, so defer until a dependable method exists; do not fake it.
10. **Definition → word:** exists. Keep it for B1+.

## 6. Learning methods

| Method | State | Evidence and gap |
| --- | --- | --- |
| Spaced repetition | Partial | A fixed ladder `[0,1,3,7,16,35]` days with "again / good / easy"; the trainer feeds it with a careful rating policy. No per-item difficulty, no separation of recognition from recall, and only one schedule per word, not per sense. |
| Retrieval practice | Present | Trainer recall, grammar sets, comprehension questions, dictation. |
| Interleaving | Weak | One mode per trainer round, one topic per grammar set; reviews mix entries but nothing mixes skills deliberately. |
| Comprehensible input | Absent below B2 | No graded texts or audio; nothing at i+1 for a beginner. |
| Progressive difficulty | Absent | Levels are chosen by hand, and only from B2. |
| Error-based learning | Strong (advanced) | Traceable observations, recurring-error insights, targeted practice generated from real mistakes. |
| Explicit grammar instruction | Absent | Rules appear only after checking; no presentation, examples or guided noticing. |
| Productive vs receptive vocabulary | Productive only | The trainer is all typed recall; there is no receptive stage. |
| Adaptive learning | Partial | Recommendations rank weak areas, but neither difficulty nor sequence adapts. |

**Activity volume versus learning.** The current metrics count actions:
- `activeDays` counts days with *any* action;
- `completedExercises` counts submissions;
- metrics count rounds, reviews and attempts.

They are honest and labelled, but they measure *effort*. The Learning Engine should report evidence of learning instead (details in `LEARNING_FRAMEWORK.md` §6):
- **Delayed retention:** recall success on items seen ≥ 1 week earlier.
- **Accuracy trends per skill and category, with denominators:** the engine already keeps these, for advanced categories.
- **Can-do outcomes:** tasks completed at a level, checked by the task itself.
- **Exposure versus mastery:** "seen", "recognised", "recalled", "used correctly" as separate states.

Activity totals should never be presented as progress.

## 7. Multi-user and production readiness

Today the app is intentionally local and single-user. Making it a hosted platform is a different product shape, and needs a decision about sync: local-first with sync, or server-first.

**Essential before any second user:**
- **Authentication:** a proven provider or standard (OIDC or passwordless email). Never home-grown passwords.
- **Authorisation and data isolation:** every row owned by a user and enforced server-side, with tests proving one user cannot read another's data.
- **Server database** (e.g. PostgreSQL) with migrations, replacing or syncing IndexedDB. Backups with tested restore.
- **API security:**
  - keep the Zod validation;
  - add authentication on every route, CSRF protection suited to cookie sessions, strict CORS, security headers (already partly present) and upload validation (already present).
- **Rate limiting and AI cost control:** per-user quotas, request size limits, concurrency caps, and budget alerts. Today the learner's own Groq key pays; a platform pays for everyone.
- **Secrets:** server-side only, in a secret manager or the deployment environment, rotated, never in the client (already a project rule).
- **Media:** voice recordings are personal data. They need private object storage, signed URLs, size limits, retention rules and deletion.
- **Privacy / GDPR:**
  - a lawful basis and a privacy notice;
  - a data-processing agreement with the AI provider and a disclosure of transfers;
  - data export and account deletion, including media and backups, within deadlines;
  - minimal retention.
- **Logging and monitoring:** structured logs **without** learner content or audio; error tracking; uptime.
- **Deployment:**
  - HTTPS;
  - environments (development, staging, production);
  - CI running the existing tests;
  - dependency updates;
  - an incident and recovery runbook, with restore tested.

**Optional infrastructure** (only when needed): CDN, multi-region, SSO, analytics, background job queues, horizontal scaling.

**Security fundamentals to keep even while local:**
- dependency audits;
- secrets in `.env` only;
- the existing request guards;
- no logging of learner content.

## 8. Multilingual readiness

The content model is language-neutral (`docs/VOCABULARY_CONTENT_MODEL.md`), but the implementation is English with Portuguese (Portugal) as support. Before another target language, these must change:

| Area | Change |
| --- | --- |
| Language codes | `LANGUAGE_CODES` and varieties as BCP 47 |
| Support language | Translation records per support language, replacing pack `translations['pt-PT']` and `portugueseExplanation` |
| Grammar | Feature-based forms (UD) |
| AI prompts | Per-language prompts and checks (all assume English today) |
| Answer checking | Per-language rules (elision, clitics, `¿¡`) |
| Interface | Localisation, independent of target and support languages |
| Pipeline | Per-language sources, adapters and licence decisions |
| Curriculum | Per target language, probably sharing the framework but not the content |

None of this should be built before the English beginner path exists.

## 9. Critical review

**Overengineering, relative to the current audience gap.**
- **Pipeline ahead of the curriculum.** The vocabulary data pipeline (two licence profiles, ESDB build review, 87 tests) prepares a 15–20k-entry library, while a beginner course needs a few hundred carefully chosen, taught and recorded words first. The work is sound and reusable, but it ran ahead of the curriculum that should decide what to select.
- **Learning Engine ahead of its users.** Its 32-category taxonomy, insights and recommendations are tuned for B2+ errors (inversion, cleft sentences); for beginners its categories and thresholds don't apply yet.
- **Polish ahead of the course.** Backup merge semantics, media retention policies and update banners are good engineering, but invisible to the main missing value.

**Missing foundations.**
- a curriculum and lesson model;
- teaching before testing;
- graded input (texts and audio);
- audio for every word and sentence;
- a Portuguese interface;
- placement;
- a per-skill learner profile;
- mastery states;
- pronunciation support (even listen-and-repeat).

**Low learning value for a beginner.**
- activity totals and active days;
- recent-activity feeds;
- AI-generated advanced tasks;
- free choice among seven modules.

**UX problems.**
- **Module-first navigation:** nothing gives a goal-first or path-first view.
- **Equal weight:** every module carries the same weight.
- **No guidance:** no "next lesson".
- **Language barrier:** English metalanguage everywhere.
- **No reassurance:** no sense of where the learner stands.

**Architectural risks.**
- **Levels in the contracts:** they are hard-coded in five contracts, plus targeted practice.
- **Lessons:** nothing in the schema models a lesson, unit, course or learner profile.
- **Content shape:** the content contract (one entry, translations keyed `pt-PT`) predates the reviewed content model.
- **Storage:** IndexedDB-only storage blocks multi-device use.
- **AI dependency:** core flows depend on a single AI provider.

**Unnecessary or risky AI use.**
- **Beginner content should be curated,** not generated on the fly. Generated A1 material is inconsistent, can be wrong in subtle ways, costs per request, and cannot be reviewed.
- **Use AI only where it adds real value,** with human-reviewed drafts for content:
  - feedback on open production;
  - explanations on demand, in Portuguese and simplified;
  - variation of practice items.

**What to postpone.**
- multi-user infrastructure;
- other target languages;
- the 15–20k library import;
- C1/C2-specific features beyond what exists;
- pronunciation scoring (until a reliable method exists).

**Assumptions that may be wrong.**
- that a learner can self-direct across modules;
- that frequency ranking can drive a curriculum;
- that AI can generate beginner content reliably without review;
- that English-only UI is acceptable;
- that one product can serve B2 → C2 and Pre-A1 equally without an explicit path per stage;
- that a personal tool needs a 15–20k library before it needs a first lesson.

**The strategic decision.** Serving complete beginners changes the product's stated persona. That is a deliberate pivot, not a feature. It should be decided explicitly, since it implies years of content work, and recorded in the product specification before building.
