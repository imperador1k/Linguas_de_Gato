# Roadmap: next phases

Status: **proposal** (M10, 22 November 2026). It follows from `docs/PRODUCT_AUDIT_PRE_A1_C2.md` (what exists and what is missing) and `docs/LEARNING_FRAMEWORK.md` (what to teach and how to judge progress). It complements `docs/ROADMAP.md` (M1–M9, the foundation phase) and replaces nothing there until approved.

**Priority:** the complete beginner experience. Multi-user infrastructure and other target languages stay deferred until there is a product requirement for them. Security fundamentals are not deferred.

Sizes are relative (S, M, L, XL) and show order of magnitude only, not estimates.

## 0. Decisions needed before M11

1. **Persona pivot.** The product specification names a B2 → C2 learner. Serving complete beginners is a change of persona and scope, and should be recorded in `docs/PRODUCT_SPEC.md` as a decision.
2. **Curated content over generated content** at Pre-A1–A2. Lessons, dialogues and explanations are written and reviewed. AI is used for feedback, on-demand explanations and practice variation, not as the source of beginner material.
3. **Audio source** for curriculum content:
   - human recordings;
   - licensed synthetic speech, pre-generated and reviewed;
   - the browser's speech synthesis as an interim, labelled option.

   This decides cost, quality and licensing (M13).
4. **The vocabulary pilot's role.** The 400-entry review stays useful as lexical quality control. Beginner vocabulary is chosen by the curriculum (units and goals), with the pipeline providing evidence. Recommendation: review the candidates the A1 units need first, rather than the 400 in batch order.

## 1. Sequence

```
S1 security baseline (continuous, starts now)

M11 decision + course/profile contracts
 ├─ M12 Portuguese interface
 ├─ M13 audio foundation
 └─ M14 lesson player + beginner exercises ── needs M11, M13 (M12 for real use)
        └─ M15 beginner content, units 0–6 ── needs M14 (content can start after M11)
               └─ M16 knowledge states + evidence-based Today/Progress
                      ├─ M17 placement + skill profile
                      └─ M18 units 7–12 + A1 checkpoints
                             └─ M19 existing modules extended to A2–B1
                                    ├─ M20 A2 course content
                                    ├─ M21 trainer for B1+ and library integration
                                    └─ M22 pronunciation practice

Deferred, gated by a decision: MU1–MU5 (multi-user), ML1–ML2 (multilingual)
```

## 2. Milestones

### S1: Security and quality baseline (local)
- **Type:** security / infrastructure. **Size:** S.
- **Objective:** keep the local app safe and the codebase healthy while it grows.
- **User problem:** prevents silent regressions (a leaked key, a vulnerable dependency, learner content in logs) as features land.
- **Scope:**
  - CI running `typecheck`, `test`, `build`, `npm audit` and the pipeline tests on every push;
  - secret scanning;
  - a check that server logs contain no request bodies or transcripts;
  - a documented dependency policy;
  - a note in Settings that backup files contain personal data (recordings, texts).
- **Dependencies:** none.
- **Acceptance:**
  - CI is green on the main branch and fails on a planted test secret;
  - log tests prove learner text is never logged;
  - no new dependency without a written justification.
- **Tests:** a CI configuration check; a server log-redaction test.
- **Risks:** low. The CI provider choice affects where code is sent (the repository is already on GitHub).

### M11: Product decision, course and learner-profile contracts
- **Type:** product / architecture. **Size:** M.
- **Objective:** record the persona decision, and define the contracts the beginner path needs before any UI.
- **User problem:** nothing in the data model can represent a course, a lesson or a learner's level, so no beginner feature can be built cleanly.
- **Scope:**
  - **Specification:** update `PRODUCT_SPEC.md`.
  - **Course contracts:** Zod contracts in `@ldg/shared` for course → unit → lesson → step → activity, and for content items (word sense, chunk, grammar point, dialogue line, text, audio reference) with stable ids and provenance.
  - **Support language as a record field:** content is keyed by support language from the start (BCP 47), following `VOCABULARY_CONTENT_MODEL.md`, so it does not inherit the `pt-PT` hardcoding.
  - **Learner profile:** support language, interface language, per-skill estimates with evidence, goals, path position.
  - **Persistence plan:** IndexedDB stores and backup format additions, with the upgrade path from v6.
- **Dependencies:** decisions 1, 2 and 4 in §0.
- **Acceptance:**
  - the contracts validate a hand-written sample unit (in tests, not shipped content);
  - the upgrade from v6 keeps existing data;
  - old backups import into the new version.
- **Tests:**
  - schema tests (valid and invalid);
  - an IndexedDB upgrade test from a v6 fixture;
  - backup round-trip and old-backup import.
- **Risks:**
  - **Over-design:** keep only what units 0–6 need, and extend later.
  - **Divergence:** the lesson format and vocabulary packs drift apart. Share the content-item ids.

### M12: Portuguese interface
- **Type:** product. **Size:** M.
- **Objective:** a beginner can use the whole app in Portuguese.
- **User problem:** every label, instruction, error and explanation is in English, which blocks a beginner before any learning starts.
- **Scope:**
  - **Message catalogue,** with `pt-PT` and `en`; the interface language setting is separate from the support language.
  - **Translation:** all UI strings, server error messages, metric definitions and taxonomy labels.
  - **Markup:** correct `lang` attributes (interface in `pt-PT`, content in `en`).
  - **Dependency:** at most one small, justified library, or a typed in-house dictionary (preferred, given the dependency rule).
- **Dependencies:** M11 (the profile field).
- **Acceptance:**
  - no hard-coded user-facing English outside content in the Portuguese interface (checked by a test or lint over components);
  - screen readers announce the interface in Portuguese and content in English;
  - checked in the browser at desktop and 375 px.
- **Tests:**
  - catalogue completeness (every key in both languages);
  - component tests in both languages;
  - a browser check.
- **Risks:**
  - **Ongoing cost:** every future string costs two translations.
  - **Long strings:** Portuguese strings are longer and can break layouts.

### M13: Audio foundation
- **Type:** infrastructure / content. **Size:** M.
- **Objective:** every curriculum word, chunk and dialogue line can carry reviewed audio.
- **User problem:** beginners cannot learn words they have never heard, and dictation and listening need graded audio that the learner does not have to supply.
- **Scope:**
  - **Static assets:** audio files as versioned static assets with a manifest (file, checksum, speaker or voice, variety, licence, review status), alongside content packs.
  - **Player:** a component with slow playback and replay, plus keyboard support.
  - **Production:** a documented audio production process (decision 3), and the trainer's reserved `audio` mode enabled.
- **Dependencies:** decision 3; M11 (content-item ids).
- **Acceptance:**
  - every audio file has a licence and provenance entry, and a validator rejects unlicensed or unreviewed files;
  - audio works offline after first load;
  - the player passes keyboard and screen-reader checks;
  - synthetic voices are labelled as such.
- **Tests:**
  - manifest validator;
  - player component tests;
  - a pack validation test for audio references.
- **Risks:**
  - **Size and loading:** keep files small, and lazy-load them.
  - **Pronunciation errors:** synthetic speech can mispronounce; human review is required.
  - **Licence terms:** of commercial voice services.

### M14: Lesson player and beginner exercise types
- **Type:** product. **Size:** L.
- **Objective:** a lesson can be played end to end: model, meet, notice, practise, use, review, checkpoint (`LEARNING_FRAMEWORK.md` §4.2).
- **User problem:** the app has no teaching step and no receptive exercises, so beginners are tested on what they were never taught.
- **Scope:**
  - **Lesson flow:** a lesson route and player.
  - **Exercise types:**
    - picture/audio/translation multiple choice;
    - listen and choose;
    - matching;
    - word ordering;
    - multiple-choice gap;
    - typed gap with exact-form checking (reuse `matchVocabularyAnswer`);
    - dialogue completion;
    - listen and repeat with self-comparison (reuse the speaking recorder; no scoring).
  - **Explanations and feedback** in the support language.
  - **Saving:** resume and lesson completion stored locally; observations sent to the Learning Engine with beginner categories.
  - **Pure logic** (sequencing, scoring, answer checking) lives in `packages/shared/src/domain`.
- **Dependencies:** M11, M13; M12 for beginner use.
- **Acceptance:**
  - a sample lesson plays fully by keyboard and on a 375 px screen;
  - every exercise explains wrong answers;
  - a lesson interrupted mid-way resumes in the same place;
  - no AI call is required to complete a lesson.
- **Tests:**
  - domain tests for each exercise checker;
  - player state-machine tests;
  - component tests;
  - a browser walkthrough.
- **Risks:**
  - **Too many exercise types:** build only those units 0–6 use.
  - **Reduced motion:** animations must respect `prefers-reduced-motion`.

### M15: Beginner content, units 0–6
- **Type:** content. **Size:** XL (ongoing).
- **Objective:** the first real course: orientation, plus units 1–6 (Pre-A1 → early A1).
- **User problem:** there is nothing for a beginner to learn from.
- **Scope:**
  - **Lexicon and grammar:**
    - an editorial closed-class word list owned by the project (the function words the redistributable sources lack);
    - unit word selection using pipeline evidence plus human review;
    - dialogues, texts, explanations in Portuguese with Portuguese–English contrasts, exercise items and distractors;
    - audio per M13.
  - **Review and validation:** a review workflow (author, reviewer, status) and a content validator.
- **Dependencies:** M14 (the player); content writing can start after M11.
- **Acceptance:**
  - every item has provenance and a reviewed status;
  - units use only words taught in or before them, plus glossed new items (a validator checks coverage);
  - explanations are checked by a second reader;
  - a complete beginner can finish unit 1 unaided (tested with at least one real beginner where possible);
  - no generated content ships unreviewed.
- **Tests:**
  - content schema validation;
  - a vocabulary-coverage validator;
  - an audio-reference validator;
  - a browser walkthrough of each unit.
- **Risks:**
  - **The biggest cost in the plan:** writing and reviewing pedagogical content is slow.
  - **Explanation quality:** depends on Portuguese and ELT expertise.
  - **Copyright:** avoid copying from published coursebooks.

### M16: Knowledge states and an evidence-based Today and Progress
- **Type:** product. **Size:** M.
- **Objective:** progress shows what the learner knows and retains, and Today shows the next lesson and due reviews.
- **User problem:** today's metrics count actions; a beginner needs to know what to do next and whether it is working.
- **Scope:**
  - **Knowledge states:** unseen → met → recognised → recalled → used, per item and direction, each change linked to its observation.
  - **Spaced review:** per item and direction, replacing one schedule per word, with a migration from the current ladder.
  - **Today:** next lesson, due reviews, then optional free practice.
  - **Progress:** checkpoints per skill, delayed retention and items per state, with activity metrics moved to a secondary, labelled place.
- **Dependencies:** M14, M15 (real items).
- **Acceptance:**
  - every progress number links to its evidence;
  - no progress number rises from repetition alone (a test proves re-doing the same lesson doesn't advance states without delay);
  - existing vocabulary reviews migrate without loss.
- **Tests:**
  - state-transition and scheduling domain tests;
  - metric tests with fixtures;
  - migration tests;
  - Today recommendation tests.
- **Risks:**
  - **Experience regressions:** changing review scheduling affects existing data. Migrate conservatively.

### M17: Placement and skill profile
- **Type:** product. **Size:** M.
- **Objective:** a learner starts at the right point, per skill.
- **User problem:** returning learners shouldn't redo Pre-A1, and beginners shouldn't face a test.
- **Scope:**
  - **Beginner route:** a "never studied English" route with no test.
  - **Other learners:**
    - can-do self-assessment in Portuguese, per skill;
    - short automatic checks for listening, reading, vocabulary and grammar recognition, built from reviewed items;
    - the path start is chosen from both;
    - always overridable;
    - re-placement available.
- **Dependencies:** M15 and M18 (enough levelled items), M16.
- **Acceptance:**
  - the placement result shows its evidence;
  - a beginner reaches unit 0 in under a minute;
  - placement never claims an official CEFR level.
- **Tests:** placement-logic domain tests over fixtures; component tests.
- **Risks:**
  - **Inaccurate placement:** short tests can misplace learners, so make re-placement easy and keep progression evidence-driven.

### M18: Units 7–12 and A1 checkpoints
- **Type:** content. **Size:** XL.
- **Objective:** complete A1 (`LEARNING_FRAMEWORK.md` §4.3) with can-do checkpoints in each skill.
- **User problem:** a beginner can reach A1 inside the app.
- **Scope:**
  - **Units 7–12:** content and audio.
  - **Checkpoint tasks:** per skill, with descriptor checklists for speaking and writing.
  - **Feedback on beginner production:** optional AI feedback on short writing and speaking, in Portuguese, quoting evidence, with beginner-appropriate categories (verified by tests on the server).
- **Dependencies:** M15, M16.
- **Acceptance:**
  - as M15;
  - checkpoints exist for listening, reading, speaking and writing;
  - AI feedback is optional, labelled, evidence-quoted and never required to progress.
- **Tests:**
  - content validators;
  - checkpoint scoring tests;
  - server tests for the beginner feedback mode (invalid output and safety checks, as in the existing AI modules).
- **Risks:**
  - **AI feedback at A1:** it can over-correct or use terminology. Constrain prompts and test them with real beginner samples.

### M19: Extend the existing modules to A2–B1
- **Type:** product / content. **Size:** L.
- **Objective:** Reading, Listening, Speaking, Writing and Grammar serve A2–B1 learners, not only B2+.
- **User problem:** after A1, the free modules jump to B2.
- **Scope:**
  - **Levels:** the level enums widened in the five contracts and in targeted practice.
  - **Generation:** constrained to known vocabulary and the grammar scope per level, with checks that reject out-of-level output where checkable (e.g. vocabulary coverage against the learner's items).
  - **Listening:** a curated graded library (text plus audio from M13).
  - **Speaking and Writing:** A2/B1 prompts and short tasks.
  - **Grammar:** A1–B1 topics with explanations *before* practice.
  - **Learning Engine:** taxonomy categories for beginner errors (do-support, subject omission, article use, word order) mapped to remediation.
- **Dependencies:** M16, M18.
- **Acceptance:**
  - generated A2/B1 material passes level checks or is rejected with a clear message;
  - the curated library has reviewed audio;
  - existing B2–C2 behaviour is unchanged (regression tests).
- **Tests:**
  - contract tests for new levels;
  - generator validation tests with fixtures;
  - regression tests for B2–C2.
- **Risks:**
  - **Level control:** generated text is hard to control precisely, so prefer curated content for listening.
  - **Cost:** AI cost grows with use (the learner's own key).

### M20: A2 course content
- **Type:** content. **Size:** XL.
- **Objective:** a guided path through A2.
- **User problem:** after A1, a learner still needs structure, not only free practice.
- **Scope:** units, audio and checkpoints for A2 (`LEARNING_FRAMEWORK.md` §3), the same process as M15 and M18.
- **Dependencies:** M18, M19.
- **Acceptance and tests:** as M15 and M18.
- **Risks:** content cost; consistency with A1.

### M21: Vocabulary trainer for B1+ and library integration
- **Type:** product / content. **Size:** L.
- **Objective:**
  - sense-level, collocation and word-form practice;
  - import of the reviewed vocabulary library beyond the curriculum.
- **User problem:**
  - intermediate and advanced learners need precision work;
  - learners going beyond the course need a reliable library.
- **Scope:**
  - **Exercises:** sense discrimination in context, collocation choice, word families, phrasal verbs.
  - **Library:** packs from the reviewed pipeline output (redistributable profile only), with translations and definitions as separate reviewed records (`VOCABULARY_CONTENT_MODEL.md`).
- **Dependencies:** M16; the pipeline's human review and an enrichment milestone (not yet planned).
- **Acceptance:**
  - no unreviewed or restricted data ships;
  - every pack entry traces to its sources and review.
- **Tests:**
  - pack validation;
  - exercise-checker tests;
  - the pipeline's isolation checks.
- **Risks:**
  - **Licensing:** for definitions and translations.
  - **Review volume:** thousands of entries.

### M22: Pronunciation practice
- **Type:** product. **Size:** M.
- **Objective:** help with sounds Portuguese speakers find hard, honestly.
- **User problem:** pronunciation affects being understood, and nothing in the app addresses it.
- **Scope:**
  - **Practice:** listen-and-repeat with self-comparison; minimal-pair listening (ship/sheep, think/sink); stress patterns.
  - **Research spike:** automatic assessment, adopted only if it is reliable, explainable and privacy-acceptable.
- **Dependencies:** M13, M14.
- **Acceptance:** no score is shown unless the method is validated. Minimal-pair items have reviewed audio.
- **Tests:** exercise tests; validation evidence for any adopted scoring method.
- **Risks:** automatic scoring that is unreliable or fake. Transcription is not pronunciation assessment.

## 3. Deferred tracks (gated by a product decision)

### Multi-user (MU1–MU5)
Start only when a second user is a real requirement. The detail is in the audit, §7.

| Milestone | Type | Content | Acceptance highlights |
| --- | --- | --- | --- |
| MU1 Decision and threat model | security | local-first with sync vs server-first; data classification (recordings and texts are personal data); threat model | written decision; data inventory |
| MU2 Identity and data | security / infra | proven authentication (OIDC or passwordless); server database with migrations; ownership on every record, enforced server-side; sync or migration from IndexedDB | cross-user access tests fail closed; backup and restore tested |
| MU3 AI cost and abuse | security / infra | per-user quotas, rate limits, concurrency and size caps, budget alerts; provider keys only server-side | quota tests; an alert fires on a simulated overspend |
| MU4 Privacy and compliance | security | privacy notice, lawful basis, processor agreement with the AI provider, retention rules, data export and account deletion (including media and backups) | export contains all of a user's data; deletion verified across stores |
| MU5 Operations | infra | HTTPS, environments, content-free structured logs, error tracking, uptime, incident runbook, restore drills | restore drill passes; runbook reviewed |

The security fundamentals in S1 continue throughout.

### Multilingual (ML1–ML2)
Start only after the English A1–A2 path works.

- **ML1 Contracts:**
  - BCP 47 target languages and varieties;
  - translation records per support language;
  - feature-based forms (Universal Dependencies);
  - per-language AI prompts and answer rules;
  - the gaps in `VOCABULARY_CONTENT_MODEL.md` §9.

  M11 should avoid adding new hard-coding so that ML1 stays small.
- **ML2 Second language:** sources and licence decisions, pipeline adapters, a curriculum, audio and reviewers for that language. The framework is shared; the content is not.

## 4. What not to do next

- **Don't import the 15–20k vocabulary library** before the curriculum decides what beginners need.
- **Don't extend the AI generators downwards before the course exists.** Generated A1 material without curated anchors would be inconsistent.
- **Don't build accounts, sync or hosting** without a product requirement.
- **Don't add a second target language.**
- **Don't show pronunciation scores** without a validated method.
- **Don't add gamification,** and don't present activity totals as progress.
