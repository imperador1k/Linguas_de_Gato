# M7 — Redesign Roadmap

## Status

- **M7.1 (done, `6f235a3`):** Step 0 (baseline screenshots in `.playwright-mcp/m7/before-*`, truthful Overview, semantic colours), the shared foundations of Step 1 that had real duplication (`PageHeader` back slot, `TabList`, status primitives, `EmptyState`, `HelpDisclosure`, `PrivacyNote`, `caution` tokens) and Step 2 (navigation, tablet rail, mobile drawer, Settings & data, Progress section routes with legacy redirects). Not yet built: `FilterBar`, `CreationSheet`, `Toast`, `KbdLegend` (they belong with the hub redesigns).
- **M7.2 (done, `d3358a0`):** Step 3, Today (continue learning, recommended next, vocabulary reviews, recent activity, quick start; honest first use), built on a tested shared `todayWork` and the M6 engine. Step 4, Speaking hub pilot: Topics and History views, one-row filters with search, curated and personal topics in one master/detail list with full-prompt preview (inline on phones), the shared `SidePanel` for New topic (Generate with AI / Write your own) and editing, and a practice page ordered Task → Set up → Record → Check transcript → Feedback → Exercises.
- **M7.3 (done, `7e2f36e`):** Steps 5–7. Listening, Reading, Writing, Grammar and Vocabulary follow the Speaking hub anatomy (one primary action, Continue card, views, search/filters, library, creation `SidePanel`, help at the bottom). "Practise this" opens the module's own panel in targeted mode (`?practise=<category>`) with the same bounded profile; `/progress/training` became a launcher plus history. Speaking and Writing feedback put the learner's work first with inline marks and one corrections list; dimensions fold away. Today on phones: Continue → reviews → recommended → four recent items with "Show all" → shortcuts. Stale-version banner (`version.json` + build id, no polling, never auto-reloads, waits for in-flight work). Full audit in `M7_FINAL_UX_AUDIT.md`.
  Deferred, with reasons: a shared `CorrectionCard` across Speaking and Writing (their data shapes differ: timestamps and severity vs. kind and priority; unifying them is a refactor without a user-visible gain); `Toast` and `KbdLegend` (no flow needed them; inline notices and the existing shortcut help cover it); reader/editor tablet drawers (no overflow or usability problem was measured at 820–1024 px).

Incremental plan for `M7_DESIGN_PROPOSAL.md`. Each step ships on its own, keeps every feature working and is verified with `npm run typecheck && npm test && npm run build` plus Playwright at 1440, 1280, 820, 390 and 375 px in light and dark themes.

## Guardrails for every step

- **No data changes.** IndexedDB schema, records, localStorage keys and backup format stay as they are (v6, backup schema 1).
- **Routes are a contract.** All detail routes stay; evidence links (`sourcePath`) and recommendation actions in the learning engine point at them. Changed hub/progress URLs get redirects.
- **No new dependencies** unless a step justifies one explicitly (the creation sheet and popovers can be built on the existing `<dialog>`-based `Dialog`).
- **Behaviour parity:** autosave, router blockers for unsaved recordings and drafts, keyboard shortcuts, AI calls only on explicit actions.
- **Accessibility:** labelled controls, visible focus, focus trapped and restored in sheets, `prefers-reduced-motion`.

## Step 0 — Baseline and truth fixes

| | |
| --- | --- |
| Scope | Scripted Playwright baseline (screenshots + DOM metrics per route and width, as in the audit). Fix the Overview's false "Nothing recorded yet" and stale "Start with listening" copy (temporary honest content until Today ships). Map "Developing" to a neutral/caution style; make error vs suggestion badges distinct. |
| Depends on | — |
| Risk | Low. Copy and badge styles only. |
| Acceptance | With seeded data the Overview never claims there is no practice. No neutral level uses the destructive colour. Error and suggestion badges differ in colour **and** shape/label in both themes. All tests pass. |

## Step 1 — Design foundations

| | |
| --- | --- |
| Scope | Tokens (`--caution`, level scale, selected-tile state, numeral rule). Components: `PageHeader` (breadcrumb, actions, overflow), `Tabs`, `Segmented`, `FilterBar`, `EmptyState`, `HelpDisclosure` (remembers collapse in localStorage, per-viewer convenience), `PrivacyNote`, `CreationSheet`, `Toast`, `KbdLegend`. Document them in `DESIGN_SYSTEM.md`. |
| Depends on | Step 0 |
| Risk | Medium: new focus-management code (sheets). Mitigation: unit tests for open/close/escape/focus return; adopt in one page first. |
| Acceptance | Each component has keyboard support and visible focus, works in both themes, and is used by at least one page. No visual change elsewhere. |

## Step 2 — Navigation shell and Settings & data

| | |
| --- | --- |
| Scope | New groups (Today, Practise: Listening · Reading · Speaking · Writing, Language: Grammar · Vocabulary, Progress) with the due count on Vocabulary; Settings & data in the footer; tablet rail (768–1279 px). New `/settings` with Appearance, Learning preferences, Data & backups (moved component, unchanged behaviour), Privacy & AI, About. Redirect `/progress?section=data` → `/settings/data`. Breadcrumb/back pattern on all pages via `PageHeader`. |
| Depends on | Step 1 |
| Risk | Medium: the backup UI moves (its tests are service-level and stay valid); preferences now edited in two places until modules drop their local controls — keep a single source of truth (same localStorage keys). |
| Acceptance | Every module reachable in one click at every width; Settings reachable from the sidebar and mobile menu; export/import/replace still pass the M6 browser checks; old Progress data URL redirects; the theme switcher works from Settings and the sidebar. |

## Step 3 — Today

| | |
| --- | --- |
| Scope | Replace the Overview with Today: next steps (top recommendations + due reviews + drafts/unchecked sets), Continue, This week, quiet module row, first-run state with "Restore a backup". Uses the existing learning engine and repositories; no new computations beyond "in progress" lookups. |
| Depends on | Steps 1–2 |
| Risk | Medium: performance of loading all stores on the home page — reuse the one-transaction snapshot loader; show a skeleton. |
| Acceptance | With seeded data, Today lists real items that link to the right pages; with no data, a clear first-run state; no metric appears without its definition; nothing gamified. |

## Step 4 — Speaking hub (pilot of the hub anatomy)

| | |
| --- | --- |
| Scope | Two views (Topics, History), Continue strip, one-row FilterBar with search and Source, compact topic list + preview panel (desktop) / direct navigation (phone), "New topic" creation sheet (Generate / Write your own) reusing the existing generator and topic editor, help disclosure. Practice page: single title, Task → Set up → Record order. |
| Depends on | Steps 1–2 |
| Risk | High for regressions: the topic generator's preview/regenerate/edit flow and the practice page's recording guards. Mitigation: move components without rewriting their logic; keep routes `/speaking/practice/:source/:id` and `/speaking/attempts/:id`. |
| Acceptance | Desktop `/speaking` ≤ ~1,100 px and phone ≤ ~1,800 px with the full library; "New topic" and the latest attempt visible on the first screen at 375 px; ≤ 8 tab stops from the skip link to the first topic; every curated prompt readable in full before practising; all existing speaking tests pass; record → transcribe → feedback still works in the browser with the stub. |

## Step 5 — Remaining hubs and Progress

| | |
| --- | --- |
| Scope | Apply the hub anatomy to Writing (Tasks / Submitted), Grammar, Reading, Vocabulary (Review primary, Practise via sheet), Listening (New session sheet). Progress → Overview, Skills, Mistakes; recommendations list page; "Practise this" opens the module creation sheet pre-filled with the weakness and bounded examples (same `targetedPractice` payload); redirects for old `?section=` URLs. |
| Depends on | Step 4 (pattern proven) |
| Risk | High: many flows touched. Mitigation: one hub per PR-sized change, each with its own browser check; keep generation hooks and storage untouched; the bounded training profile keeps its tests. |
| Acceptance | All hubs share the same header, view switcher, filter bar, empty state and creation sheet; no permanently open generation form remains; returning learners see saved work before any form at 375 px; targeted practice still sends ≤ 5 examples and saves into the right module; recommendation actions and evidence links still resolve. |

## Step 6 — Result and work pages

| | |
| --- | --- |
| Scope | Writing feedback (text + inline corrections first, one linked corrections list, FeedbackSummary), speaking attempt (transcript first, shared CorrectionCard), listening session (shared Segmented, shortcuts popover), reader and editor (breadcrumb, drawers on tablet). |
| Depends on | Step 1; independent of Steps 4–5 |
| Risk | Medium: annotation/selection code in writing feedback and transcript review. Keep the domain logic; change layout only. |
| Acceptance | At 375 px the learner's text/transcript is reached within one screen; corrections appear once; selecting a correction highlights its passage and vice versa; error vs suggestion distinguishable without colour. |

## Step 7 — Polish and audit

| | |
| --- | --- |
| Scope | Copy consistency (module names without "Lab", one verb per action type: "New …" to create, "Practise" to start), truncation fixes, numerals, empty/loading/error states on every page, dark-theme pass, keyboard and screen-reader walkthrough, documentation updates (ARCHITECTURE, DESIGN_SYSTEM, PRODUCT_SPEC, README). |
| Depends on | Steps 2–6 |
| Risk | Low |
| Acceptance | Re-run the audit script: every Critical and High finding in `M7_UX_AUDIT.md` closed or explicitly deferred with a reason; no horizontal overflow; AA contrast in both themes. |

## Dependency graph

```
0 ──► 1 ──► 2 ──► 3
            │
            ├──► 4 ──► 5
            │
            └──► 6 (can run in parallel with 4–5 once 1 is done)
                         └──► 7 (after 2–6)
```

## Regression risks to watch

| Risk | Where | Mitigation |
| --- | --- | --- |
| Broken deep links | Progress evidence, recommendations, training log, Today | Keep detail routes; redirect changed hub URLs; a test that every `sourcePath` pattern resolves to a route. |
| Lost unsaved work | Speaking recordings, writing drafts, transcript corrections moved into sheets/drawers | Keep router blockers and autosave; test navigating away mid-flow. |
| Duplicate AI calls or calls without a click | Creation sheets re-rendering | Generation stays in `useGenerationJob`, triggered only by the explicit button; check the stub request log in browser tests. |
| Keyboard shortcut conflicts | Listening session shortcuts vs new sheet/popover shortcuts | Scope shortcuts to the session page; no global shortcuts in M7. |
| Focus traps | Creation sheet, filters sheet on phones | Unit tests + Playwright keyboard walkthrough. |
| Preference drift | Settings vs in-module controls | One source of truth (existing localStorage keys); remove module-level duplicates once Settings ships. |
| Backup UI move | Data & backups → Settings | Move the component as-is; re-run the M6 export/import/replace browser checks. |
| Visual regressions in dark theme | New caution colour, selected tiles | Screenshot baseline per step in both themes. |
