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
| `destructive` | `#B42318` | `#F07066` | Errors |
| `success` | `#2F6B45` | `#7CC092` | Confirmations |

Contrast: the brand colour is ≥ 5:1 against the background in both themes.

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
- Dialogs use the native `<dialog>` element (`components/ui/dialog.tsx`): focus containment, `Esc` and backdrop dismissal come from the browser.

## Anti-patterns (do not do)

XP, streaks, badges, confetti, mascots, gradient hero banners, glassmorphism, emoji as icons, fake statistics, placeholder-only labels, colour-only status.
