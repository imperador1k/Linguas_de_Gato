# Roadmap — Linguas de Gato

Milestones are ordered by learning value and technical dependency. Each one ends with type checks, tests, a build and a browser verification.

## M0 — Foundation ✅ (this milestone)

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

## M1 — Listening practice

- A-B loop and "replay current sentence".
- Dictation mode: hide the cue text, type what you hear, see a word-level diff.
- YouTube IFrame Player API so subtitles can be synchronised with YouTube playback.
- Persist imported transcripts and sessions in IndexedDB.

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
