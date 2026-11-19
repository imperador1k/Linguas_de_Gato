# Roadmap — Linguas de Gato

Milestones are ordered by learning value and technical dependency. Each one ends with type checks, tests, a build and a browser verification.

## M0 — Foundation ✅

- npm workspace: `apps/client`, `apps/server`, `packages/shared`.
- Strict TypeScript, Vitest, dev, build and start scripts.
- Design system: tokens, typography, light and dark themes, UI primitives.
- Application shell: responsive navigation, overview dashboard, "Planned" module pages.
- Fastify API: health, capabilities, central error handling, env validation, security headers.
- Listening workspace (foundation):
  - YouTube URL input with validation and an official embedded player.
  - Local audio/video drag-and-drop with validation.
  - Custom media player with keyboard shortcuts and playback speed.
  - SRT/WebVTT import with a synchronised, click-to-seek transcript.
  - Transcription card driven by server capabilities (disabled until M2).

## M1 — Listening practice ✅

- Replay the current line (`R`), loop a line, and A-B loops with tenth-of-a-second points (`A`, `B`, `Esc`).
- Dictation mode: pick a line, the reference stays hidden, type what you hear, then see accuracy, WER and a word-level diff (substitutions, near-miss spellings, missed and extra words). Retry any line; the last 20 attempts per line are kept.
- Text comparison engine in `shared` (normalisation, Levenshtein word alignment, WER), with unit tests.
- YouTube through the official IFrame Player API: the transcript follows playback, lines seek the video, and unavailable or non-embeddable videos are handled.
- IndexedDB persistence (versioned, native API): sessions, transcripts, loop, playback position and speed, dictation progress. Session URLs (`/listening/session/:id`) restore on reload. Media is not copied unless the learner opts in.
- Session list with deletion, storage usage, and an in-memory fallback when IndexedDB is unavailable.

## M2 — Groq integration (transcription)

- `modules/ai` Groq provider: Whisper transcription.
- `POST /api/transcriptions`: multipart upload, size and type limits, temp-file cleanup, rate limit.
- Sentence segmentation of the Whisper output (pure function in `shared`, tested).
- "Transcribe with Whisper" action in Listening.

## M3 — Speaking

- Microphone recording (MediaRecorder), level meter, playback.
- Transcription through M2 and AI feedback on grammar, naturalness and fluency.
- Record recurring mistakes.

## M4 — Writing

- Prompts by register and genre (essay, email, report).
- Correction with explanations, naturalness and collocation suggestions.
- Side-by-side diff view.

## M5 — Grammar and Vocabulary

- B2–C1 grammar exercise engine: content format in `shared`, deterministic evaluation.
- Contextual vocabulary capture from Listening and Reading, collocation sets, spaced review.

## M6 — Reading

- Text import, reading view with typographic controls, comprehension questions, inline vocabulary capture.

## M7 — Progress, export and import

- Session history, time per skill, recurring-mistake insights (no gamification).
- Versioned JSON export and import of all local data.

## Later

- Additional target languages (content packs keyed by `LanguageCode`).
- Interface localisation (message catalogs).
- An offline-capable PWA.
