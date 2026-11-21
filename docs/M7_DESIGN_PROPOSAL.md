# M7 — Design Proposal

Builds on `M7_UX_AUDIT.md` (problems) and `M7_INFORMATION_ARCHITECTURE.md` (structure).

## 1. Direction: "a quiet study, not a dashboard"

Keep the identity: Newsreader, Inter, JetBrains Mono, warm paper surfaces, terracotta accent, light and dark themes. The redesign is about **removing simultaneous information and making every page follow the same grammar**, not about new decoration.

Principles:

1. **One job per screen region.** A page has one primary action; creation happens in a sheet, not in a permanently open form.
2. **The learner's work comes first.** Their text, transcript or answers are the main column; explanations are secondary.
3. **Explain once, then get out of the way.** "How it works" and privacy details collapse after first use and live in full on one Settings page.
4. **Same thing, same look, same place.** One tab component, one back pattern, one empty state, one creation sheet, one corrections card.
5. **Colour carries meaning.** Red is for errors and destruction only; terracotta is identity and emphasis; levels use a neutral scale.
6. **Typography does the hierarchy.** Serif for titles and learner content, sans for UI, mono only for time and timestamps.

Explicitly out of scope: gradients, new typefaces, motion beyond short state transitions (respecting `prefers-reduced-motion`), gamification, KPI-dashboard styling.

## 2. Token refinements (small, targeted)

| Token | Today | Proposal | Why |
| --- | --- | --- | --- |
| `--destructive` | errors, destructive actions **and** neutral levels ("Developing") | errors and destructive actions only | Audit H3: seven red badges read as failure. |
| new `--caution` / `--caution-subtle` | — | amber ochre that fits the paper palette, for "needs work" and the "Developing" level | A middle step between success and error. |
| level scale | strong = success; developing = destructive | strong → success, solid → neutral ink, developing → caution, limited → caution (strong) | Levels describe; they do not alarm. |
| suggestion style | terracotta badge | neutral outline badge with a dotted underline (as in the text annotations) | Error vs suggestion becomes unmistakable. |
| `--brand` usage | identity, progress, record, chart, active line, focus, statuses | identity, record/live state, the active navigation item, focus ring, single-series charts | Brand stays special. |
| numerals | mono in tiles and counts | mono only for timers, timestamps and durations in players; `tabular-nums` Inter elsewhere | Audit M4. |
| selected tile | darker border + faint fill | 2 px ink border + check icon + subtle fill; same token in both themes | Audit H2: selection must be visible at a glance. |

All new colours must pass AA in both themes, verified with the same contrast checks used in M6.

## 3. Component hierarchy

```
AppShell
├── Sidebar (desktop) / Rail (tablet) / MenuDialog (phone)
│   ├── NavGroup · NavItem (+ count)
│   └── Footer: Settings & data, theme
└── Page
    ├── PageHeader      breadcrumb | eyebrow · title · description | primary · secondary · overflow menu
    ├── ContinueStrip   in-progress items (optional)
    ├── ViewSwitcher    one Tabs component (underline variant for page views)
    ├── FilterBar       search · selects · active chips · count · clear
    ├── Collection      ListRow | ItemCard | PreviewPanel (desktop) / PreviewSheet (phone)
    ├── EmptyState      icon · one sentence · one action
    ├── HelpDisclosure  "How it works", remembers collapsed state
    └── CreationSheet   Source · Settings · Create (+ PrivacyNote next to the action)

Shared feedback pieces
├── StatusBadge (level scale), KindBadge (error / suggestion / correct)
├── CorrectionCard (original → correction · explanation · jump to text / play)
├── FeedbackSummary (priorities + collapsed dimension levels)
├── MetricTile (exists in Progress), EvidenceList (exists in Progress)
├── Notice (exists), Toast (new: transient "Saved", "Exported")
├── ConfirmDialog (exists), Segmented (modes: Read along / Dictation / Comprehension)
└── KbdLegend (popover from a "Shortcuts" button)
```

### Shared component opportunities (from the audit)

| Pattern | Where it is duplicated today | Shared component |
| --- | --- | --- |
| Page header + back button | every page, five back labels | `PageHeader` with `breadcrumb` slot |
| "Generate …" forms | Speaking, Writing, Grammar, Reading, Vocabulary, Progress training | `CreationSheet` + per-module settings fields |
| Library lists | each hub, different rows | `ListRow` / `ItemCard` with title, meta, status, actions |
| Filters | Speaking pills, Vocabulary search + selects, correction filters | `FilterBar` |
| Tabs | 5 styles (audit H2) | `Tabs` (underline, page views) + `Segmented` (modes) |
| Empty states | 4 styles (audit M10) | `EmptyState` |
| How it works / privacy | 8+ variants (audit H6) | `HelpDisclosure` + `PrivacyNote` (one line + link to Settings → Privacy & AI) |
| Corrections | Speaking and Writing cards differ | `CorrectionCard` |
| Dimension levels | Speaking (5) and Writing (7) grids | `FeedbackSummary` with the level scale |
| Destructive confirmations | already shared | keep `ConfirmDialog` |

## 4. Speaking case study (`/speaking`)

### Options compared

**Option A — Three tabs: Explore · My topics · Recent attempts (as suggested in the brief).**
- ✅ Each view is short; clear separation.
- ❌ Hides the learner's own history and topics behind clicks on the default screen; "Explore" is still a long grid; three tabs for one hub breaks the "max 2–3 views" rule only slightly, but splits *topics* into two places (curated vs mine) although the learner just wants "a topic".

**Option B — One page, reordered: Continue strip → compact filter bar → topic grid → own topics.**
- ✅ Least change; everything visible.
- ❌ Still long; still shows everything at once; preview problem unsolved.

**Option C — Master/detail topic browser.**
- ✅ Solves truncation: a compact list (title, level, category, duration) with a preview panel showing the full prompt, points and structure, and the Practise action.
- ❌ On its own it does not surface attempts or creation.

### Recommendation: B's order + C's browser, with two views

```
┌ Speaking ─────────────────────────────── [ New topic ] [ ? How it works ] ┐
│ Continue:  ▸ "Remote or office work?" — feedback ready · 2 days ago        │
│            ▸ "My job interview" (your topic) — not practised yet            │
├────────────────────────────────────────────────────────────────────────────┤
│ [ Topics ] [ History (3) ]                                                  │
│ 🔍 Search topics   Level ▾   Topic ▾   Source: All · Library · Mine         │
├───────────────────────────────┬────────────────────────────────────────────┤
│ ▸ Smartphones in schools  B2 1:00 │  B2 · Technology · 1:00                │
│   AI and human creativity C1 2:00 │  Smartphones in schools                │
│   Remote or office work?  B2 1:00 │  Should smartphones be banned in…      │
│   My job interview   Mine  C1 2:00│  Cover: • … • … • …                    │
│   …                               │  [ Practise ]                          │
└───────────────────────────────┴────────────────────────────────────────────┘
```

- **Two views, not three.** *Topics* (library and your own, filterable by Source) and *History* (all attempts). Own topics are not a separate place: they are topics with a "Mine" tag, and editing/deleting them happens from the preview.
- **"New topic"** in the header opens the creation sheet with two sources: *Generate with AI* and *Write your own*. It is reachable from the first screen on every device.
- **Continue strip** shows at most three items: the latest attempt (with feedback state) and unpractised own topics. It disappears when empty.
- **Filter bar** in one row: search, Level select, Topic select, Source segmented. On phones: search + a "Filters" button opening a sheet. Tab stops before the first topic: ~6 instead of 21.
- **Topic rows** instead of tall cards; the full prompt lives in the preview panel (desktop) or opens the practice page directly (phone), so nothing is truncated without a way to read it.
- **How it works** becomes a `HelpDisclosure` opened from the header "?" and shown expanded only on the first visit; the privacy paragraph becomes one `PrivacyNote` line next to "Transcribe" on the practice page.

Expected effect: desktop page height ~1,000 px instead of 2,316; phone ~1,600 px instead of 4,700; personal content on the first screen.

### Practice page (`/speaking/practice/...`)
- One title (remove the duplicated card title).
- Order: **Task** (prompt, points, structure) → **Set up** (mode, time) → **Record**. On desktop: prompt left, recorder right with set-up above the record button; on phones: prompt collapsible, set-up, then a sticky record bar.
- "Start recording" keeps the terracotta: it is the only "live" action in the app and the rule is documented.

## 5. Page-by-page proposal

| Page | Before | After | Priority |
| --- | --- | --- | --- |
| **Today** (`/`) | Static brochure; "Start with listening"; false "Nothing recorded yet"; module grid duplicating the sidebar | Next steps from recommendations and due reviews; Continue; This week; quiet module row; real first-run state | P1 (fix false copy immediately, P0) |
| **Listening hub** | Import tabs inside a card; library only with data; permanent "How to practise" | Header "New session" → creation sheet (Transcribe / File / YouTube); Continue (last session + position); session list with filter; help disclosure | P2 |
| **Listening session** | Dark segmented modes; permanent shortcut legend; transcript and transcription cards stacked | Keep the segmented control (modes are modes) but in the shared `Segmented`; shortcuts in a popover; transcript panel first in the side column | P3 |
| **Reading hub** | Always-open generator; two "Generate" buttons; empty library card stretched | Library first; "New text" sheet with Source = Generate / Paste; empty state with one action | P2 |
| **Reader** | Already the best page; tools panel with tabs | Keep; adopt shared Tabs; breadcrumb; "Saved to Vocabulary" toast with link | P3 |
| **Speaking hub** | See section 4 | See section 4 | P1 (pilot) |
| **Speaking attempt** | Feedback grid first, transcript last | Transcript with inline corrections first; FeedbackSummary (priorities + compact levels); exercises; fluency in a side panel | P3 |
| **Writing hub** | Generator behind a button (good) but tasks left / submissions right; permanent help | Two views: *Tasks* (drafts + not started) and *Submitted*; "New task" sheet; help disclosure | P2 |
| **Writing editor** | Brief beside the editor; good | Keep; breadcrumb; brief as a collapsible drawer on tablet | P3 |
| **Writing feedback** | 7 dimension cards first; corrections duplicated; text below | Text with inline corrections as the main column; one CorrectionCard list beside it (sticky on desktop), filter Errors / Suggestions; FeedbackSummary above; levels collapsed | P2 |
| **Grammar hub** | Generator always open; library right | Library first ("Your exercises" with last/best result); "New exercise" sheet; Progress-driven "Practise this" opens the same sheet pre-filled | P2 |
| **Grammar set** | Question cards; good | Keep; breadcrumb; sticky "Check answers" bar on phones | P4 |
| **Vocabulary** | Collection + always-open practice form; header "Review N due" | Header primary "Review (N due)"; secondary "Practise"; collection with FilterBar; practice opens the creation sheet with the selected rows | P2 |
| **Vocabulary entry / review / practice** | Fine | Breadcrumb, shared badges | P4 |
| **Progress** | Six tabs incl. data and training | Three sections (Overview, Skills, Mistakes); recommendations on Today with a full list page; training → "Practise this"; data → Settings | P2 |
| **Settings & data** | Does not exist | Appearance, Learning preferences, Data & backups, Privacy & AI, About | P1 |
| **404** | Fine | Link back to Today | P4 |

## 6. Before/after rationale (summary)

- **Today** turns the most-visited screen from a static page into the place where the engine's work becomes visible — without adding any new data or score.
- **Creation sheets** remove five permanently open forms, which are the main cause of long pages and of "where is my stuff?".
- **Settings & data** gives backups and preferences an obvious home and lets every module drop its privacy paragraph to one line.
- **Result pages led by the learner's work** match how people study feedback: read the text, see the marks, then the summary.
- **One tab, one back, one empty state** removes most of the "every module is a different app" feeling at low cost.

## 7. Implementation priority

1. **P0 — Truth fixes (no redesign):** Overview false empty state and stale onboarding copy; "Developing" colour; error vs suggestion badges.
2. **P1 — Foundations:** tokens, `PageHeader` with breadcrumb, `Tabs`/`Segmented`, `FilterBar`, `EmptyState`, `HelpDisclosure`, `PrivacyNote`, `CreationSheet`; new navigation + Settings & data; Today; Speaking hub as the pilot.
3. **P2 — Hubs and results:** Writing, Grammar, Reading, Vocabulary, Listening hubs; writing feedback; Progress restructure.
4. **P3 — Work pages:** speaking attempt and practice, listening session, reader, editor.
5. **P4 — Polish:** remaining detail pages, copy pass, 390/375 checks, dark-theme pass, accessibility audit.

Details, dependencies and acceptance criteria: `M7_ROADMAP.md`.
