# M7.3 — Final UX Audit

Closing audit of the M7 redesign after the module UX refinement (M7.3). It measures the same surfaces as the M7 baseline, records what changed, and lists what was deliberately left out.

**Method.** Production build served on a local port with a stubbed Groq endpoint. Playwright scripts (`.playwright-mcp/m7/measure73.js`, `.playwright-mcp/m7/audit73.js`, git-ignored, screenshots alongside):

- **Populated profile.** Realistic seeded records (1 listening session, 4 speaking attempts, 2 writing submissions, 8 grammar sets, 2 texts, 2 expressions, practice sets, recommendation states, training sessions).
- **Empty database.** A fresh browser context.
- **Widths.** 1440, 1280, 1024, 820, 390 and 375 px.
- **Themes.** Light, plus dark at 375 and 1024.

## 1. Hubs

| Hub | Primary action | Continue card | Views | Library | Creation panel |
| --- | --- | --- | --- | --- | --- |
| Listening | New session | Most recent session with an unfinished dictation, *Continue dictation* + *Open* | — | Search + source filter; each row links to the session, **Dictation** and **Questions** | Transcribe / File / YouTube tabs + rights note; asks before discarding a chosen file; can't close while uploading |
| Reading | New text | Text in progress (% read) | — | Search + status (in progress / not started / finished) | Generate / Paste your own tabs; either tab's unsaved work is protected |
| Speaking | New topic | (History view lists attempts) | Topics / History | Filters, master/detail (M7.2) | Generate with AI / Write your own; targeted mode for a weakness |
| Writing | New task | Most recent non-empty draft, *Continue writing* | Tasks / Submitted (`?view=submitted`) | Search + draft status; submissions show *Feedback ready* / *No feedback yet* | Embedded task generator with preview, regenerate, edit, *Save task* / *Save and start writing*; targeted mode |
| Grammar | New exercise set | Set with answers but not checked | — | Search + area + level + status; last/best result and rounds | Generator (area, level, types, count, focus); targeted mode |
| Vocabulary | **Review N due** in the always-visible Review queue card (or "Nothing due · Due in N days") | — | Collection / Practice sets (`?view=practice`) | Search + type + review status; tick rows, a sticky "N selected · Practise these" bar | *Practise* panel shows exactly which expressions will be used |

Search and filters appear only once a list has four or more items. Counts use correct plurals. Every list has an empty state whose one action opens the creation panel. No hub shows a permanently open generation form any more.

## 2. Shared components added or extended

- `ContinueCard`, `SearchField` + `FILTER_CONTROL` + `resultCount` + `SEARCH_THRESHOLD` (`components/ui`).
- `SidePanel` (M7.2) now hosts every creation flow. The forms report unsaved work through `onDirtyChange`: Writing and Speaking generators, Grammar generator, Reading generate/paste, the Listening transcription upload and Vocabulary practice.
- `TargetedPracticeNotice`, `useTargetedPractice`, `logTrainingSession` (`features/personalized-training/targeted-practice.tsx`). Pure routing lives in `practise-links.ts`, with tests.
- `HighlightedText` + `highlightsFor` (speaking inline marks, tested).
- `UpdateBanner`, `useNewVersionAvailable` (`lib/version-check.ts`, tested), `useWorkInProgress` / `useHasWorkInProgress` (`lib/work-in-progress.ts`).

## 3. Feedback pages

| Page | Order now | Notes |
| --- | --- | --- |
| Speaking attempt | Recording (first on phones) → **What you said** with corrections marked inline → Feedback (overview, *Focus on first*, task achievement, dimensions folded) → numbered corrections → exercises → fluency | A numbered mark jumps to and focuses its correction. If a category filter hides it, the filter clears first. Recurring patterns moved from the bottom of the list into *Focus on first*, so they aren't shown twice. |
| Writing feedback | Your text (annotated / original / errors fixed / improved) → Revise / Assess again → Feedback (overview, *Work on next*, dimensions folded, required elements) | Corrections list stays the single explanation list (side column on desktop). Improved version stays optional, behind its tab. |
| Grammar set, reading/listening comprehension | Unchanged (already answers → explanations with evidence) | Verified in the browser; no reorder needed. |
| Listening dictation | Unchanged | Word-level diff preserved. |

Errors and suggestions keep distinct labels, underline styles and colours. No new scores were introduced.

## 4. Training integration ("Practise this")

- The learning-insights card, the Recommendations page and Today link to `/<module>?practise=<category>`: Grammar for structures, Writing for register/punctuation/organisation, Speaking for vocabulary range. The module is the first that `trainingOptionsFor` offers.
- The panel opens pre-filled:
  - Grammar → topic + focus
  - Writing → format, register, objective
  - Speaking → format + skill focus
- Other modules that can practise the same weakness are linked from the notice.
- Listening and reading recommendations keep opening the session or text in dictation or questions mode. Vocabulary goes to Review, or `/vocabulary?practise=practice`, which opens the Practise panel.
- **Privacy is unchanged.** The request carries only `targetedPractice` (focus, one-line description, at most 5 examples, optional) plus the panel's settings. The browser capture of a targeted Writing request matched the "Exactly what will be sent" preview field for field.
- Saving logs a `TrainingSession`, as in M6. The browser check saw the generated grammar set appear in the history.
- `/progress/training` is now a launcher (weaknesses → module buttons) plus that history. The generic form is gone.
- Recommendation IDs are category-based, so changing the vocabulary action path does not affect saved done/dismissed states.

## 5. Today on phones

- Order: Continue → Vocabulary reviews → Recommended next → Recent activity (four items, then *Show all (N)*, `aria-expanded`) → Quick start.
- Quick start stays in the side column on desktop.
- The active-day count no longer repeats in the Recent heading (it is in the page description).
- 375 px height: **2,498 → 2,228 px** with the same data.

## 6. Stale version

- `vite build` stamps a build id into the bundle (`__APP_BUILD_ID__`) and writes `dist/version.json`.
- The server sends `cache-control: no-cache` for `index.html`, `version.json` and SPA fallbacks, and `immutable` for hashed `/assets/*` (server test added).
- The client fetches `version.json` (`no-store`) only when the tab regains focus or visibility, at most every 5 minutes. There is no timer polling. A failed lazy chunk (`vite:preloadError`) also counts as a new version. In dev the id is `dev` and no checks run.
- The banner reads "A new version is available. Reload to update." and is a `role="status"` strip.
- It never reloads by itself. **Reload is disabled while an AI request, a transcription upload or an unsaved recording is in progress.** Verified in the browser with a faked newer build and a slowed stub.

## 7. Accessibility and responsive results

- **Horizontal overflow.** None on 15 surfaces × 6 widths (light), or on 11 surfaces at 375/1024 (dark). One overflow found and fixed: long targeted-practice buttons on `/progress/training` at 375.
- **Panels** (6 hubs × 375/1440):
  - Focus moves inside, Escape closes, and focus returns to the opener.
  - Full width on phones; 576 px on desktop.
- **Labels.**
  - No unlabelled visible control on any hub.
  - The one hit inside the Listening panel is the hidden file input (`aria-hidden`, `tabindex=-1`) behind the labelled dropzone button.
  - No duplicate ids.
- **Keyboard.**
  - Writing hub tab order: skip link → navigation → theme → **New task** → view tabs (roving tabindex) → rows → delete buttons → help → privacy link.
  - The inline correction marks are buttons.
  - The jump target shows a focus ring even after a mouse click.
- **Empty database:** every hub shows its empty state with one action, and nothing overflows at 375.
- **Reduced motion:** smooth scrolling to a correction respects `prefers-reduced-motion`.

## 8. Before / after (page height in px, populated profile, light theme)

| Surface | 375 before | 375 after | 1024 before | 1024 after | 1440 before | 1440 after |
| --- | --: | --: | --: | --: | --: | --: |
| Today | 2,498 | 2,228 | 2,338 | 2,031 | 1,427 | 1,316 |
| Listening | 1,674 | 993 | — | 768 | 948 | 900 |
| Reading | 1,769 | 1,123 | — | 864 | 918 | 900 |
| Writing | 1,381 | 1,051 | — | 818 | 964 | 900 |
| Grammar | 2,298 | 1,858 | — | 1,394 | 1,033 | 1,225 |
| Vocabulary | 2,022 | 991 | — | 768 | 1,159 | 900 |
| Speaking attempt | 2,796 | 2,716 | 2,138 | 2,125 | 1,522 | 1,509 |
| Writing feedback | 2,800 | 2,066 | 2,158 | 1,746 | 1,242 | 1,265 |

- 900 px at 1440 is the viewport, so those pages fit on one screen.
- **Grammar desktop grew.** The library is now a full-width row per set with status and results, there is one more set than at baseline (8 vs 7, from the browser test), and the help disclosure is open on a first visit. In exchange, the generation form no longer sits above the sets.
- **The speaking attempt's height is roughly unchanged, but its order changed.** The learner's recording and transcript now come before any feedback.

## 9. Tests

| Package | Before M7.3 | After |
| --- | --: | --: |
| shared | 378 | 378 |
| client | 135 | 152 (+8 practise links, +4 issue highlights, +5 version check) |
| server | 230 | 231 (+1 static caching headers) |
| **Total** | **743** | **761** |

New test files:
- `apps/client/src/features/personalized-training/practise-links.test.ts`
- `apps/client/src/features/speaking/issue-highlights.test.ts`
- `apps/client/src/lib/version-check.test.ts`

New test case: the static-serving test in `apps/server/test/app.test.ts`.

## 10. Security and regression

- `npm run typecheck`, `npm test` and `npm run build` pass. `npm audit` reports 0 vulnerabilities. `git diff --check` is clean.
- **Secret scan.** No key values in changed files or in `dist/`. The only matches are the variable name `GROQ_API_KEY` in setup instructions, which predate this work.
- **Storage is unchanged.** No IndexedDB schema change (v6), no new stores, same localStorage keys. A backup export after the work is schema 1 with all 16 stores and every record.
- **AI runs only on explicit actions.** Generate, Get feedback, Transcribe and Look up are explicit buttons, and the version check never touches `/api`.
- No new dependencies.
- M1–M6 behaviour was spot-checked in the browser:
  - dictation page
  - reader
  - grammar set
  - speaking and writing feedback
  - Progress
  - recommendations
  - Settings & data export

## 11. Limitations and deferred items

- The seeded speaking attempts' transcripts don't contain their correction quotes, so they show no inline marks. Marks were verified with a temporary matching record (removed afterwards). Real assessments are validated server-side to quote the transcript.
- **Hub status heuristics:**
  - Grammar: answered but unchecked → in progress.
  - Reading: past the first paragraph → in progress.
  - Listening Continue: transcript present and dictation not complete.
- Deferred, with reasons, in `M7_ROADMAP.md`: shared `CorrectionCard`, `Toast`, `KbdLegend`, reader/editor tablet drawers.
- A screen-reader walkthrough with real assistive technology (NVDA/VoiceOver) was not performed. The checks cover roles, names, focus and keyboard order through the accessibility tree.
- The stale-version check depends on the tab regaining focus. A tab left in the foreground for hours will only notice on the next focus change or the next lazy-chunk failure, which is by design (no polling).
