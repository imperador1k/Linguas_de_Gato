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

## M2 — Automatic transcription (Groq Whisper) ✅

- Groq transcription provider behind `modules/ai`: `whisper-large-v3-turbo` ("Fast", the default) or `whisper-large-v3` ("Higher accuracy"); `verbose_json`, segment and word timestamps, temperature 0; English or automatic language detection. Provider responses are validated and normalised with Zod.
- `POST /api/transcriptions`: streamed multipart upload to a private temp directory; extension, MIME, size and magic-byte checks; a configurable limit (25 MB default, up to 100 MB); timeout; at most two concurrent jobs; cleanup on every path, including cancellation; stale-upload sweep at startup.
- Request guards against CSRF and DNS rebinding on state-changing API calls.
- Sentence-sized dictation cues built from word timestamps (pure function in `shared`, tested).
- Listening: a "Transcribe" source tab (drag and drop, file metadata, language and model choice, privacy notice, real upload progress, cancellable processing) that creates a persistent session and offers "Start dictation". Existing file sessions can transcribe from their sidebar.

### Later: long recordings

Files above the upload limit are rejected with a clear message. Automatic splitting of long audio (chunking with overlap, then stitching the timestamps) is deferred, because it needs audio decoding (FFmpeg or WebCodecs) that this milestone intentionally avoids.

## M3 — Speaking Lab ✅

- Curated prompt library (14 tasks, B2 and C1 in seven categories), custom topics, free and guided modes, suggested durations of 30/60/120/180 s.
- Microphone recording with MediaRecorder: explicit permission on "Start recording", MIME negotiation, pause/resume/finish/cancel, live level meter, 180 s maximum, playback, clear permission-denied and unsupported-browser states, guarded navigation, resource cleanup.
- Transcription through the M2 pipeline (unchanged), then a transcript review where the learner corrects recognition errors per segment, with play-from-timestamp.
- Speaking feedback via Groq Chat Completions (`openai/gpt-oss-120b` by default, strict Structured Outputs): grammar, vocabulary, coherence, naturalness and task achievement with qualitative levels; every correction quotes the transcript and is verified on the server; deterministic fluency measurements (rate, pauses, repetitions, possible fillers) kept separate.
- Follow-up exercises built from the learner's own sentences, with saved answers.
- Attempts saved in IndexedDB (schema v2, M1/M2 data preserved); recordings opt-in and deletable.

### AI exercise generation ✅ (with M3)

- Shared generation service (`POST /api/exercises/generate`, one generator per module, strict schemas, evidence verification where facts are involved), using the configured chat model.
- Speaking: generate B2/C1/C2 tasks (free, guided, debate, critical thinking) with discussion points, follow-ups, useful language and objectives; preview, regenerate, edit, save. No model answers.
- Listening: comprehension questions (main idea, detail, inference, speaker intention, vocabulary in context; multiple choice and short answer) grounded in the saved transcript; answer first, then results with explanations and the evidence passage.
- Database v3 (`listeningExercises`). Writing, Grammar, Reading and Vocabulary will add their own generators when those modules are built.

### Later: speaking

- Pronunciation and prosody feedback needs dedicated audio analysis (phoneme alignment), not a transcript; deferred.
- A view of recurring mistakes across attempts belongs with Progress (M7).

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
