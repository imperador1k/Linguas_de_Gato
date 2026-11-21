# Design System — Linguas de Gato

Direction: **editorial minimalism**. The interface should feel like a well-set book or a quiet study, not a SaaS dashboard. Swiss-style grid and restraint, a warm paper palette, and a serif reserved for content and display. The source of truth is `apps/client/src/styles/globals.css`.

The base style (Minimalism and Swiss Style) came from the UI/UX Pro Max design-system search. Its typography match (a children's pairing) and its indigo palette were rejected because they did not fit an advanced adult learner, and replaced with the editorial choices below.

## Typography

| Role | Typeface | Usage |
| --- | --- | --- |
| Display / content | **Newsreader** (variable, optical sizes) | Page titles, section headings, transcript and reading text |
| Interface | **Inter** (variable) | Navigation, labels, buttons, body UI text |
| Data | **JetBrains Mono** (variable) | Timestamps, durations, keyboard shortcuts |

Fonts are self-hosted through `@fontsource-variable/*`, with no requests to third-party font services.

Scale: 12 (labels, uppercase tracking) · 14 (secondary UI) · 16 (base) · 18 (lede) · 24 (section) · 32–44 (page title, Newsreader). Body line height is 1.5–1.6, transcript text 1.65.

## Colour

Warm neutrals with a single accent, terracotta. The accent marks focus, the active state and the current cue, and is never decorative.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `background` | `#F7F5F0` | `#141311` | App canvas (paper) |
| `card` | `#FDFCF9` | `#1C1B18` | Raised surfaces |
| `foreground` | `#1D1C1A` | `#ECE8DF` | Primary text (ink) |
| `muted-foreground` | `#67635B` | `#A29D93` | Secondary text (≥ 4.5:1 on background) |
| `border` | `#E3DED3` | `#2E2C28` | Hairlines |
| `primary` | `#1D1C1A` | `#ECE8DF` | Primary buttons (ink) |
| `brand` | `#A8462A` | `#E07A5A` | Accent: focus ring, active nav, current cue |
| `destructive` | `#B42318` | `#F07066` | Actual errors and destructive actions only |
| `success` | `#2F6B45` | `#7CC092` | Strong performance, correct answers, confirmations |
| `caution` | `#8A5300` | `#E2B45F` | Work in progress: "Developing", "Needs attention", "Partly right", a recurring pattern, a word count outside the range |

Contrast: the brand colour is ≥ 5:1 against the background in both themes. `caution` is ≥ 5.3:1 on card, background and its subtle tint in light, ≥ 7.5:1 in dark.

### Semantic status (M7.1)

| Meaning | Treatment | Component |
| --- | --- | --- |
| Error (a mistake in the learner's work) | `destructive`, alert icon, label "Error"; solid red underline in text | `CorrectionKindBadge kind="error"` |
| Suggestion (optional improvement) | Neutral outline badge, lightbulb icon, label "Suggestion"; dotted neutral underline in text | `CorrectionKindBadge kind="suggestion"` |
| Developing / needs attention | `caution`, dot or alert icon, the level's name | `LevelLabel` |
| Strong | `success`, check icon | `LevelLabel` |

Terracotta never signals status: it is identity, focus, the active navigation item, the current line, selection and the record action.

## Space, shape, elevation

- Spacing follows Tailwind's 4 px grid. Page gutters are 16 px on mobile, 32 px on tablet and 48 px on desktop. The content measure is ≤ 72ch for reading.
- Radius: 10 px on cards, 8 px on controls, full on icon buttons.
- Elevation: hairline borders first. Shadows are used only for overlays.

## Motion

- 150–200 ms colour and opacity transitions only. No decorative animation.
- `prefers-reduced-motion: reduce` disables smooth scrolling and transitions.

## Interaction and accessibility rules

- A visible 2 px brand-coloured focus ring on every interactive element (`:focus-visible`).
- Hit areas of at least 40 px (44 px on touch layouts).
- Icon-only buttons always have an `aria-label`. Decorative icons use `aria-hidden`.
- Errors appear next to their field, are linked with `aria-describedby` and announced with `role="alert"`.
- Status is never conveyed by colour alone; it always carries a text label.
- Media player shortcuts: `Space`/`K` play and pause, `J`/`←` back 5 s, `L`/`→` forward 5 s, `,`/`.` slower or faster, `M` mute, `R` replay the current line, `A`/`B` set loop points, `Esc` clear the loop. In the dictation box: `Ctrl+Enter` checks, `Ctrl+Space` replays the line.
- Dictation feedback never relies on colour: wrong and extra words are struck through, corrections are underlined (dotted for close spellings), and missed words have a dashed outline, with screen-reader text for each.
- Scrollbars are styled globally in `styles/globals.css`: a 6 px rounded thumb (`--border-strong`, darker on hover/drag) floating on a transparent track, no arrow buttons; Firefox gets the thin standard equivalent. Don't restyle them per component.
- Dialogs use the native `<dialog>` element (`components/ui/dialog.tsx`): focus containment, `Esc` and backdrop dismissal come from the browser.

## Shared patterns (M7.1)

| Pattern | Component | Rule |
| --- | --- | --- |
| Page header | `PageHeader` (`components/layout/page-header.tsx`) | Eyebrow, serif title, one-line description, actions on the right. Detail pages pass `back` instead of putting a back button in the actions. |
| Back navigation | `BackLink` via `PageHeader back={{ to, label }}` | A quiet text link above the eyebrow, labelled with the parent's navigation name ("← Speaking"); screen readers hear "Back to Speaking". |
| Section heading | `SectionHeading` | Small uppercase label introducing a group of content. |
| Tabs | `TabList` + `tabPanelProps` (`components/ui/tabs.tsx`) | One underline style for switching views of the same content; arrow keys, Home and End; only the selected tab is in the tab order. Choices that change a setting use `ChoiceGroup` tiles instead. Section navigation that changes the URL (Progress, Settings) uses links with the same underline look. |
| Status | `LevelLabel`, `CorrectionKindBadge` (`components/ui/status.tsx`), `Badge variant="caution"` | See *Semantic status*. |
| Empty state | `EmptyState` | What is missing in one sentence, at most one action, never a claim the data doesn't support. |
| Help | `HelpDisclosure` | "How it works" explanations are a native `<details>`, open until the learner closes them once (remembered per device under `ldg.help.*`). |
| Privacy line | `PrivacyNote` | One sentence where data is about to be sent, plus a link to Settings → Privacy & AI, which holds the full explanation. |
| Confirmations | `ConfirmDialog` | Destructive or irreversible actions only. |
| Creation side panel (M7.2) | `SidePanel` (`components/ui/side-panel.tsx`) | Where something new is made without leaving the page: native `<dialog>` on the right (full screen on phones), title and description, source choice as tabs inside, the module's own form and preview. With `dirty`, Escape, the close button and the backdrop first ask "Discard your changes?". Focus returns to the opener. |
| View switch with URL (M7.2) | `TabList` + `?view=` | Hub views (Speaking: Topics / History) live in the URL so they survive going back from a detail page. |
| Master/detail list (M7.2) | Speaking `TopicsView` | Desktop: list scrolls beside a sticky preview that always shows the selected item in full. Below 1024 px: the preview opens in place under its row (`aria-expanded`). |
| Continue card (M7.3) | `ContinueCard` (`components/ui/continue-card.tsx`) | One per hub, above the library, only when a real unfinished item exists (a draft, a partly answered set, a text being read, a dictation not finished). One primary "Continue …" link, optionally one quiet secondary. |
| Search and filters (M7.3) | `SearchField`, `FILTER_CONTROL`, `resultCount`, `SEARCH_THRESHOLD` (`components/ui/search-field.tsx`) | A labelled search box (visually hidden label, placeholder is never the label) plus native selects in one row; on phones search takes the full row and two selects share the next. Shown only once a list has 4+ items. Below them, a live count ("3 of 8 sets") and "Clear filters" when anything is filtered. |
| Hub library row (M7.3) | Per hub | Title link with an arrow, one meta line (level badge · type · numbers · date · status badge), entry points as small buttons where a record has several (Listening: Dictation / Questions), delete as an icon button with an `aria-label` naming the item, behind a `ConfirmDialog`. |
| Targeted practice (M7.3) | `TargetedPracticeNotice` + `useTargetedPractice` (`features/personalized-training/targeted-practice.tsx`) | "Practise this" opens a module's own creation panel with `?practise=<category>`. The panel starts with what is being practised, the include-examples choice and "Exactly what will be sent", then the module's normal form pre-filled from the training option. |
| Inline correction marks (M7.3) | `HighlightedText` (speaking), `AnnotatedText` (writing) | The learner's own words are shown first with corrections marked in place (red underline = important/error, amber or dotted = minor/suggestion) and a numbered or selectable link to the single explanation below. A correction's text is never repeated in a second list. |
| Keep media option (M8) | `KeepMediaOption` + `useKeepChoice` (`components/ui/keep-media-option.tsx`) | A checkbox where the media is chosen or recorded (creation panel, reconnect card, Speaking listen-back/review), defaulted by `planMediaRetention`. The hint says what it costs, or what happens without it, or why it's impossible ("Storage limit reached: about X free, Y needed"). |
| Media state (M8) | `MediaStateBadge`, `RecordingStateBadge` (`components/ui/media-state-badge.tsx`) | One vocabulary everywhere: *Audio saved*, *Audio not saved*, *Needs the file*, *Recording saved*, *Recording not saved*, *No recording*. Text + icon. Today shows only the problem states. |
| Media copy bar (M8) | `MediaCopyBar` (Listening session) | Directly under the player: saved (with *Remove copy*, confirmed) or not saved (with *Keep a copy*). Never says saved unless the stored copy exists. |
| Update banner (M7.3) | `UpdateBanner` (`components/layout/update-banner.tsx`) | "A new version is available. Reload to update." as a `role="status"` strip at the top of the page. Never reloads by itself; Reload is disabled while `useHasWorkInProgress()` is true (AI request, transcription, unsaved recording). |

### Hub anatomy (M7.3)

Every learning hub (Listening, Reading, Speaking, Writing, Grammar, Vocabulary) follows the same order:

1. `PageHeader` with **one** primary action: *New session*, *New text*, *New topic*, *New task*, *New exercise set*. Vocabulary is the exception: reviewing is its daily task, so the always-visible **Review queue** card carries the primary *Review N due* action and *Practise* is secondary.
2. The **Continue** card, when something is unfinished.
3. **Views** as `TabList` with `?view=` where the module has two kinds of record (Speaking: Topics / History; Writing: Tasks / Submitted; Vocabulary: Collection / Practice sets).
4. Search and filters (lists of 4+), then the library list, or an `EmptyState` whose single action opens the creation panel.
5. `HelpDisclosure` at the bottom.
6. Creation happens in the shared `SidePanel`: source → settings → preview → generate or save. AI is called only on *Generate*; generated tasks and topics can be regenerated and edited before *Save*; a running request or an unsaved preview makes the panel ask before discarding, and a running request blocks closing until it is cancelled.

### Feedback pages (M7.3)

Order: the learner's work (recording and transcript, or the submitted text) → inline marks → *Focus on first* / *Work on next* priorities → task achievement → the one corrections list (errors and suggestions labelled differently) → per-dimension notes folded in a `<details>` → targeted exercises. No numeric scores beyond what the record supports; levels are labelled as practice guidance.

### Copy (M7.3)

| Verb | Use |
| --- | --- |
| New … | Open a creation panel (header actions, empty states). |
| Generate / Regenerate | Send settings to the AI to make something. Never automatic. |
| Save task / Save topic, Save and start writing / Save and practise | Store a previewed item; the second form also opens it. Exercise sets save themselves on Generate (there is nothing to edit before answering) and open at once. |
| Submit | Hand in writing for feedback. |
| Get feedback / Assess again | Ask the AI to assess saved work. |
| Practise / Practise this / Practise these | Start practice (vocabulary practice, a targeted weakness, a selection). |
| Review / Review N due | Spaced vocabulary review. |
| Continue … | Resume unfinished work. |
| Try again | Retry after a failure, or a new round of the same exercise. |
| Cancel / Discard | Stop a running request; drop unsaved work (always confirmed). |

## Navigation (M7.1)

- Groups: **Today**; **Practise** (Listening, Reading, Speaking, Writing); **Language** (Grammar, Vocabulary); **Your progress** (Overview, Skills, Mistakes); **Settings & data** pinned at the bottom with the quick theme switch.
- ≥ 1024 px: full sidebar. 768–1023 px: icon rail with accessible names and tooltips on hover and keyboard focus. < 768 px: top bar and a `<dialog>` drawer (focus contained, `Esc` closes, focus returns to the menu button).
- The active item has the accent bar; Progress's Recommendations and Targeted practice pages keep "Overview" highlighted.

## Anti-patterns (do not do)

XP, streaks, badges, confetti, mascots, gradient hero banners, glassmorphism, emoji as icons, fake statistics, placeholder-only labels, colour-only status, red for anything that is not an error, long privacy paragraphs repeated on every page.
