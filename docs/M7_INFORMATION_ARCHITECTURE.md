# M7 — Information Architecture

Companion to `M7_UX_AUDIT.md`. Goal: a learner should know at a glance **where to practise, where to study language, where to see progress and where to manage their data**.

## 1. Diagnosis of the current sidebar

```
Overview
PRACTICE      Listening · Speaking · Writing · Reading
FOUNDATIONS   Grammar · Vocabulary
REVIEW        Progress
(footer)      English · B2→C1 · theme switcher
```

| Group | Works? | Why |
| --- | --- | --- |
| Overview | No | It is a brochure of the modules, not a starting point (audit C1). |
| Practice | Mostly | The four skills belong together. The order mixes input and output (Listening, Speaking, Writing, Reading). |
| Foundations | Partly | "Foundations" suggests beginner material; Grammar here is C1 work. Vocabulary is also a *review* activity (due reviews), which the label hides. |
| Review | No | One item. "Progress" contains six jobs, including data administration (audit C2, M5). |
| Settings | Missing | No settings page; preferences live in four modules; data management is under Progress. |

## 2. Alternatives considered

**A. Keep the groups, fix the content.** Lowest risk, but "Review" stays a one-item group and data stays inside Progress.

**B. Group by activity: Learn / Practise / Review.** Clean in theory, but every module would straddle groups (Vocabulary is learn *and* review; Writing is practise *and* review of feedback). Learners think in skills, not activities.

**C. Skills first, with a real home and a settings area (recommended).** Keep the skill groups learners already understand, give the home page a job (what to do now), keep Progress for understanding, and move everything about *me and my data* to Settings.

## 3. Recommended navigation

```
Today                         ← home: what to do now
PRACTISE
  Listening
  Reading
  Speaking
  Writing
LANGUAGE
  Grammar
  Vocabulary          (3 due)  ← functional count, not a reward
PROGRESS
  Progress                     ← Overview · Skills · Mistakes
─────────────
Settings & data                ← footer item, always visible
```

Rules:

- **Seven destinations plus Settings.** No nesting in the sidebar; sub-pages are reached from the module.
- **Input before output** inside Practise: Listening, Reading (receptive), then Speaking, Writing (productive). It matches the order learners usually work in and the order evidence flows (reading → vocabulary → writing).
- **"Language"** replaces "Foundations": it names the content (grammar and vocabulary), not a level.
- **Counts only where they mean work to do** (due reviews). No streaks, no totals, no badges.
- **Settings & data** at the bottom of the sidebar (and in the mobile menu), alongside the theme switcher it absorbs.
- **Tablet (768–1279 px):** a collapsible icon rail with labels on hover/focus instead of the phone hamburger. **Phone (< 768 px):** the existing menu dialog, with Today pinned first.

## 4. Page organisation

### Today (`/`)
1. **Next steps:** the top three recommendations from the learning engine, plus "N expressions due" and "Continue your draft / session" items. Each is one action.
2. **Continue:** the last 3–5 things touched across modules (draft essay, listening session, unchecked grammar set).
3. **This week:** a compact, honest activity summary (active days, completed exercises) linking to Progress.
4. **Start something new:** a quiet row of the seven modules, used mostly on day one.
First run (no data): a short welcome with three starting points (Listen, Read, Speak) and a link to restore a backup.

### Module hubs (Listening, Reading, Speaking, Writing, Grammar, Vocabulary)
One anatomy for every hub:

```
Header        Title · one-line description · [primary: New …] [secondary]
Continue      in-progress items (drafts, unchecked sets, sessions) — hidden if none
View switch   Library | History        (module-specific names, max 3 views)
Filter bar    search · 1–2 selects · active filter chips · result count
List          compact rows or cards; preview on select (desktop), page/sheet (phone)
Help          "How it works" disclosure, collapsed by default
```

Creation ("New …") opens one consistent **creation sheet** (side panel on desktop, full-screen sheet on phones) with the same sections everywhere: *Source* (curated / generate / paste or upload), *Settings*, *Create*. The privacy line sits next to the button that sends data.

### Work pages (practice, editor, session, reader, set)
- Breadcrumb: `Speaking / Smartphones in schools`. One back pattern for the whole app.
- The learner's activity is the main column; instructions and settings sit in a side panel (desktop) or a collapsible "Task" drawer (phone).
- Settings that must be chosen before starting come **before** the start action.

### Result pages (speaking attempt, writing feedback, checked sets)
- **The learner's own work first** (text or transcript with inline corrections), then *What to work on next* (the top 2–3 priorities), then dimension levels collapsed into a compact summary, then exercises.
- One corrections list, linked to the inline highlights (not two copies).

### Progress (`/progress`)
Three sections, no administration:
- **Overview:** activity and results by module (unchanged content).
- **Skills:** strengths and improvements by area.
- **Mistakes:** recurring and preliminary patterns with evidence (renamed from "Recurring errors").

Recommendations move to **Today** (where action happens) with a "See all" view at `/progress/recommendations`. Personalized training becomes a **"Practise this"** action that opens the target module's creation sheet pre-filled with the weakness and the bounded examples (same generators, same privacy rules), instead of a parallel form.

### Settings & data (`/settings`)
- **Appearance:** theme.
- **Learning preferences:** transcription language and model, reading display defaults, explanation language.
- **Data & backups:** inventory, export, import (moved from Progress, unchanged behaviour).
- **Privacy & AI:** one page explaining what is sent to Groq for each action, what stays in the browser, and how long the server keeps uploads. Module pages link here from their one-line notes.
- **About:** server and transcription status (moved from the Overview "Workspace" card), app version.

## 5. Route map

| Today | Change |
| --- | --- |
| `/` | Becomes **Today** (same route). |
| `/listening`, `/reading`, `/speaking`, `/writing`, `/grammar`, `/vocabulary` | Same routes, new hub anatomy. Views via `?view=` (e.g. `/speaking?view=history`). |
| All detail routes (`/speaking/attempts/:id`, `/listening/session/:id?mode=…`, `/writing/tasks/:id`, …) | **Unchanged.** Evidence links stored in the learning engine (`sourcePath`) and recommendation actions depend on them. |
| `/progress?section=overview|skills|errors` | `/progress`, `/progress/skills`, `/progress/mistakes`. Old query URLs redirect. |
| `/progress?section=recommendations` | `/progress/recommendations` (also surfaced on Today). |
| `/progress?section=training&category=…` | Redirects to the module's creation sheet with the category pre-selected (e.g. `/grammar?new=targeted&category=prepositions`). |
| `/progress?section=data` | `/settings/data` (redirect). |
| — | New: `/settings`, `/settings/data`, `/settings/privacy`. |

## 6. User journeys

**Daily return (most common).** Open app → Today shows "3 expressions due", "Continue: opinion essay draft", "Work on prepositions" → one click into each. *Today:* the Overview shows a static brochure; the learner must remember where things are.

**Practise speaking on a new topic.** Speaking → filter by level/topic or search → preview the full prompt → Practise → choose mode and time → record. *Today:* scroll a 14-card grid, open a card to read the full prompt, choose settings after the prompt.

**Use my own speaking topic.** Speaking → "New topic" → Generate or Write → save → practise. *Today:* scroll past 14 curated cards to "Your own topics".

**Understand a mistake pattern and act on it.** Today or Progress → Mistakes → open evidence → "Practise this" → Grammar creation sheet pre-filled → generate. *Today:* Progress → Recurring errors → Personalized training tab → a separate form.

**Back up my data.** Sidebar → Settings & data → Data & backups → Download. *Today:* Progress → sixth tab.

**Read, look up, save, review.** Reading → open text → select phrase → Look up → Save → Vocabulary shows "1 due" in the sidebar tomorrow → Review. *Unchanged flow; the due count makes the loop visible.*

## 7. Relationships between modules

```
            Listening ──transcript──► Vocabulary (planned)
                │                         ▲
                ▼ dictation, comprehension│ lookups
Reading ───────────────────────────────────┘
   │ comprehension
   ▼
Progress ◄── evidence ── Speaking, Writing, Grammar, Listening, Reading, Vocabulary
   │
   └── "Practise this" ──► Grammar / Writing / Speaking creation sheets
Today ◄── recommendations, due reviews, drafts, recent activity (all modules)
Settings & data ── preferences used by Listening, Reading, Vocabulary; backups of everything
```

The UI should show these links where they happen (e.g. "Saved to Vocabulary" with a link; "From your reading of *Bookshops*" on a vocabulary entry; "Evidence from your essay" in Progress), rather than through extra navigation.
