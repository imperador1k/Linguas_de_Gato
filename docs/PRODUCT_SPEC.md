# Product Specification — Linguas de Gato

## 1. Vision

Linguas de Gato is a personal, extensible language-learning workspace. It supports deliberate practice for an advanced learner rather than casual, gamified study. English is the first target language; the domain model keeps the target language explicit so other languages can be added later without a rewrite.

## 2. Learner profile

| Attribute | Value |
| --- | --- |
| Current level | B2 (CEFR) English |
| Goal | C1, then C2 |
| Motivation | Self-directed, deliberate practice |
| Usage | Desktop first (focused sessions), usable on tablet and phone |

What a B2 → C1 learner needs, and what the product therefore optimises for:

- **Authentic input at natural speed**, with tools to slow down, loop and inspect it (Listening, Reading).
- **Precise feedback on output**: not only "correct / incorrect" but *natural vs. unnatural*, register and collocation (Writing, Speaking).
- **Targeted grammar** at the B2–C1 boundary: inversion, cleft sentences, mixed conditionals, hedging, nominalisation, advanced modality.
- **Memory of recurring mistakes**, so practice is driven by evidence (Progress).

## 3. Non-goals and constraints

1. No authentication or user accounts. It is a single-user, local-first application.
2. No server-side database. Learner data lives in the browser (IndexedDB when needed).
3. No subscriptions or payments.
4. No microservices or container infrastructure.
5. No gamification: no XP, streaks, badges, confetti or leaderboards.
6. No unofficial YouTube stream extraction, downloading or scraping (see §6).

## 4. Modules

Each module has a status: **Available** (implemented), **In progress**, or **Planned**.

| Module | Purpose | Key capabilities | Status |
| --- | --- | --- | --- |
| Listening | Comprehension of authentic audio/video | Media import, custom audio controls, automatic transcription (Groq Whisper), subtitle import, synchronised transcript (files and YouTube), replay line, A-B loop, dictation with word-level feedback, saved sessions; comprehension questions planned | Available |
| Speaking | Fluency and pronunciation | Microphone recording, Whisper transcription, AI feedback on grammar, naturalness and fluency | Planned |
| Writing | Accuracy and naturalness in long-form output | Essay prompts, correction with explanations, naturalness and register analysis | Planned |
| Grammar | Targeted B2–C1 structures | Interactive exercises (transformation, gap-fill, error spotting) | Planned |
| Reading | Comprehension of authentic texts | Text import, comprehension questions, inline vocabulary capture | Planned |
| Vocabulary | Contextual lexis and collocations | Words captured in context, collocation sets, spaced review | Planned |
| Progress | Evidence-based self-assessment | Session history, time per skill, recurring mistakes | Planned |

## 5. Media Importer

The Media Importer is shared infrastructure, used first by Listening and later by Speaking and Reading.

### 5.1 Supported sources

| Source | Formats | Handling |
| --- | --- | --- |
| Local file | Playback: MP3, WAV, M4A, MP4, WebM, FLAC, OGG, MPGA. Transcription also accepts MPEG (which browsers usually can't play). | Played in the browser through an object URL. **Never uploaded** unless the learner explicitly clicks "Transcribe". |
| YouTube | Public video URL | Played through the official embedded player (`youtube-nocookie.com`). Only the video ID is stored. |
| Subtitles | SRT, WebVTT | Parsed in the browser into timestamped cues. |

### 5.2 Automatic transcription (user-initiated)

- An explicit "Transcribe" action sends a **user-owned or user-authorised local file** through the local server to Groq Whisper. It is available from the Listening page (which creates a new session) and from an existing file session.
- Options: language **English** (default) or **Detect automatically**; model **Fast** (`whisper-large-v3-turbo`, default) or **Higher accuracy** (`whisper-large-v3`).
- The server streams the upload to a temporary file that is deleted when the request ends, including on errors and cancellation. Nothing is stored on the server.
- **Privacy:** the UI states, next to the button, that the recording is sent to Groq, that this app keeps only a temporary copy, and that Groq's own retention is governed by the learner's Groq account settings and policies. The app makes no claim about Groq-side retention.
- The result is a timestamped transcript, re-cut into sentence-sized lines using word timestamps, and saved with its word and segment timings in a new persistent session, ready for read-along or dictation.
- YouTube media is never transcribed, because the application does not access YouTube media streams. A YouTube video can be paired with subtitles the learner is entitled to use.

### 5.3 Validation rules

- Files are accepted by extension and, when the browser reports one, a consistent MIME type. For transcription, the server also checks the file's content signature (magic bytes).
- Local playback size limit: 2 GB, to guard against accidental drops of unrelated files.
- Upload limit for transcription: reported by the server (`/api/capabilities`); 25 MB by default (Groq's free tier), configurable up to 100 MB with `TRANSCRIPTION_MAX_UPLOAD_MB` when the Groq plan allows it. Longer recordings must be shortened or compressed; automatic splitting is planned.
- Subtitle files: up to 5 MB.
- YouTube input accepts standard watch, short-link, embed, live and Shorts URLs, or a bare 11-character video ID.

## 6. Legal and ethical constraints

- YouTube content is only *played* through the official IFrame player, in line with the YouTube Terms of Service.
- No yt-dlp, no stream URL extraction, no scraping.
- Learners may only import and process media they own or are authorised to process. The UI states this at the import point.

## 7. Data and privacy

| Data | Location | Retention |
| --- | --- | --- |
| Preferences (theme) | `localStorage` | Until cleared |
| Imported media | Browser memory (object URL); optional opt-in copy in IndexedDB (≤ 500 MB per file) | Page lifetime, or until the copy or session is deleted |
| Listening sessions, subtitles and transcripts | IndexedDB (`linguas-de-gato` database) | Until deleted by the learner |
| Dictation attempts (last 20 per line) | IndexedDB | Until the session or its transcript is deleted or replaced |
| Recurring mistakes | IndexedDB (later milestone) | Until deleted by the learner |
| Generated transcripts (cues, word and segment timings, model and language used) | IndexedDB | Until deleted by the learner |
| Audio sent for transcription | Server temp file (deleted in `finally`; swept at startup after a crash), then Groq | This app: duration of the request only. Groq: per the learner's Groq account settings and Groq's policies |
| Transcription preferences (language, model) | `localStorage` | Until cleared |
| API keys | Server environment only | Never sent to the browser |

Data export and import (JSON) is planned for a later milestone (see ROADMAP.md).

## 8. Experience principles

1. **Calm and focused.** An editorial, typographic interface. Content comes first and chrome stays quiet.
2. **Honest.** Features that do not exist yet are labelled "Planned", never mocked with fake data.
3. **Keyboard-first audio.** Every playback control is reachable and has a shortcut.
4. **Accessible by default.** WCAG 2.2 AA contrast, visible focus, labelled controls, respect for `prefers-reduced-motion`.
5. **Responsive.** Works at 375 px and up, with no horizontal scrolling.

## 9. Assumptions

- A single learner uses the application on their own machine. The server binds to `127.0.0.1` by default.
- The interface language is English. Interface localisation is out of scope for the first milestones, but the *target language* is modelled explicitly from day one.
- A Groq API key is supplied by the learner through the server `.env` file.
