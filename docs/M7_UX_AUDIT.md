# M7 — UX Audit

Audit of the running application after M6 (`8621555`), on branch `feat/design-ux-refinement`. Nothing in the application was changed.

## Method

- Production build (`npm start`, port 3002) with a local Groq stub, inspected with Playwright.
- Two data states: a **fresh database** (first-run experience) and a **seeded database** (3 speaking attempts, 2 writing submissions, 7 grammar sets, a listening session with dictation and comprehension, 2 reading texts, 2 vocabulary entries, practice sets, recommendation decisions and a training log), imported through the app's own backup flow.
- Widths: 1440, 1280, 820 (tablet), 390 and 375. Light and dark themes. Keyboard tab order and focus visibility. Mobile menu.
- Measurements were taken from the DOM (page height, horizontal overflow, headings, buttons, tab stops); screenshots are in `.playwright-mcp/m7/` (git-ignored).

### Routes inspected

| Area | Routes |
| --- | --- |
| Overview | `/` |
| Listening | `/listening`, `/listening/session/:id` (read along, dictation, comprehension) |
| Speaking | `/speaking`, `/speaking/practice/library/:id`, `/speaking/attempts/:id` |
| Writing | `/writing`, `/writing/tasks/:id` (editor), `/writing/attempts/:id` |
| Grammar | `/grammar`, `/grammar/sets/:id` |
| Reading | `/reading`, `/reading/texts/:id` |
| Vocabulary | `/vocabulary`, `/vocabulary/entries/:id`, `/vocabulary/review` |
| Progress | `/progress` with sections Overview, Skills, Recurring errors, Recommendations, Personalized training, Data & backups |
| Other | `/settings` (does not exist: 404), unknown routes (404 page) |

### Key measurements

| Page | Desktop height (1440) | Mobile height (375) | Note |
| --- | --- | --- | --- |
| `/speaking` (no data at all) | 2,316 px | **4,718 px** | 14 curated cards before anything personal |
| `/speaking` (seeded) | 2,316 px | ~4,900 px | attempts appear after all 14 topics on mobile |
| `/` | 1,950 px | 3,502 px | unchanged by data (see C1) |
| `/progress` | 1,558 px | 3,135 px | |
| `/writing/attempts/:id` | 1,200 px | 2,748 px | the text itself appears after 7 cards |
| Listening, Writing, Grammar, Reading, Vocabulary hubs | 900–960 px | 1,030–1,850 px | |

No page has horizontal overflow at 375 px. Focus is visible on every tab stop sampled. A skip link exists.

## What already works (keep it)

- The typographic system (Newsreader for titles and learner text, Inter for UI, JetBrains Mono for time) gives the product a calm, literary character that suits reading and writing. Keep it.
- The paper palette and the dark theme are well balanced; contrast is good in both.
- The evidence presentation (strikethrough original → correction, quoted transcript) is the product's best idea and is visually clear.
- Honest copy: limits, estimates and privacy are stated plainly.

The problems below are about **structure**, not about taste.

---

## Findings

Severity: **Critical** (misleading or blocks a core journey), **High** (regular confusion or extra work in core journeys), **Medium** (friction, inconsistency), **Low** (polish).

### Critical

**C1. The Overview shows false and stale information.**
- "Recent practice — Nothing recorded yet. Practice history arrives with the Progress module" is shown **even with a full history** (seeded database: 3 recordings, 2 essays, 7 grammar rounds). Progress has existed since M6.
- The hero still says "Start with listening: bring in audio, video…", the M1 onboarding message; the only primary action on the home page is "Open Listening".
- Every module card carries an "Available" badge (all seven are available, so the badge carries no information) and the grid repeats the sidebar.
- The "Workspace" card (server connected, transcription available, target language) is half empty and is not information a learner needs every day.
- *Why it matters:* the home page is the first screen of every session. It contradicts the "no fake data" rule and never answers the one question a learner has on opening the app: *what should I do now?* All the data needed to answer it (due reviews, drafts in progress, recommendations, last activity) already exists.

**C2. There is no place for personal data and preferences; data management is buried under "Progress".**
- `/settings` is a 404. Preferences are scattered: theme in the sidebar footer, transcription language and model inside Listening, reading display settings inside the reader, the Portuguese-explanation preference inside Vocabulary.
- Backup, import and **replace all data** — the most consequential actions in the app — live in the sixth tab of the Progress page ("Data & backups"). A learner looking for "export my data" has no reason to look under Progress.
- Privacy information is repeated in eight or more places in different forms (see H6) but there is no single page that explains what is sent where.
- *Why it matters:* the brief's question "where do I manage my personal data?" currently has no answer.

**C3. The Speaking hub shows everything at once and hides what matters most.**
- With no data, the page is 2,316 px tall on desktop and 4,718 px on a phone. Fourteen curated cards come first; **"Your own topics" and "Generate with AI" come after all 14**; on phones, **"Your attempts" (your own history) comes after them too**.
- Two rows of filter pills (3 levels + 8 categories) take ~110 px and **12 tab stops**: a keyboard user presses Tab 21 times before reaching the first topic.
- Topic descriptions are clamped at three lines ("Discuss…", "Evaluate whether it could work acros…") with no way to read the full prompt before opening the practice page.
- "How it works" (4 steps + a 6-line privacy paragraph + a pronunciation note + a CTA) is permanently visible in the sidebar; the sidebar ends after ~800 px while the main column continues to ~1,750 px, leaving a large empty right half.
- *Why it matters:* Speaking is a daily activity. The returning learner wants "continue / try again / my topic", the new learner wants "pick something quickly"; the current layout serves neither first.

### High

**H1. Every module hub has a different layout grammar.** The learner re-learns the page structure in each module:

| Hub | Creation | Library | Secondary column |
| --- | --- | --- | --- |
| Listening | Tabs (Transcribe / File / YouTube) in the main card | Session list (appears only with data) | "How to practise" card |
| Speaking | Curated grid; generator below the grid | — | Attempts + How it works |
| Writing | Hidden behind a "Generate a writing task" button | Tasks in the main card | Submissions + How feedback works |
| Grammar | **Always-open** form in the main card | Right column | Privacy note |
| Reading | **Always-open** form with a Generate/Paste toggle | Right column | — |
| Vocabulary | **Always-open** practice form in the right column | Collection left | Header-level "Review 1 due" button (unique) |

The same concept — *your saved things* — is on the left in Writing and Vocabulary and on the right in Grammar and Reading. Generation is collapsed in Writing and Speaking, expanded in Grammar, Reading and Vocabulary.

**H2. Five different tab and selection patterns.**
- Underline tabs (Listening import, reader tools, writing text views).
- A dark segmented control (listening session modes).
- A segmented toggle in Reading where the active "Generate" segment is a filled dark pill that **looks exactly like the primary button** "Generate a text" a few centimetres below — two "Generate" buttons on screen.
- Dark filter pills (Speaking filters, correction filters), which also look like primary buttons.
- Link tabs on Progress, which scroll horizontally on phones and hide "Recommendations", "Personalized training" and "Data & backups" off-screen.
- The selected state of choice tiles (question types, exercise types, length) is a slightly darker border plus a faint fill. In Grammar, four selected tiles are hard to tell apart from the two unselected ones.

**H3. Semantic colour is overloaded and sometimes misleading.**
- Neutral levels such as "Developing" (the normal state for a B2→C1 learner) are shown in the **destructive red**, with an alert-style icon, on every feedback card. Seven red "Developing" badges on an essay read as failure.
- In writing feedback, the "Error" badge (red) and the "Suggestion" badge (terracotta) are nearly indistinguishable in both themes — yet separating errors from suggestions is the product's core promise.
- Terracotta is used for identity, the active transcript line, progress bars, chart bars, the record button, focus rings and "Recurring" status at the same time, so it no longer signals anything specific.

**H4. Naming and back navigation are inconsistent.**
- Sidebar: "Speaking", "Writing". Pages and back buttons: "Speaking Lab", "Writing Lab". Eyebrows: "SPEAKING ATTEMPT", "WRITING FEEDBACK", "YOUR TEXT", "LISTENING SESSION", "SPEAKING PRACTICE".
- Back links: "All sessions", "Speaking Lab", "Writing Lab", "Library", "All topics" — five labels for the same action. They sit at the right edge of the header, below the title baseline, far from where the eye starts on desktop and wrapped under the title on tablets.
- No page shows where it sits in the hierarchy (no breadcrumb), so deep links from Progress evidence land on pages with no visible context.

**H5. Detail pages bury the learner's own work.**
- Writing feedback: seven dimension cards (each "Developing · Generally clear.") come before the learner's text; the corrections appear **twice** — a list in the right column and a "Corrections" tab in the text panel below — and on tablet/phone the list falls after everything (2,748 px at 375 px).
- Speaking attempt: the transcript is the last block on the page.
- Speaking practice: the title appears twice (page title and card title); mode and duration, which must be chosen *before* recording, are placed after the prompt in the right column.

**H6. Permanent explanatory and privacy copy everywhere.** "How it works" (Speaking), "How to practise" (Listening), "How feedback works" (Writing), plus privacy paragraphs or footnotes on Speaking, Practice, Writing, Grammar, Reading, the reader, Vocabulary and Personalized training, each worded differently and styled differently (card, icon note, footnote). Useful once; noise every day after.

**H7. Tablets get the phone layout.** At 820 px the sidebar is hidden behind the hamburger and every page collapses to one column of wide cards, although an icon rail plus a two-column layout would fit. Horizontal tab strips get scroll arrows.

### Medium

- **M1. Primary actions are worded and coloured differently:** "Generate", "Generate a text", "Generate exercise", "Generate a writing task", "Generate with AI", "Generate practice", "Generate targeted practice". All primaries are ink-black except "Start recording" (terracotta) — the exception is defensible, but it is not a rule anywhere.
- **M2. Equal-height grids create large empty cards:** the empty Reading library and the Vocabulary collection stretch to the height of the form beside them.
- **M3. Truncation:** "Conditionals and mixed conditiona…" in the grammar-area select; placeholders cut mid-word ("marine biolog"); speaking prompts clamped without preview.
- **M4. Mixed numerals in controls:** choice tiles mix Inter and JetBrains Mono digits ("8" next to "10", "0:30"); mono is right for timers and timestamps, not for counts in buttons.
- **M5. Progress mixes three jobs in one tab strip:** reviewing (Overview, Skills, Recurring errors), acting (Recommendations, Personalized training) and administering (Data & backups).
- **M6. Two entry points to the same generators:** a grammar set can be generated from Grammar or from Progress → Personalized training, with different forms and different defaults.
- **M7. Speaking filters as pills:** 11 pills for two dimensions; a search box or two selects would take one row.
- **M8. Vocabulary practice form always open,** competing with the collection for attention; "Review 1 due" is the only header-level action pattern in the app.
- **M9. Listening session keyboard legend** (eight shortcuts) is permanently visible under the player.
- **M10. Hub empty states are inconsistent:** "No tasks yet. Generate one to start writing." (inline sentence), "Texts you generate or paste appear here." (card), a dashed panel (Progress), nothing at all (Listening library).

### Low

- **L1.** "At the B2 → C1 boundary" on the Overview is static, decorative content.
- **L2.** "Saved in this browser" appears as a subtitle in at least six cards.
- **L3.** The sidebar footer ("English · B2 → C1" + theme switcher) is the only place that hints at a profile, but it is not interactive.
- **L4.** Long titles in the Speaking attempts list wrap to three lines on phones because the date, duration and status share one line.

## Mobile-specific summary (375–390 px)

- Speaking: 4.7–4.9k px; personal content after 14 cards (C3).
- Writing feedback: 2.7k px; corrections list after all dimension cards (H5).
- Progress: section tabs scroll off-screen; half the sections are invisible without horizontal scrolling (H2, M5).
- Forms (Grammar, Reading, Vocabulary practice) are fully expanded before the library, so a returning learner scrolls past a form to reach saved work (H1).
- The menu is a dialog with all groups; it works, but there is no quick access to "continue" or "due reviews".

## Desktop-specific summary (1280–1440 px)

- Unbalanced two-column layouts where the secondary column ends early (Speaking, Writing, Speaking attempt).
- Back buttons far from the reading line (H4).
- The Overview spends its first screen on static marketing copy (C1).
