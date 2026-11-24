# Product direction review

Review date: 22 November 2026. This is an assessment and planning document. No code, contract, schema, pipeline, dataset, test, configuration or existing document was changed to write it.

It evaluates a proposed direction: a multi-user, multilingual platform with two learning experiences, **Guided Learning** (Pre-A1 to A2) and **Practice & Immersion** (B1 to C2), with English as the first target language. It synthesises the M10 documents (`PRODUCT_AUDIT_PRE_A1_C2.md`, `LEARNING_FRAMEWORK.md`, `ROADMAP_NEXT_PHASES.md`) and the vocabulary documents rather than repeating them, and checks every important claim against the source code.

**Status labels used throughout**

| Label | Meaning |
| --- | --- |
| **Implemented** | In the code and working, with tests. |
| **Limited** | Implemented, with limits that matter for the new direction. |
| **Documented only** | Described in a document; not in the code. |
| **Proposed** | A recommendation, in this document or an earlier proposal. |
| **Missing** | Neither built nor designed. |
| **Unknown** | Can't be settled by reading the repository; needs validation. |

---

## 0. Repository state at the time of review

| Item | State |
| --- | --- |
| Current branch | `feat/vocabulary-data-pipeline` at `d058e60` |
| Upstream | None. The branch has never been pushed. |
| Relation to `main` | 4 commits ahead of local `main` (`706e61e`): the pipeline (`a64969b`), the corrected research report (`8d0aab5`), the pilot review packages (`1f790a9`) and the content model and pilot protocol (`d058e60`). |
| Local `main` vs `origin/main` | Local `main` is **6 commits ahead** of `origin/main` (`37b74a4`) and not pushed: M7 module UX refinement (`7e2f36e`), M8 media docs and persistence (`fbcf01f`, `9b7e5fe`), the M9 trainer and its docs (`c4592d4`, `46dfef1`) and the corpus research report (`706e61e`). |
| Uncommitted changes to tracked files | None. |
| Untracked files | `docs/LEARNING_FRAMEWORK.md`, `docs/PRODUCT_AUDIT_PRE_A1_C2.md` and `docs/ROADMAP_NEXT_PHASES.md` (the M10 proposal). Left untouched. |
| Stashes | None. |
| Pipeline outputs | `tools/vocabulary-data/output/` and `raw/` are git-ignored. The pilot review package exists locally at `output/redistributable/pilot-v3-review/`. **None of the 400 rows has a review decision yet:** `reviewer_decision`, `approved_lemma`, `pedagogical_usefulness` and `beginner_relevance` are empty in all 400. |
| Tests (counted, not run) | 54 TypeScript test files; 87 Python test functions in `tools/vocabulary-data/tests`. The M10 audit reports 898 TypeScript tests passing; this review did not run them again. |

**Housekeeping risk.** Eleven commits of finished work (M7 to M9 and the pipeline) exist only on this machine. Pushing `main` and deciding what to do with the pipeline branch is the user's decision, but it should come before the next milestone.

---

## 1. Executive summary

**The direction is sound. The order in the current proposal is not.**

- **Where the app is today.** Línguas de Gato is a carefully engineered **practice workspace calibrated for B2 → C1/C2 English**. Every generator contract accepts only `B2 | C1 | C2`, and every AI prompt describes the learner as "moving from B2 towards C1/C2".
- **What the proposal adds.** A guided beginner path, multiple language profiles and, eventually, accounts: a much larger product.
- **The sequencing conflict.** `ROADMAP_NEXT_PHASES.md` puts the complete beginner first and widens the existing modules to B1 only at M19, after six content and engine milestones. The only real user today is the developer, at about **B1/B2**. Widening the practice modules to B1 is the cheapest, highest-value change available, and nothing in the code requires it to wait for the beginner course.

The main conclusions:

1. **Don't build a `GUIDED | PRACTICE` mode.** Build one platform with two *sources of activity*:
   - a **curriculum** (courses, units, lessons) that the learner may enrol in;
   - an open **practice library** that is always available.

   Both are scoped to a **language profile**. What the learner is offered is decided per skill from the profile's estimates, enrolment and goals, not by a global switch (§3).
2. **Keep five concepts apart:** declared level, estimated level, per-skill proficiency, course progression and demonstrated item knowledge. Language scoping in the code is **inconsistent today**:
   - Writing and Grammar records carry no `language`;
   - the vocabulary collection is keyed by the lemma string alone, ignoring language and part of speech;
   - the Learning Engine reads every record unscoped.

   Fixing this is small and should come before any profile UI (§4).
3. **Vocabulary has three layers that the code partly merges.**
   - **The catalogue** exists as pack schema v1.
   - **The curriculum** is missing.
   - **Learner knowledge** is merged into "my saved words": one review state per lemma string, shared by every sense, part of speech, exercise mode and direction. A single correct answer moves it a step.

   The matcher, hints, pack loader and round builder are good and reusable. The next step is item-level evidence and per-facet scheduling, then new exercise types (§5).
4. **The M9 pipeline is high quality, but it ranks the wrong thing for a curriculum.** Its redistributable profile ranks words by frequency in printed books, has no function words, contractions or multiword expressions, and has no review decisions yet. Stop scaling it. Use it as an **evidence service** for curriculum-driven selection, and use a small part of the 400-candidate pilot to calibrate the review protocol (§6).
5. **AI needs a learner context, not a fixed persona.**
   - Thirteen server prompts hard-code the B2→C1/C2 learner.
   - The writing rubric defines "strong" at C1 standard.
   - `LEVEL_GUIDE` only describes B2 to C2.

   A bounded, server-built `LearnerContext` (target and support language, level band per skill, exercise type and, for guided work, the taught inventory) unlocks B1 now and later bands safely (§7).
6. **Multi-user infrastructure stays deferred,** but five cheap preparations are worth making now: language and profile scoping, `updatedAt` on mutable records, append-only evidence, stable UUIDs (already done), and repository seams (already present). The loopback-only request guards are the main hard blocker to hosting, and correctly so for now (§9).

**Recommended immediate next milestone: E1, "English B1 practice band"** (§10). It makes the existing Reading, Listening comprehension, Writing, Speaking and Grammar modules genuinely usable at B1 through level-parameterised prompts and validation, with regression protection for B2 to C2. It can run in parallel with **F1, language-scoped profiles**, and with authoring of the first guided unit as data (**G0**).

---

## 2. Current implementation versus the intended product

### 2.1 Capability matrix

| Capability | Intended | Status | Evidence |
| --- | --- | --- | --- |
| Listening (own media, YouTube embed, transcription, dictation, A-B loops) | Practice, all levels with own media | **Implemented** | `features/listening/*`, `domain/dictation.ts`, `routes/transcriptions.ts` |
| Listening comprehension questions | Practice, B1–C2 | **Limited**: B2–C2 only | `GENERATION_LEVELS = ['B2','C1','C2']` (`contracts/exercise-generation.ts:35`) |
| Reading (generated or pasted texts, lookups, questions) | Practice, B1–C2 | **Limited**: generation B2–C2; pasted texts work at any level | `READING_LEVELS` (`contracts/reading.ts:14`) |
| Writing (tasks, drafts, feedback) | Practice, B1–C2 | **Limited**: B2–C2; rubric anchored at C1 | `WRITING_LEVELS` (`contracts/writing.ts:15`); `WRITING_ASSESSMENT_PROMPT` (`modules/ai/groq-writing.ts:59`, "strong … at C1 standard") |
| Speaking (prompts, recording, feedback) | Practice, B1–C2 | **Limited**: 14 curated prompts (B2/C1); generation B2–C2; custom topics may have no level | `SPEAKING_LEVELS` (`contracts/speaking.ts:33`); `features/speaking/prompt-library.ts` |
| Grammar (generated sets) | Practice, B1–C2; guided grammar at A1–A2 | **Limited**: 12 advanced topics, B2–C2, rules shown only after checking | `GRAMMAR_LEVELS`, `GRAMMAR_TOPICS` (`contracts/grammar.ts:13,17`) |
| Vocabulary collection and review | Both | **Limited**: one schedule per lemma string | `vocabularyKey` (`domain/vocabulary.ts:33`); `REVIEW_LADDER_DAYS` (`:46`) |
| Vocabulary Trainer | Both | **Limited**: 47-entry demo pack; three productive modes; no receptive mode or audio | `domain/vocabulary-trainer.ts`; `public/content/vocabulary/en/demo-everyday.json` |
| Learning Engine (observations, insights, recommendations, targeted practice) | Both | **Implemented** for B2+ error categories; not language-scoped | `packages/shared/src/learning/*` |
| Today | Both | **Implemented**: continue work and due reviews; no "next lesson" | `learning/today.ts`, `features/dashboard` |
| Backups | Both | **Implemented**: versioned, validated, merge or replace | `learning/backup.ts`, `features/data-management` |
| Courses, units, lessons | Guided | **Documented only** (proposal) | `LEARNING_FRAMEWORK.md` §4; nothing in contracts |
| Teaching before testing | Guided | **Missing** | No presentation step anywhere |
| Receptive exercises (recognition, listen and choose) | Guided, vocabulary | **Missing** | `TRAINER_MODES` reserves `audio` only |
| Built-in audio | Guided | **Missing** | `audio` field reserved in `packSenseSchema` |
| Placement | Both | **Documented only** | `LEARNING_FRAMEWORK.md` §2 |
| Language-learning profiles | Platform | **Missing** | No profile record; `explanationLanguage` and reading preferences in `localStorage` |
| Several target languages | Platform | **Limited**: the type exists, with one value | `LANGUAGE_CODES = ['en']` (`domain/languages.ts:7`) |
| Support language | Platform | **Limited**: Portuguese hard-coded | `TRANSLATION_LANGUAGES = ['pt-PT']`; `portugueseExplanation`; `EXPLANATION_LANGUAGES = ['en','pt']` |
| Interface localisation | Guided | **Missing** | English strings in components |
| Lexical catalogue (reviewed) | Both | **Documented only** (content model); v1 pack contract implemented | `docs/VOCABULARY_CONTENT_MODEL.md`; `contracts/vocabulary-pack.ts` |
| Curriculum | Guided | **Missing** | — |
| Item-level learner knowledge | Both | **Missing** | Review state is per collection entry |
| Accounts, authentication, server database, sync | Platform | **Missing** (a non-goal in `PRODUCT_SPEC.md` §3) | `plugins/request-guards.ts` accepts only loopback hosts |
| AI cost controls | Platform | **Limited**: per-process concurrency (2) and timeouts | `routes/ai-job.ts:24–28` |
| Pronunciation | Both | **Missing**, labelled planned | — |

### 2.2 Contradictions between existing documents

Recommended reconciliation is in decision D0 (§10).

| # | Contradiction | Where | Recommendation |
| --- | --- | --- | --- |
| C1 | **Persona.** The specification names a B2 learner aiming at C1/C2 and lists "no accounts" and "no server database" as non-goals. The M10 proposal pivots to the complete beginner. The new direction says the developer is about B1/B2 and the product will be multi-user. | `PRODUCT_SPEC.md` §2–3; `PRODUCT_AUDIT_PRE_A1_C2.md` §9; this brief | One decision record covering three things: (1) English B1–C2 practice stays first-class for the current learner; (2) a guided Pre-A1–A2 track is added; (3) accounts and a server database become "not yet", not "never". |
| C2 | **Library import.** M9's "Later" list plans an import of 15,000–20,000 entries; M10 says not to import before the curriculum exists. | `ROADMAP.md` M9 "Later"; `ROADMAP_NEXT_PHASES.md` §4 | Keep M10's position. Edit the M9 "Later" list to say the import is gated on curriculum and review. |
| C3 | **Sequencing.** M10 widens the existing modules to A2–B1 only at M19, behind the beginner course. The new direction needs English useful at B1/B2 now. | `ROADMAP_NEXT_PHASES.md` §1 | Split M19: B1 now (E1), A2 after the course (later). The M10 caution ("don't extend generators downwards before the course exists") is right for A1/A2, not for B1. |
| C4 | **Two meanings of "skill".** The framework levels five CEFR activities (listening, reading, spoken interaction, spoken production, writing). The engine's `SKILL_AREAS` are grammar, vocabulary, discourse, accuracy, listening and reading: error areas, not communicative skills. | `LEARNING_FRAMEWORK.md` §1.2; `learning/taxonomy.ts:56` | Rename the engine concept "error area" in documents (later in code). Use the CEFR activities for proficiency estimates (§4.2). |
| C5 | **The learning unit.** The content model says lemma + part of speech + sense. The collection and its review schedule are keyed by the lemma string, so *book* (noun) and *book* (verb) share one schedule, and so would *pain* in English and in French. | `VOCABULARY_CONTENT_MODEL.md` §1; `domain/vocabulary.ts:33`; `features/vocabulary/trainer/trainer-service.ts:146–152` | Learner knowledge moves to item references (§5.2). |
| C6 | **"Spelling" mode.** It is Portuguese → English meaning recall, which the framework calls "meaning recall". | `VOCABULARY_PACKS.md`; `domain/vocabulary-trainer.ts` (`questionFor`) | Rename it in the UI and docs when the trainer is next touched. |
| C7 | **Frequency source.** The research report recommends wordfreq as the primary frequency signal and CC BY-SA packs. The pipeline later registered wordfreq as `approved_internal` (restricted, not shippable), so the shippable profile ranks by printed-book frequency. | `VOCABULARY_CORPUS_RESEARCH.md` §16; `tools/vocabulary-data/sources/manifest.json` | Not an error, but a later, stricter decision. Note in the research report that it is superseded on this point. |
| C8 | **"Learning Engine ahead of its users."** For a beginner this is true. For the actual B1/B2 user, the engine is among the most useful parts of the app. | `PRODUCT_AUDIT_PRE_A1_C2.md` §9 | Reword when the audit is committed. |
| C9 | **Scope of the Portuguese interface.** M12 translates the whole app before the lesson player. The current learner doesn't need it, and the beginner surfaces don't exist yet. | `ROADMAP_NEXT_PHASES.md` M12 | Build localisation infrastructure early; translate the guided surfaces first (G2). |
| C10 | **Architecture.** It states there is "no database, no auth", which is accurate today. Its localisation section assumes an English UI. | `ARCHITECTURE.md` §1, §10 | Update once D0 is decided. |

---

## 3. The two learning experiences

### 3.1 What the current app offers a B1/B2 English learner

| Module | Useful at B1/B2 today? | What prevents or weakens it | Needed change (status: **Proposed**) |
| --- | --- | --- | --- |
| Listening: dictation, transcription, loops | **Yes.** Level-free; difficulty depends on the media the learner chooses. | No built-in graded audio. | None for B1. Graded audio belongs to the guided track. |
| Listening: comprehension questions | Partly. B2 is the floor. | Contract enum; `LISTENING_SYSTEM_PROMPT` persona. | Add a B1 band and a B1 guide. |
| Reading: pasted texts and lookups | **Yes.** | The lookup prompt assumes a B2 reader (`LOOKUP_PROMPT`, `groq-vocabulary.ts:45`); the Portuguese explanation is optional. | Make the lookup explanation level-aware. |
| Reading: generated texts and questions | Partly. B2 is the floor. | Enum; `READING_SYSTEM_PROMPT`; no length or complexity check. | B1 band; shorter texts; deterministic length and sentence-length checks. |
| Writing: tasks | Partly. | Enum; formats lean towards essays, reports and proposals. | B1 band; B1-appropriate formats (email, message, short story, review, opinion paragraph). |
| Writing: feedback | Works, but **mis-calibrated**: "strong" means C1. | `WRITING_ASSESSMENT_PROMPT` and `WRITING_IMPROVEMENT_PROMPT` anchor at C1. | Calibrate qualitative levels to the task's target band. |
| Speaking: practice and feedback | Works; feedback calibrated for B2→C1. | 14 prompts at B2/C1; `SYSTEM_PROMPT` in `groq-assessment.ts:68`. | B1 prompts; level-relative feedback. |
| Grammar | Partly. Some topics are B1-relevant (conditionals, passive, modals, relative clauses, reported speech, articles and prepositions), but the sets are generated at B2+. | Enum; `GRAMMAR_SYSTEM_PROMPT` persona; no B1 topics (present perfect vs past simple, `used to`, future forms, gerund vs infinitive); rules shown only after checking. | B1 band and topics; an optional short rule summary *before* the set. |
| Vocabulary: collection and review | **Yes.** | One schedule per lemma string. | §5. |
| Vocabulary Trainer | **Yes, but tiny.** The demo pack is in fact A1–B1 (9 A1, 20 A2, 16 B1, 2 unrated). | 47 entries, labelled demonstration. | §5 and §6. |
| Progress | **Yes.** The taxonomy covers articles, prepositions, tenses, agreement and word order. | Terminology in English; activity metrics dominate. | Minor wording; evidence of learning later (F2). |

**Verdict.** B1 is *not* supported today: no contract accepts it, no prompt describes it, and no rubric is calibrated for it. It is, however, within easy reach:
- the level is passed explicitly in every generation request;
- the outputs are already validated structurally;
- the main work is prompt calibration, level guides, a few deterministic checks and regression tests.

AI generation is reliable enough at B1 for practice material when it is constrained and checked. At A2 it is weaker, and at A1 and below it is not a sound source of core content (§7).

### 3.2 The boundary between the experiences

A rigid A2/B1 boundary fails in the cases the brief names, and the code already shows why:
- **A B2 learner with B1 listening.** Today they can only choose one level per task, and nothing remembers that their listening is weaker.
- **A B1 learner with a structural gap** (for example the present perfect) needs a short *taught* sequence, not more generated sets. Nothing teaches today.
- **An A2 learner who wants to read** their own material can already paste it, and the lookups work. Locking them inside a course would take that away.
- **Learners at every level** need spaced review and error-driven practice, and these are the same mechanism at every level.

**Recommended model (Proposed):**

```
LearningProfile (one per target language)
 ├─ skill estimates (per CEFR activity)          ← decides default bands and recommendations
 ├─ enrolments 0..n  ──► Curriculum
 │                         ├─ Course   (e.g. "English A0→A2", a full path)
 │                         └─ Strand   (e.g. "B1 grammar: present perfect", a short taught sequence)
 │                               └─ Unit → Lesson → Step → Activity
 ├─ practice library (always available)
 │     Listening · Reading · Writing · Speaking · Grammar · Vocabulary · Trainer
 │     each activity filtered by band, defaulting to the skill's estimate
 └─ Today = composer(profile): next lesson (if enrolled) + due reviews + recommended practice
```

- **One lesson engine** plays both full beginner courses and short strands for intermediate learners. A strand is how a B1/B2 learner gets structured teaching without a beginner course.
- **Practice is never locked.** Its *defaults* follow the skill estimate:
  - **Pre-A1–A1:** Today puts the path first, and the practice library only offers activities built from taught items (graded reading and listening, trainer reviews).
  - **A2–B1:** path and practice side by side.
  - **B2+:** practice first, strands on demand.

  These are recommendation weights, never permissions. The learner can always override.
- **The experience emerges** from enrolment, skill estimates and goals, so the same person can be "guided" in French and "practising" in English with no mode setting.

**Why a global `GUIDED | PRACTICE` (or `BASIC | ADVANCED`) flag is a poor abstraction:**
- it is per user, while levels are per language and per skill;
- it forces a migration moment ("graduate to Practice") that matches no real learning event;
- it doubles routes and screens instead of reusing the activity components;
- it hides the evidence that should drive recommendations.

### 3.3 What a guided experience needs that doesn't exist

All of the following are **Missing**:
- course, unit and lesson contracts;
- a lesson player;
- receptive exercise types;
- curated audio;
- support-language instructions and explanations;
- item-level knowledge;
- "next lesson" on Today;
- placement.

The M10 framework (§4 of `LEARNING_FRAMEWORK.md`) is a good pedagogical basis. This review changes its *sequencing and scope*, not its pedagogy.

---

## 4. Domain model: users and language profiles

### 4.1 Concepts

All rows are **Proposed** unless marked otherwise.

| Concept | Scope | Holds | Notes |
| --- | --- | --- | --- |
| **User** | Account (future) | Identity, interface language, theme, accessibility preferences | Not built now. Locally, the browser installation plays this role. |
| **LearningProfile** | User × target language | Target language and optional variety (BCP 47, e.g. `en`, `en-GB`); support language (e.g. `pt-PT`); goals and interests; profile preferences (explanation language, default bands) | **Invariant (recommended):** at most one profile per (user, target language). |
| **DeclaredLevel** | Profile | What the learner said (overall and optionally per skill), with the date | Never changed by the app. |
| **SkillEstimate** | Profile × skill | Band, basis (`declared`, `placement`, `checkpoint` or `evidence`), evidence references, updated date | The app's estimate, always shown with its evidence; never a certificate. |
| **Enrolment / CourseProgress** | Profile × course or strand | Course id and version, position, lesson completion, checkpoint results | Course progression, not proficiency. |
| **KnowledgeEvidence** | Profile × item × facet | Append-only evidence events (§5.2) | Demonstrated knowledge. |
| **ItemKnowledge** | Profile × item × facet | Derived state and review schedule | Derived from evidence; the schedule is stored. |
| **Activity records** | Profile (via language) | The existing listening, speaking, writing, grammar, reading and vocabulary stores | Already exist; need consistent scoping. |
| **Observations** | Derived | The existing Learning Engine evidence | **Implemented** (derived, never stored). Needs language scoping. |

**The five level concepts stay separate:**
1. **Declared:** the learner's statement.
2. **Estimated:** per skill, with its basis.
3. **Skill proficiency:** the per-skill estimate itself. It is not one global level.
4. **Course progression:** where the learner is in a course; it says nothing about proficiency.
5. **Demonstrated knowledge:** per item and facet, from evidence.

Passing unit 6 is progression. Recalling 85% of unit 6's items a week later is knowledge. Moving the listening estimate to A2 is an estimate change that cites both.

### 4.2 Which "skills"

- **Estimates** use the CEFR communicative activities from the framework: listening, reading, spoken interaction, spoken production and writing. Mediation is out of scope.
- **Vocabulary and grammar** are not levelled as skills. They are tracked as *items* (word senses, chunks, grammar points) in learner knowledge.
- **The engine's taxonomy** (`learning/taxonomy.ts`) stays as the diagnostic layer: "where do errors come from", not "what is my level". Its `SKILL_AREAS` should be called *error areas* (contradiction C4).

### 4.3 Illustrative shapes

Not contracts; field names are indicative.

```ts
// LearningProfile — one per target language (local now; per user later)
{ id, targetLanguage: 'en', targetVariety: 'en-GB' | null, supportLanguage: 'pt-PT',
  declared: { overall: 'B1' | null, perSkill: Partial<Record<Skill, Band>>, at },
  goals: string[], createdAt, updatedAt, version }

// SkillEstimate
{ profileLanguage: 'en', skill: 'listening', band: 'B1',
  basis: 'declared' | 'placement' | 'checkpoint' | 'evidence',
  evidence: [{ kind, recordId }], updatedAt }

// Enrolment
{ id, profileLanguage: 'en', courseId: 'en-a0-a2', courseVersion: '1.0.0',
  position: { unitId, lessonId, stepId }, completedLessons: [...], startedAt, updatedAt }
```

### 4.4 Why one profile per language, and language as the scope key

Four of the six module stores already carry `language: LanguageCode`: listening sessions, speaking attempts, reading texts and vocabulary entries. If a user has at most one profile per target language, then **the language is the profile key** locally. This has three effects:
- existing records need no `profileId` migration, only `language` where it is missing;
- the server can later map (user, language) to a profile row;
- the invariant can be relaxed (adding `profileId`) if a real need appears, such as two English profiles with different support languages.

That case is rare and can be handled by changing the profile's support language instead.

### 4.5 Impact on existing code

All changes below are **Proposed** (milestone F1).

| Area | Today | Change |
| --- | --- | --- |
| `domain/languages.ts` | `LANGUAGE_CODES = ['en']`; `bcp47: 'en'` | Keep the target-language enum. Add a separate support-language type (BCP 47). Varieties come later. |
| Writing and Grammar records (`contracts/writing.ts`, `contracts/grammar.ts`) | No `language` field | Add `language`, defaulting to `en` on read or in a v7 upgrade. |
| Vocabulary collection (`domain/vocabulary.ts:33`; index `VOCABULARY_BY_KEY` in `lib/storage/app-database.ts:85`) | Key = normalised lemma; ignores language and part of speech | The key includes language. Learner knowledge moves to item references (F2), so the collection becomes the learner's *saved words* view. |
| `saveLookup` (`domain/vocabulary.ts:126`) | `language: 'en'` hard-coded | Take it from the profile. |
| `portugueseExplanation`, `EXPLANATION_LANGUAGES` (`contracts/vocabulary.ts:33,79`) | Portuguese named in the schema | `explanation: { language, text }`, with a read-time mapping from the old field. |
| Learning Engine (`learning/observations.ts` `LearningSnapshot`; `learning/today.ts`) | Reads every record | Filter by profile language before deriving. |
| Backups (`learning/backup.ts`) | All stores | Add profile stores; per-profile export later. |
| IndexedDB (`lib/storage/app-database.ts`, `APP_DB_VERSION = 6`) | 18 stores, no profiles | v7: `profiles` and `skillEstimates`; later `enrolments`, `knowledgeEvidence`, `itemSchedules`. Upgrade tested from a v6 fixture. |
| Preferences (`localStorage`: theme, reading view, transcription options, explanation language) | Global | Theme and reading view stay user-level. Explanation and support language move to the profile. Transcription language follows the profile's target language. |
| Server | Stateless | Stays stateless. Profile context travels in requests as a bounded `LearnerContext` (§7). |

---

## 5. Vocabulary architecture and the trainer

### 5.1 Three layers, and where each is today

| Layer | What it is | Today | Status |
| --- | --- | --- | --- |
| **A. Lexical catalogue** | The language: entries (lemma + part of speech), senses, forms with features, variants with varieties, translations per support language, definitions, examples, pronunciations, provenance, review | Pack contract v1 (`contracts/vocabulary-pack.ts`): entries, senses, `forms` by label, `variants`, `translations['pt-PT']`, an English `definition`, `contexts`, `cefr` and `frequency` with sources, reserved `audio`. One 47-entry demo pack. The target model is in `VOCABULARY_CONTENT_MODEL.md`. | v1 **Implemented**; target model **Documented only** |
| **B. Curriculum** | What to learn, in what order, for which objective; references catalogue items, plus chunks and grammar points | Only a CEFR filter in the Library (`filterPackEntries`) | **Missing** |
| **C. Learner knowledge** | What this learner has shown, per item and facet | `vocabularyEntries` with one `ReviewState` per entry (`contracts/vocabulary.ts:136–151`), fed by Reading saves, reviews, AI practice and trainer rounds | **Limited**: merged with "saved words"; not per sense, direction or language |

**Rules (Proposed):**
- The curriculum references catalogue ids and never copies lexical data.
- Chunks ("Can you repeat, please?") and grammar points are first-class curriculum items. A chunk may also be a catalogue entry of kind `expression`, but a curriculum can introduce it before the catalogue has it.
- Learner knowledge references items (`{ kind: 'sense', entryId, senseId }`, `{ kind: 'chunk', id }`, `{ kind: 'grammar_point', id }`) and never lexical strings.

### 5.2 How to represent learner knowledge

**Recommendation: append-only evidence, with a derived state per facet.** Don't store literal statuses.

- **Facets** are the separately learnable aspects of one item:

  | Facet | Description |
  | --- | --- |
  | `recognise` | Target language → meaning, by reading. |
  | `recognise_audio` | Target language → meaning, by ear. Needs audio. |
  | `recall` | Meaning → target-language form. |
  | `form` | The right inflection in context. |
  | `use` | Correct use in open production (speaking, writing). |

- **Evidence event:** `{ language, item, facet, outcome, support, source, at }`.
  - `outcome` is one of `correct`, `almost`, `wrong_form`, `incorrect`, `self_rated_*`.
  - `support` records the hints used, the number of options in multiple choice, and whether audio was replayed.
  - `source` is the record id and path, as in the engine's observations.
- **Derived state per facet:**
  - **not met:** no evidence;
  - **met:** presented in a lesson;
  - **recognised / recalled:** correct without support, at least a day after first contact, in at least two separate sessions;
  - **used:** a correct use in open production, with a verified quote;
  - **needs review:** a recent failure after an earlier success.

  These rules are deterministic, tested, and visible to the learner. **One correct answer is never mastery**, and states can go down.
- **Scheduling** is per (item, facet). Start with the existing ladder (`REVIEW_LADDER_DAYS`) and the existing trainer rating policy (`trainerRating`, which is sound); evaluate FSRS later.
  - **Recognition and recall are scheduled independently.** At A1, recall starts only after recognition is stable.
- **The collection** stays as the learner's curated list of saved words, with sources and contexts. It is a view, not the knowledge store.
- **Migration:**
  - an existing entry's `ReviewState` seeds the `recall` facet of each *library* sense it holds;
  - Reading-saved senses seed `recognise`;
  - no state is inflated;
  - the old schedule is kept read-only until the migration is verified.
- **Relation to the Learning Engine:**
  - observations stay the diagnostic layer (error categories, thresholds, recommendations);
  - knowledge evidence is the item layer;
  - a trainer answer produces both, from the same record, without double counting. This is the same rule the M9 trainer already applies (`isSavedSense`, `entrySavedAt`).

### 5.3 Exercise types

| Type | Facet | Input | Checking | Bands | Status |
| --- | --- | --- | --- | --- | --- |
| 1. Translation recall (PT → EN), e.g. `comer` → `eat` | recall | Typed | `matchVocabularyAnswer` against an acceptance set scoped to the item (§5.4) | A2+ (A1 after recognition) | **Implemented** as "Spelling"; needs disambiguation and acceptance rules |
| 2. Reverse translation (EN → PT), e.g. `eat` → `comer` | recognise | **Multiple choice**, or reveal and self-rate | Option key, or self-rating labelled as such | All | **Missing**. Typed answers in the support language would need a PT matcher and PT acceptance lists for every sense; not worth it. |
| 3. Contextual completion, e.g. "I want to ___ something." | form + recall | Typed | Exact form required; other listed forms give "right word, wrong form" | A2+ | **Implemented** ("Context") |
| 4. Context with progressive hints, e.g. "I usually ___ breakfast at 8 AM." | form + recall | Typed, with a hint ladder | As 3; hints recorded as support | A2+ | **Limited**: letter hints only (length → first letter → letters, `nextHint`). Proposed ladder: meaning clue → PT translation → first letter → letters. |
| 5. Meaning in context | recognise | Multiple choice | Option key; distractors from *other senses of the same lemma* where they exist, otherwise same-topic items | A2+ (sense discrimination B1+) | **Missing** |
| 6. Form-sensitive (`eat` / `eats` / `ate` / `eaten`) | form | Typed (gap) or choice | Gap's required form; feedback names the needed feature ("past tense") | A1 (be, have) to B2 | **Limited**: `wrong_form` verdict exists; forms are labels, not features; the observation maps to `grammar_other` (`learning/observations.ts:337`) |
| 7. Listen and choose / listen and type | recognise_audio | Choice or typed | Key | Pre-A1+ | **Missing**; needs audio (G1) |
| 8. Chunk or collocation completion | recall / use | Typed or choice | Item-scoped key | B1+ | **Missing**; partly covered by AI practice (`collocation` type) |
| Definition → word | recall | Typed | As 1 | B1+ | **Implemented** ("Definition") |

**Not recommended:** anagrams, matching games, timed modes, picture exercises outside the beginner track. They add complexity without clear learning benefit here.

### 5.4 Language data: answering against meaning and context

The trainer already avoids the worst failure: it accepts only listed answers (`vocabulary-answers.ts`). The open problem is *what goes in the list*, and how ambiguity is handled.

| Issue | Recommended representation (Proposed) |
| --- | --- |
| Sense-specific translations | Translation records belong to one sense and one support language, with `is_primary` and a `context_note` (as in `VOCABULARY_CONTENT_MODEL.md` §5). Pack v1 already scopes `translations['pt-PT']` to a sense, which is the right direction. |
| Ambiguous prompts (one PT word, several EN senses: `claro` → light, clear, bright…) | The prompt is a **translation record**, never a bare string. It shows the PT text plus its context note or a short PT example when the PT word is ambiguous. |
| Multiple valid answers | The acceptance set for a recall item is **derived** at build time from catalogue relations (the target lemma, its variants for that sense, and other entries whose approved senses carry an equivalent translation in the same context). A reviewer freezes it on the item, and the derivation is recorded. No free-form global `accepted` strings. |
| A valid answer that is not the target | A new verdict, **`other_valid`**: the input matches a catalogue lemma whose sense shares the translation but is not the item being trained. Feedback: "That works too. Which word were we practising?" It is not a failure, and not evidence for the target. |
| Contextual constraints | A context example names its required form by **features** (`{ Tense: 'Past' }`) and the form string. Only the forms valid in that sentence are accepted; anything else listed among the entry's forms is `wrong_form`, with the feature named. |
| Lemma vs inflection | Recall items expect the lemma (dictionary form). Context items expect the form the gap needs. These are already the rules in `questionFor`; keep them. |
| Regional differences | Variants carry varieties. The profile's target variety decides which spelling is *expected*. Other varieties' spellings are accepted with a note ("US spelling"), never marked wrong. |
| Multiword expressions | Entries of kind `phrasal_verb`, `expression`, etc. Hyphen and space equivalence already exists (`looseHyphens`). Separable phrasal verbs ("look it up") need example-level answers, not entry-level ones. |

### 5.5 The current trainer: what to keep and what to change

| Aspect | Finding | Verdict |
| --- | --- | --- |
| Demo pack (`apps/client/public/content/vocabulary/en/demo-everyday.json`) | 47 original entries, 1 source (author's estimate), licence clear, mostly A1–B1 | Keep as a fixture. Not production content. |
| Question types (`LOCAL_VOCABULARY_QUESTION_TYPES`) | Spelling, Context, Definition; one question per entry per round; seeded and deterministic | Keep the engine; add types 2, 5, 6 and 7 (§5.3). Rename Spelling. |
| Normalisation (`normalizeTyped`) | Generic Unicode, case, apostrophe, dash and punctuation rules; per-language accent rule (strict by default) | **Keep.** Language-neutral in design. |
| Accepted answers | Only listed answers; `variants` and sense `accepted` for Spelling and Definition; the example's `accepted` for Context | Keep the principle. Replace sense-level `accepted` with derived, item-scoped acceptance (§5.4). |
| Hints (`nextHint`, `hintMask`) | Length → first letter → letters; recorded; restored on resume (`pending-hints.ts`) | Keep the mechanics; add semantic hints first. |
| Almost-correct | Typo allowance by length; accents per language; never counted as correct | **Keep.** |
| Wrong forms | Recognised from listed forms (up to 16) | Keep; move forms to features so feedback can name the needed form. |
| Review scheduling (`trainerRating`) | Correct without hints while due → `good`; with hints, almost or wrong form → no change; incorrect → `again` | **Keep the policy.** Apply it per (sense, facet), not per lemma string. |
| Persistence (`trainer-service.ts`) | Round and collection changes in one transaction; stored as practice sets with `model: 'local'` | Keep. Add evidence writes in the same transaction (F2). |
| Learning Engine integration | Observations without double counting (`isSavedSense`) | Keep. Preserve form information instead of `grammar_other`. |
| Progress and Today | Due reviews and checked rounds shown | Keep; add per-facet knowledge counts later. |
| Library (`library-view.tsx`, `pack-loader.ts`) | One pack at a time; English only; filters | Keep; multi-pack and profile language later. |
| Tests | `vocabulary-answers.test.ts`, `vocabulary-trainer.test.ts`, `vocabulary-pack.test.ts`, `vocabulary-trainer-learning.test.ts`, `trainer-service.test.ts`, `pack-files.test.ts`, `pending-hints.test.ts`, `pack-loader.test.ts` | Good coverage to build on. |

**Conclusion.** The trainer does **not** need a rewrite. It needs a new knowledge backend (F2), item-scoped acceptance, three or four new exercise types, and real content.

---

## 6. The M9 vocabulary pipeline

### 6.1 Actual state

| Aspect | State | Evidence |
| --- | --- | --- |
| Source provenance | **Implemented**, strong: checksum-pinned register, run manifests, attribution files, deterministic outputs | `tools/vocabulary-data/sources/manifest.json`, `vocabulary_data/manifest.py` |
| Google Books top lists | `approved`, redistributable (CC BY 3.0) | manifest |
| wordfreq | `approved_internal`, **restricted**: share-alike derived data, not shippable "until this is resolved" | manifest `distribution_note` |
| Open English WordNet 2025 | `approved`, redistributable (CC BY 4.0); no prepositions, determiners, pronouns, conjunctions or modal roles; fine-grained senses | README §11; `VOCABULARY_PILOT_REVIEW.md` §4 |
| ESDB / SCOWL | `approved_internal`, **restricted**: per-record notices unclear; COCA-derived data under NDA | manifest |
| CEFR-J / Octanove | `deferred`: CEFR-J's redistribution scope is unconfirmed | manifest |
| Wiktionary (Kaikki) | `deferred` | manifest |
| SUBTLEX-US | `rejected` for direct use | manifest |
| Profile separation | **Implemented** and enforced in configuration, at run time, in output folders and by validation | README §2 |
| Pilot selection | 400 candidates, stratified by **book-frequency band** plus irregular, variant and review groups | `pilot-v3-review/pilot-overview.md` |
| Function-word coverage | 226-item checklist: 12 supported, 83 unsupported, 81 with the part of speech missing, 38 missing, 7 folded, 5 ambiguous | `pilot-overview.md` |
| Contractions and multiword expressions | Absent from approved frequency sources | README §11 |
| Definitions, translations, examples, CEFR | Deliberately `null` / `not_started`; validation fails if filled | README §3 |
| Editorial workflow | Review CSVs, batches, column guide, `validate-review`; **0 of 400 rows reviewed**. The step from reviewed CSV to approved entries is not built. | `VOCABULARY_PILOT_REVIEW.md` §1 |
| Tests | 87 Python test functions | `tools/vocabulary-data/tests` |

### 6.2 Assessment

- **Engineering:** excellent. The licensing discipline is a real asset for a future commercial platform.
- **Selection axis:** wrong for the next needs.
  - The shippable ranking comes from printed books (1950–2008): "fridge" ranks about 30,000.
  - It lacks the closed-class words, contractions and chunks that dominate A1–A2.
  - It is also weak for B1 everyday vocabulary.
  - Scaling it towards 15,000–20,000 entries now would produce a large, unreviewed, book-biased candidate set with no curriculum to consume it.
- **Language-specific parts:** what makes it English-specific is correctly isolated as adapters and documented (`VOCABULARY_CONTENT_MODEL.md` §8).

### 6.3 Curriculum-driven use (endorsed, with a concrete workflow)

1. **Objectives.** A unit or strand states its can-do objectives.
2. **Inventory.** An editor lists the words, chunks and grammar points those objectives need. This is editorial work, owned by the project.
3. **Match.** Look up each inventory item among the candidates of the latest redistributable run (`final-c`). Record the candidate id as evidence of identity, part of speech and forms.
4. **Gaps.** Unmatched items, typically function words, contractions and chunks, become **editorial records authored by the project**. They are a small, closed set, and there is no licence question for original work.
5. **Enrich and review.** Senses, PT translations, examples, forms and audio references, each with provenance and review status, per the content model.
6. **Exercises.** Items, acceptance sets and distractors, reviewed.
7. **Grow gradually.** The wider catalogue grows by band and topic only when a consumer exists (a strand, a B1 trainer pack, a reading module's glossing).

**A small future tool (Proposed, not now):** a `match-inventory` command in the Python tool. It would take a unit inventory CSV and report matches, gaps and evidence, writing only redistributable outputs.

### 6.4 Where the 400-candidate pilot fits

- **Calibrate the protocol** with one or two batches (50–100 rows). Measure the time per row, test the decision vocabulary (`split_by_pos`, `split_senses`, `merge_into`, `defer`) and fix the protocol before reviewing at scale.
- **Prioritise intersections.** Review pilot rows that appear in the first unit's inventory (G0) or the first B1 trainer slice (E2), whatever batch they are in.
- **Leave the deep bands** (book-heavy ranks above 12,000) until a curriculum or strand needs them.
- **Keep it as lexical QA.** The package remains the reference for how candidates become entries. It is not a curriculum, a catalogue or a quota.
- **Licence decisions** unblock later stages:
  - the pack licence for mixed sources (CC BY-SA 4.0, as recommended), or project-only licensing for editorial content;
  - a query to CEFR-J about redistribution;
  - whether wordfreq-derived values may ever ship.

The pilot data must not be modified as part of this review, and it wasn't.

---

## 7. AI and the Learning Engine

### 7.1 What exists (Implemented)

| Element | Where | Quality |
| --- | --- | --- |
| Provider interfaces | `apps/server/src/modules/ai/providers.ts` | Routes depend on interfaces; Groq only |
| Generator registry: one generator per module with prompt, JSON schema, interpretation | `modules/ai/exercise-generation/generator.ts` and per-module generators | Good structure |
| Structured outputs and Zod validation | `modules/ai/json-schema.ts`, `groq-chat.ts`, shared contracts | Strict |
| Evidence verification (quotes must exist in the learner's text or transcript) | `domain/speaking-evidence.ts`, `writing-evidence.ts`, `transcript-evidence.ts` | Strong; a differentiator |
| Prompt-injection boundary | `UNTRUSTED_DATA_RULE`; learner data sent as one JSON value | Good |
| Bounded personal data | Targeted practice: one focus, at most 5 examples (`targetedPracticeData`) | The right pattern |
| Metadata-only logging | `routes/exercises.ts` | Good |
| Concurrency and timeouts | `routes/ai-job.ts`: 2 concurrent jobs per route, 429 when busy | Enough for local use |
| Capability gating | `routes/system.ts`; the UI asks what is configured | Good |

### 7.2 Limitations for the new direction

- **Fixed persona.** Thirteen prompts describe "an adult learner of English … B2 towards C1/C2":
  - generators: speaking, listening, reading, reading questions, writing, grammar, vocabulary practice;
  - assessment and support: speaking feedback, writing assessment, writing improvement, lookup, vocabulary evaluation and grammar review.
- **Level guide.** `LEVEL_GUIDE` defines only B2, C1 and C2.
- **Rubric anchor.** "Strong" in writing feedback means C1 standard.
- **English only.** "learner of English" is in every prompt; transcription accepts `en` or auto-detect only (`TranscriptionRequest.language: 'en' | null`); the grammar answer normaliser expands English contractions with no language parameter (`domain/grammar-answers.ts:20`).
- **No difficulty verification.** Outputs are checked for structure and evidence, not for level. Nothing checks length per band, sentence complexity or vocabulary coverage.
- **No budgets or quotas,** acceptable while the learner's own key pays. There is no second provider; "not configured" is the only fallback.

### 7.3 Recommendations (Proposed)

1. **A `LearnerContext` contract** in `@ldg/shared`, sent with AI requests and bounded by schema:
   - target language and support language;
   - band for the relevant skill;
   - exercise type;
   - optional interests and goal;
   - for guided supplementary practice only, an **allowed inventory** (item ids or lemmas taught so far, capped).

   The server builds prompts from per-band, per-language **guide fragments**. Prompts never contain free-form learner history beyond the existing bounded targeted-practice profile.
2. **Level-relative feedback:** "strong" means at or above the task's target band. This fixes the B1 mis-calibration without changing the feedback structure.
3. **Deterministic checks per band**, where checkable:
   - word count;
   - mean and maximum sentence length;
   - for guided supplementary material, inventory coverage (every content word is taught or glossed, otherwise rejected);
   - the existing evidence checks.

   Report discarded items, as Grammar and Listening already do.
4. **Guided core content is curated and works without AI.** AI is used for:
   - feedback on open production;
   - explanations on demand in the support language, labelled as AI;
   - *supplementary* variation constrained by the allowed inventory and validated.
5. **Cost:** keep the per-process limiter locally. Per-user quotas and budgets come only with accounts (P3).
6. **Providers:** keep the interfaces; add no provider until there is a concrete need (cost, availability or quality). **Unknown:** how reliably the current chat model follows B1 constraints; E1 should measure it on a fixed sample set before the band ships.
7. **Tests:** keep the stub-based server tests. Add band fixtures (valid, out-of-band and malformed outputs per generator) and B2–C2 regression tests that pin the current prompts' behaviour through their interpretation logic.

### 7.4 The Learning Engine

- **Strengths:**
  - traceable observations derived on demand (`learning/observations.ts`);
  - explicit thresholds (`PRODUCT_SPEC.md` §7.1);
  - denominators on every metric;
  - recommendations with done/dismissed states;
  - targeted practice through the existing generators.
- **Limits:**
  - category-level, never item-level;
  - not scoped by language;
  - the taxonomy lacks beginner categories (do-support, subject omission, `be` vs `have` for age);
  - `SKILL_AREAS` is a different concept from CEFR skills;
  - activity metrics are prominent.
- **Recommendation:** keep it as the diagnostic layer and scope it by profile (F1). Add item-level knowledge evidence beside it (F2), not instead of it. Recommendations draw on both. Beginner categories come with the guided content that produces them (G3).

---

## 8. Shared and language-specific architecture

| Component | Language-neutral | Language-specific | Does the code respect this? |
| --- | --- | --- | --- |
| Profiles, preferences, accounts | All | — | No profiles yet |
| Course, lesson and exercise engine | Structure, sequencing, state machine, scoring framework | Content per target and support language pair | Not built |
| Catalogue schema | Entry, sense, form-with-features (UD), variant-with-variety, per-support-language translation records | Feature inventories, morphology adapters, data | **Partly.** Pack v1 has English-oriented `PARTS_OF_SPEECH` (including `phrase`), forms by English label, and `translations['pt-PT']` |
| Typed answer matching | Normalisation pipeline; listed-only acceptance; typo allowance | Accent strictness, elision, clitics, inverted punctuation | **Yes** in `vocabulary-answers.ts` (`LANGUAGE_RULES`, strict default). **No** in `grammar-answers.ts` (English contractions, no language parameter). **Unknown** for `text-compare.ts` tokenisation (apostrophes and hyphens; looks safe for Romance languages, not verified). |
| Grammar inventory and topics | The *concept* of a grammar point with prerequisites | Inventories per language | **No.** `GRAMMAR_TOPICS` is an English list in a shared contract |
| Error taxonomy | Core categories: spelling, coherence, task achievement, register, receptive skills | Articles, phrasal verbs, inversion, cleft sentences… | **No.** One flat list. Split into a core plus language extensions when a second language arrives. |
| Pronunciation | Exercise framework (listen, repeat, compare) | Phoneme inventories and minimal pairs per variety | Not built |
| AI prompts | Structure, safety rules, evidence checks | Prompt text and level guides per language | **No.** English in every prompt |
| Transcription | Whisper is multilingual | Language codes | **Partly.** The contract allows `en` or auto only |
| Media, persistence, backups, scheduling, evidence, metrics | All | — | **Yes** |
| Interface localisation | Infrastructure | Catalogues per interface language | Not built |

English is the first implementation, not the template. The places where it currently *is* the template are listed above. None needs fixing before a second language is planned, but **new code should not add more** (a rule for every milestone).

---

## 9. Multi-user and production readiness

| Concern | Today | Cheap preparation now (Proposed) | Build only when needed |
| --- | --- | --- | --- |
| Authentication | None. `plugins/request-guards.ts` requires a loopback Host, same-origin `Sec-Fetch-Site` and a custom header. This is the right design locally and the main blocker to hosting. | Keep the server stateless; keep identity out of contracts. | OIDC or passwordless through a proven provider; cookie sessions with CSRF protection; replace the loopback guard. |
| Data isolation | Not applicable | Language and profile scoping on every record (F1) | Ownership on every row, enforced server-side, with tests that fail closed |
| Persistent database | IndexedDB v6 in one browser | UUID ids (already done); `updatedAt` and a record version on every mutable record; append-only evidence; no stored derived data (already the rule for observations) | PostgreSQL with migrations; a modular monolith (the same Fastify app). No microservices. |
| Synchronisation | None | Choose shapes that sync well (above); tombstones for deletions when sync is designed | Decide local-first-with-sync vs server-first (MU1 in `ROADMAP_NEXT_PHASES.md`) |
| User media | Blobs in IndexedDB (M8), ≤ 100 MB by default | Keep media references separate from records (already done) | Private object storage, signed URLs, quotas, retention |
| Backups and recovery | Versioned JSON export and import, validated, merge or replace with a safety backup | Add profiles to the backup format; per-profile export later | Server backups with restore drills |
| Privacy and deletion | Local deletion paths per store | Keep logs content-free (already the rule) | Account deletion across stores, media and backups; processor agreement with the AI provider; privacy notice |
| API authorisation | None (local) | Keep routes thin and stateless | Authentication on every route, plus ownership checks |
| AI usage controls | 2 concurrent jobs per route; timeouts; the learner's own key | A local request counter is optional; not needed | Per-user quotas, rate limits, budget alerts; platform-held keys |
| Secrets | `apps/server/.env` only | Keep it so | A secret manager |

The M10 audit's §7 and the MU1–MU5 track in `ROADMAP_NEXT_PHASES.md` cover the hosted-platform list well. This review agrees with them and only adds the **preparation column**. Those are changes that cost little now and avoid a painful migration later.

---

## 10. Recommended development roadmap

### 10.1 Tracks and sequencing

| Track | Purpose |
| --- | --- |
| **D** | Decisions: documents only. |
| **E** | English practice, for the current learner. |
| **F** | Foundations: profile and knowledge model. |
| **G** | Guided learning. |
| **S** | Security and quality baseline, continuous (as S1 in `ROADMAP_NEXT_PHASES.md`). |
| **P** | Platform. Gated by a product decision. |
| **L** | Additional languages. Gated by a product decision. |

```
D0 decisions + document reconciliation  (first; small)
 ├─ E1 English B1 practice band ─────────────┐   (immediate; independent of F)
 ├─ F1 language-scoped profiles (local) ──┐  │
 │     └─ F2 learner-knowledge evidence ──┼──┼─ E2 vocabulary trainer v2 (+ reviewed B1 slice)
 │                                        │  │
 └─ G0 content format + one complete unit (as data) ─┐
                                          └──────────┴─ G1 lesson engine (for that unit)
                                                         ├─ G2 support-language UI (guided surfaces)
                                                         └─ G3 units to the A1 checkpoint + Today path + placement-lite
                                                                └─ E3 practice personalised by profile and knowledge; B1 strands
S1 continuous ·  P1–P5 gated by a product decision ·  L1–L2 after G3 and a decision
```

**Can run in parallel after D0:**
- E1, F1 and G0 touch different code: prompts and contracts; storage and the engine; content design.
- G0 is mostly editorial work.

**Must come first:** decisions D0.1 to D0.5 below. F1 must precede F2, and F2 must precede E2 and G1, so that the trainer and lessons write knowledge in one shape from the start.

**Relation to `ROADMAP_NEXT_PHASES.md`** (if approved, this sequence supersedes that document's ordering):
- M11 maps to D0, F1 and G0;
- M12 becomes G2, reduced in scope;
- M13 audio becomes part of G1;
- M14 becomes G1;
- M15 and M18 become G3;
- M16 maps to F2 plus G3's Today work;
- M19 is split between E1 (B1, now) and later A2 work;
- M21 maps to E2 plus a later library milestone;
- M22 is unchanged and later;
- MU and ML become P and L.

### 10.2 Milestones

#### D0: Product decisions and document reconciliation
- **Type:** decision (documentation).
- **Objective:** record the decisions that everything else depends on, and reconcile C1–C10.
- **Why:** the specification still names a B2 persona and lists accounts as a non-goal, and two roadmaps disagree.
- **Decisions to record:**
  1. English B1–C2 practice stays first-class; a guided Pre-A1–A2 track is added for English first.
  2. Accounts and a server database: "not yet", gated by P1.
  3. One profile per (user, target language); language is the local scope key.
  4. Guided core content is curated and AI-free.
  5. The learner-knowledge model is evidence plus derived facets (§5.2).
  6. The audio source for guided content: human, licensed TTS pre-generated and reviewed, or the browser's TTS as a labelled interim.
  7. The content licence policy: editorial content vs CC BY-SA mixtures.
  8. Push `main` and decide what happens to the pipeline branch and the M10 documents.
- **Dependencies:** none.
- **Existing material:** this document, the three M10 documents, `PRODUCT_SPEC.md`, `ROADMAP.md`.
- **Required changes:** documents only (a decision record; edits to the specification and roadmap).
- **Non-goals:** any code.
- **Acceptance:**
  - decisions 1–5 are recorded;
  - 6 and 7 are recorded or explicitly deferred with an owner;
  - C1–C10 are resolved or tracked.
- **Tests:** none.
- **Risks:** deciding too much on paper. Keep it short.

#### E1: English B1 practice band (recommended immediate milestone)
- **Type:** product functionality.
- **Objective:** Listening comprehension, Reading, Writing, Speaking, Grammar and targeted practice generate and assess genuinely B1 material.
- **Why:** the only current learner is about B1/B2. This keeps the app useful now and proves the level-parameterised AI design that later bands need.
- **Dependencies:** D0.1. Not F1: the level is already explicit in every request.
- **Existing code:**
  - level enums in `contracts/exercise-generation.ts`, `grammar.ts`, `reading.ts`, `speaking.ts` and `writing.ts`;
  - prompts in `modules/ai/exercise-generation/*` and `modules/ai/groq-*.ts`;
  - `LEVEL_GUIDE`;
  - `features/speaking/prompt-library.ts`;
  - the level pickers in each generator UI.
- **Required changes:**
  - add `B1` to the five enums and to targeted practice;
  - replace the fixed persona with a band-aware learner description;
  - add a B1 guide fragment;
  - make the writing and speaking rubrics level-relative;
  - add B1 grammar topics (present perfect vs past simple, `used to`, future forms, gerund vs infinitive, first and second conditionals, defining relative clauses, basic passive, comparatives);
  - add an optional short rule summary before a grammar set;
  - add B1 writing formats and 6–8 curated B1 speaking prompts, hand-written and reviewed;
  - add band checks for length and sentence length.
- **Non-goals:** A1/A2; profiles; a new provider; changing B2–C2 behaviour.
- **Acceptance:**
  - every generator accepts B1 and rejects out-of-band output where checkable;
  - feedback for a B1 task uses B1 as "strong";
  - a fixed set of B1 samples per generator is reviewed by the learner;
  - B2–C2 outputs are unchanged under the regression fixtures;
  - old records and backups validate (the enums are widened, not narrowed);
  - checked in the browser at desktop and 375 px.
- **Tests:**
  - contract tests for the new enum values;
  - generator interpretation tests with B1 fixtures (valid, too long, malformed);
  - prompt-assembly tests (B1 guide present; B2–C2 text unchanged);
  - backup round-trip.
- **Risks:**
  - **The model may drift above B1.** Mitigate with checks and sample review.
  - **Grammar topics could explode in number.** Keep only the list above.

#### F1: Language-scoped learning profiles (local, single user)
- **Type:** architectural preparation.
- **Objective:** one `LearningProfile` per target language, with the declared level per skill and the support language; every record and derivation consistently scoped by language.
- **Why:** the prerequisite for multilingual use, placement and knowledge. It fixes C5 for language now and removes inconsistent scoping before more code depends on it.
- **Dependencies:** D0.3.
- **Existing code:**
  - `lib/storage/app-database.ts` (v6);
  - `contracts/writing.ts` and `grammar.ts` (no `language`);
  - `domain/vocabulary.ts` (`vocabularyKey`; `saveLookup` hard-codes `en`);
  - `contracts/vocabulary.ts` (`portugueseExplanation`, `EXPLANATION_LANGUAGES`);
  - `learning/observations.ts` and `today.ts`;
  - `learning/backup.ts`;
  - Settings.
- **Required changes:**
  - v7 upgrade: add a `profiles` store and a default `en` profile created from existing data; add `language` to Writing and Grammar records;
  - a language-aware vocabulary key;
  - a support-language-tagged explanation (read-mapping the old field);
  - snapshot and Today filtered by profile;
  - backup format plus old-backup import;
  - a minimal profile panel in Settings (declared level per skill, support language). No profile switcher while only English exists.
- **Non-goals:** accounts; a second language; placement; UI localisation.
- **Acceptance:**
  - an upgrade from a v6 fixture keeps all data;
  - old backups import;
  - every Learning Engine input is filtered by language (a test with a fake second language proves isolation);
  - no user-visible regression.
- **Tests:**
  - IndexedDB upgrade test;
  - backup round-trip and old-backup import;
  - snapshot isolation tests;
  - vocabulary key tests.
- **Risks:**
  - **Migration bugs.** Mitigate with fixtures and a safety backup before the upgrade.
  - **Scope creep into accounts.** Keep it local only.

#### F2: Learner-knowledge evidence and per-facet scheduling
- **Type:** architectural preparation plus product.
- **Objective:** item references, append-only knowledge evidence, derived facet states and per-(item, facet) schedules (§5.2), fed first by the existing trainer and reviews.
- **Why:** the trainer, lessons, placement and evidence-based Progress all need it. It is better built once, before G1 and E2.
- **Dependencies:** F1.
- **Existing code:**
  - `domain/vocabulary-trainer.ts` (`trainerRating`, `adoptPackSense`);
  - `domain/vocabulary.ts` (`scheduleReview`, ladder);
  - `trainer-service.ts`;
  - `learning/observations.ts`;
  - the review page.
- **Required changes:**
  - shared contracts for item references and evidence;
  - pure derivation and scheduling in `packages/shared/src/domain`;
  - stores and v8 migration;
  - trainer and reviews write evidence in the same transaction;
  - a conservative migration from entry-level `ReviewState`;
  - per-facet counts in the vocabulary hub.
- **Non-goals:** FSRS; lessons; new exercise types; redesigning Progress.
- **Acceptance:**
  - repeating a round without delay never advances a state (tested);
  - noun and verb *book* have independent schedules;
  - existing review data migrates without loss and without inflation;
  - every state shows its evidence.
- **Tests:**
  - state-transition and scheduling tests;
  - migration tests;
  - no double counting with observations.
- **Risks:**
  - **Changing review behaviour** surprises the learner. Keep the old ladder semantics per facet.
  - **Evidence volume** in IndexedDB. **Unknown;** estimated small for one learner, to be measured.

#### E2: Vocabulary trainer v2 and a reviewed B1 slice
- **Type:** product functionality plus content.
- **Objective:**
  - new exercise types: reverse translation (multiple choice), meaning in context, feature-aware form feedback, a semantic hint ladder;
  - item-scoped acceptance with the `other_valid` verdict;
  - pack schema v2 (per-record review and provenance, translation context notes, form features, varieties);
  - one reviewed B1 pack slice for the current learner.
- **Why:** this is the vocabulary experience the brief describes, and real use for a B1/B2 learner.
- **Dependencies:** F2. The content needs the curriculum-driven workflow (§6.3) applied to a B1 topic set, plus D0.7.
- **Existing code:** `contracts/vocabulary-pack.ts`; `domain/vocabulary-trainer.ts`; `domain/vocabulary-answers.ts`; `features/vocabulary/trainer/*` and `library/*`; `pack-files.test.ts`.
- **Required changes:**
  - pack v2 schema with a v1 reader (or one-off conversion of the demo pack);
  - round builder per facet;
  - choice exercises;
  - the hint ladder;
  - verdict and feedback text;
  - a B1 slice of a few hundred senses, selected from inventories, matched to pipeline candidates and reviewed.
- **Non-goals:** the 15,000–20,000 import; audio; other languages; AI generation of pack content without review.
- **Acceptance:**
  - every new type explains wrong answers;
  - `comer` → `eat` style items accept exactly their derived set;
  - wrong forms name the required feature;
  - no unreviewed or restricted data ships;
  - existing tests pass.
- **Tests:** schema v2 tests; matcher tests for `other_valid` and varieties; round-builder tests per facet; pack-file validation.
- **Risks:**
  - **Content review time.** Keep the slice small.
  - **Licence of enrichment sources.** Prefer original editorial content.

#### G0: Content format and one complete unit, as data
- **Type:** architectural preparation plus content design.
- **Objective:** course, unit, lesson, step and activity contracts, validated against **one complete, reviewed unit** (for example `LEARNING_FRAMEWORK.md` unit 1, "Greet and say your name"). The unit includes its inventory, chunks, grammar point, dialogue, explanations in Portuguese, exercises, audio references and checkpoint.
- **Why:** designing the format around a real unit prevents both over-design and drift from the catalogue. It is also the first real test of the curriculum-driven vocabulary workflow.
- **Dependencies:** D0.1, D0.4 and D0.6 (to name the audio references).
- **Existing material:** `LEARNING_FRAMEWORK.md` §4; `VOCABULARY_CONTENT_MODEL.md`; the pipeline's `final-c` candidates for matching.
- **Required changes:**
  - Zod contracts in `@ldg/shared` that reference catalogue ids (never copied text);
  - a content validator: ids resolve, every item is taught before it is used, every audio reference has provenance;
  - the unit as a data file, kept as a test fixture until G1 ships it.
- **Non-goals:** a player; more than one unit; AI generation of the unit.
- **Acceptance:**
  - the unit validates;
  - a second reader reviews the explanations;
  - the inventory's catalogue gaps are listed and resolved editorially.
- **Tests:** schema tests (valid and invalid); validator tests.
- **Risks:**
  - **Pedagogical quality** depends on ELT and Portuguese expertise (unresolved, §12).
  - **Copyright:** don't adapt coursebooks.

#### G1: Lesson engine for the G0 unit
- **Type:** product functionality.
- **Objective:** play the G0 unit end to end (model, meet, notice, practise, use, review, checkpoint), offline and without AI, writing knowledge evidence.
- **Dependencies:** F2, G0, D0.6.
- **Existing code:**
  - `matchVocabularyAnswer`;
  - the trainer's hint and round mechanics;
  - the speaking recorder (listen and repeat, self-comparison, no scoring);
  - the media player;
  - UI primitives.
- **Required changes:**
  - a lesson route and state machine (pure, in `domain`);
  - only the exercise types the unit uses;
  - an audio player with slow replay;
  - resume.
- **Non-goals:** more units; placement; pronunciation scoring; localisation of the whole app.
- **Acceptance:**
  - the unit is playable by keyboard and at 375 px;
  - an interrupted lesson resumes where it stopped;
  - no `/api/` call is needed;
  - evidence is written per item and facet.
- **Tests:** state-machine tests; exercise-checker tests; component tests; a browser walkthrough.
- **Risks:** too many exercise types (build only those the unit uses); reduced-motion support.

#### G2: Support-language interface for guided surfaces
- **Type:** product functionality.
- **Objective:** a typed in-house message catalogue (no new dependency). Onboarding, the lesson player, the trainer and Today are in Portuguese for a profile whose support language is `pt-PT`. Content keeps `lang` from its record.
- **Dependencies:** F1, G1.
- **Non-goals:** translating every advanced module now.
- **Acceptance:** catalogue completeness test; correct `lang` attributes; no layout breaks at 375 px.
- **Risks:** a permanent cost per new string. Limit the scope to beginner-facing surfaces.

#### G3: Units to the A1 checkpoint, Today path, placement-lite
- **Type:** content plus product.
- **Objective:**
  - units 0–6, then to the A1 checkpoints;
  - Today shows the next lesson and due reviews first for enrolled profiles;
  - placement-lite: a beginner route, or self-declaration plus checkpoint evidence, always overridable;
  - beginner taxonomy categories.
- **Dependencies:** G1, G2.
- **Acceptance:** as M15/M18 in `ROADMAP_NEXT_PHASES.md`, plus at least one real beginner tested on unit 1 where possible.
- **Risks:** content cost, the largest in the plan.

#### E3: Practice personalised by profile and knowledge; B1 strands
- **Type:** product functionality.
- **Objective:**
  - AI requests take their `LearnerContext` from the profile's skill estimates;
  - recommendations use knowledge and observations;
  - two or three **strands** for B1 gaps (for example the present perfect) reuse the lesson engine.
- **Dependencies:** E1, F2, G1.
- **Non-goals:** a C1/C2 expansion beyond what exists.
- **Acceptance:**
  - a B2 profile with B1 listening is offered B1 listening by default;
  - a strand plays through the same engine as the beginner course.
- **Risks:** recommendation complexity. Keep it rule-based and explainable.

#### S1: Security and quality baseline (continuous)
As in `ROADMAP_NEXT_PHASES.md`:
- CI running typecheck, tests, build, `npm audit` and the pipeline tests;
- secret scanning;
- log-redaction tests;
- dependency policy.

It can start any time and should exist before P1.

#### P1–P5: Platform (gated)
As MU1–MU5 in `ROADMAP_NEXT_PHASES.md`, preceded by an explicit product decision that a second user or a second device is a real requirement:
- **P1:** sync decision and threat model;
- **P2:** identity, database and isolation;
- **P3:** AI quotas;
- **P4:** privacy;
- **P5:** operations.

Shape: a modular monolith, with the existing Fastify server, PostgreSQL and object storage. No microservices, and no queue until there is a measured need.

#### L1–L2: Additional languages (gated)
As ML1–ML2 in `ROADMAP_NEXT_PHASES.md`, after G3. Before L2, generalise the hard-coded places listed in §8.

---

## 11. Key architectural decisions

All are **Proposed**, for D0.

| # | Decision | Rationale | Rejected alternative |
| --- | --- | --- | --- |
| AD1 | No global experience mode. Curriculum (courses and strands) and the practice library coexist per profile; defaults follow per-skill estimates. | Levels are per language and per skill; overlap is normal. | A `GUIDED`/`PRACTICE` flag or two apps |
| AD2 | One profile per (user, target language); language is the local scope key. | Four stores already carry `language`; no `profileId` migration. | A `profileId` on every record now |
| AD3 | Declared, estimated, per-skill, progression and knowledge are separate records. | Each changes for different reasons and needs different evidence. | One `level` field |
| AD4 | Learner knowledge is append-only evidence with derived facet states, scheduled per (item, facet). | Traceable, sync-friendly, never inflated by repetition. | Literal stored statuses; one schedule per word |
| AD5 | Catalogue ≠ curriculum ≠ knowledge. The curriculum references catalogue ids; chunks and grammar points are first-class. | Keeps lexical data reusable across language pairs and curricula. | Frequency-ordered packs as the course |
| AD6 | Acceptance is scoped to the exercise item, derived from catalogue relations and frozen by review; `other_valid` for real alternatives. | Correctness depends on meaning and context. | Ever-growing `accepted` lists on entries |
| AD7 | Guided core content is curated, reviewed, offline and AI-free; AI is supplementary and bounded by the taught inventory. | Consistency, cost, reviewability at A0–A2. | Generated beginner lessons |
| AD8 | AI prompts are server-built from a bounded `LearnerContext` with per-band, per-language guides; level-relative rubrics. | Unlocks B1 now and other bands later without leaking history. | A fixed persona; client-built prompts |
| AD9 | Local-first stays. Platform infrastructure only after a product decision. A modular monolith. | A solo developer; one user; privacy. | Early accounts, sync or microservices |
| AD10 | The pipeline is an evidence service for curriculum-driven selection; scaling only follows a consumer. | Book frequency is not a curriculum; review time is the bottleneck. | Preparing 15,000–20,000 entries up front |

---

## 12. Risks, trade-offs and unresolved questions

### 12.1 Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Guided content cost overwhelms a solo developer | High | High | One validated unit first (G0); stop and reassess after G1. |
| Beginner track can't be validated by its builder (who isn't a beginner in English) | High | High | Recruit at least one real beginner per unit; see question 2 below. |
| B2–C2 regressions while adding B1 | Medium | Medium | Regression fixtures and unchanged prompt text for B2–C2 (E1). |
| AI drifts above B1 | Medium | Medium | Deterministic checks, sample review, reported discards. |
| Knowledge migration changes review behaviour | Medium | Medium | Conservative seeding; keep the old schedule read-only until verified. |
| Two "skill" concepts confuse the UI and the code | Medium | Low | Rename to "error areas" (C4). |
| Licence of enrichment data | Medium | High (for a platform) | Original editorial content first; resolve D0.7 before any import. |
| Portuguese interface maintenance cost | Medium | Medium | Scope it to guided surfaces (G2). |
| Unpushed work lost (11 commits local-only) | Low | High | D0.8. |

### 12.2 Trade-offs accepted
- **B1 before beginners:** serves the real user now and delays the beginner pivot by one milestone.
- **Language as the scope key:** simpler now, but needs a migration if two profiles per language are ever required.
- **Multiple choice for EN → PT recognition:** easier to check, but weaker than typed recall; it is the receptive facet by design.
- **No FSRS initially:** predictable, but less adaptive.

### 12.3 Unresolved questions (not settled by inspection)
1. **Who authors and reviews guided content?** It needs ELT and European Portuguese expertise.
2. **How will the guided track be validated?** The developer could dogfood a guided path in a *new* language, but that needs a second language (L-track) earlier than recommended. Real English beginners are the alternative. This is the user's decision.
3. **Is a hosted, multi-user product a concrete plan with a timeline, or a long-term possibility?** This decides when P1 starts.
4. **Sync model:** local-first with sync, or server-first (P1).
5. **Audio source** for guided content, and its licence (D0.6).
6. **CEFR-J redistribution scope;** whether wordfreq-derived values may ever ship; the pack licence (D0.7).
7. **Unknown:** how well the current chat model (`openai/gpt-oss-120b`, `config/env.ts`) follows B1 constraints. E1 measures it.
8. **Unknown:** whether `text-compare.ts` tokenisation is safe for future languages (elision, clitics). Verify before L2.
9. **Unknown:** knowledge-evidence volume in IndexedDB over years of use. Measure in F2.

---

## 13. What to do next

### 13.1 The five most important recommendations
1. **Make English useful at B1 now (E1)** with level-parameterised prompts, level-relative rubrics, B1 grammar topics and band checks, protecting B2–C2. Don't wait for the beginner course.
2. **Scope everything by a language profile (F1)** before building any profile UI or second language. Today Writing and Grammar have no language, the vocabulary key ignores language, and the engine is unscoped.
3. **Separate learner knowledge from saved words (F2):** per-item, per-facet evidence and scheduling, so no single answer counts as mastery and noun and verb senses don't share a schedule. Then extend the trainer (E2) instead of rewriting it.
4. **Drive vocabulary from the curriculum, not from frequency:** pause pipeline scaling, use it as an evidence service, author closed-class words and chunks editorially, and review only the pilot rows a unit or strand needs (after a 50–100-row calibration).
5. **Validate the guided experience with one complete unit as data (G0) before building a lesson engine (G1).** Use one engine for beginner courses and intermediate strands. Never add a global "mode".

### 13.2 Recommended immediate next milestone
**E1: English B1 practice band,** preceded by the short D0 decision record (at least D0.1, and D0.8 for the unpushed work). F1 and G0 can start in parallel once D0 is recorded.

### 13.3 What not to do next
- Don't import or prepare a 15,000–20,000-entry library.
- Don't extend AI generation to A1/A2 before curated anchors exist.
- Don't build accounts, sync, hosting or a second target language.
- Don't translate the whole interface before the guided surfaces exist.
- Don't show pronunciation scores without a validated method.
- Don't present activity totals as progress.
