# Linguas de Gato

A personal, local-first workspace for deliberate language practice. English comes first, aimed at moving from B2 to C1/C2.

- **Listening** (available): local audio and video with a keyboard-friendly player, **automatic transcription with Groq Whisper**, YouTube through the official IFrame Player API, SRT/WebVTT transcripts that follow playback, replay-line and A-B loops, line-by-line dictation with a word-level diff, and AI comprehension exercises grounded in the transcript. Sessions are saved in the browser (IndexedDB) and survive reloads.
- **Speaking** (available): B2 and C1 speaking tasks, your own topics and AI-generated B2/C1/C2 tasks, microphone recording, a transcript you review before anything is assessed, detailed AI feedback where every correction quotes your own words, fluency measurements from timestamps, and exercises built from your mistakes. Attempts are saved in the browser.
- **Writing** (available): AI-generated B2–C2 tasks in 12 formats, a distraction-free editor with autosaved drafts and live word counts, and feedback where every correction quotes your text and errors are kept apart from optional suggestions; an improved version only if you ask for it.
- **Grammar** (available): AI-generated exercises on 12 advanced areas in six question types, checked against a verified answer key, with rules, explanations of every option, retries and your result history.
- **Reading** (available): AI-generated texts for your level or your own pasted texts, in a comfortable reading view with saved progress; select any word or phrase to look it up in context, and check your understanding with questions grounded in the text.
- **Vocabulary** (available): a personal dictionary of the expressions you save, each kept with the sentence you met it in and its meaning there; a simple review schedule and practice built from your own words.
- **Progress** (available): what you have practised in each module over a chosen period, with every figure defined and its sample size shown; recurring mistakes gathered across modules with the examples behind them; recommendations you can mark done or dismiss; targeted practice generated from your own mistakes; and a full backup and restore of your data. No points, streaks or invented scores.

## Requirements

- Node.js ≥ 22.12 and npm ≥ 10
- A recent Chrome, Edge, Firefox or Safari (Speaking needs microphone access and MediaRecorder)

## Getting started

```bash
npm install
cp apps/server/.env.example apps/server/.env   # needed only for transcription and speaking feedback
npm run dev
```

Open http://127.0.0.1:5173. The API runs on http://127.0.0.1:3001, and Vite proxies `/api`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Client and server in watch mode |
| `npm run typecheck` | Strict TypeScript across all workspaces |
| `npm test` | Unit and API tests (Vitest; no API key needed) |
| `npm run build` | Production build (shared → server → client) |
| `npm start` | Serve the production build at http://127.0.0.1:3001 (restart it after each build) |

## Groq configuration

1. Create an API key at https://console.groq.com/keys.
2. Put it in `apps/server/.env`: `GROQ_API_KEY=gsk_…` (the file is git-ignored; the key never reaches the browser).
3. Restart the server. Listening then shows a **Transcribe** tab, and Speaking can transcribe and give feedback.

| Variable | Default | Notes |
| --- | --- | --- |
| `GROQ_API_KEY` | (empty) | Enables transcription, speaking and writing feedback, grammar second opinions and exercise generation. |
| `TRANSCRIPTION_MAX_UPLOAD_MB` | `25` | Groq's free-tier limit. Raise it (up to 100) only if your Groq plan accepts larger files. |
| `TRANSCRIPTION_TIMEOUT_SECONDS` | `300` | Upper bound for one transcription request (10–1800). |
| `GROQ_CHAT_MODEL` | `openai/gpt-oss-120b` | Chat model for all feedback and exercise generation. |
| `GROQ_CHAT_RESPONSE_FORMAT` | `auto` | `auto` uses strict JSON Schema for models documented to support it, JSON Object Mode otherwise; `json_schema` or `json_object` force one. |
| `GROQ_REASONING_EFFORT` | `medium` | `low`, `medium` or `high`; sent only to GPT-OSS models. |
| `ASSESSMENT_TIMEOUT_SECONDS` | `120` | Upper bound for one feedback or generation request (10–600). |
| `GROQ_API_BASE_URL` | official endpoint | https only, or http on 127.0.0.1/localhost for a local test stub. |

Transcription formats: FLAC, MP3, MP4, MPEG, MPGA, M4A, OGG, WAV, WebM. Models: **Fast** (`whisper-large-v3-turbo`) and **Higher accuracy** (`whisper-large-v3`). Language: English, or automatic detection.

## Documentation

- [Product specification](docs/PRODUCT_SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Design system](docs/DESIGN_SYSTEM.md)
- [Roadmap](docs/ROADMAP.md)

## Privacy

There are no accounts, no server database and no analytics. Practice data stays in your browser. API keys live only in `apps/server/.env`, which is git-ignored.

- When you click **Transcribe**, the recording is sent through the local server to Groq. The server keeps it only in a temporary file that is deleted when the request ends.
- When you ask for **speaking feedback**, your confirmed transcript (not the audio) is sent to Groq. It is not logged by this app.
- When you press **Generate** (a speaking or writing task, listening or grammar exercises), your settings and optional topic text, or the session's transcript text, are sent to Groq. Nothing is generated without that click.
- Writing drafts stay in your browser. Submitting for feedback, asking for an improved version, or asking for a grammar second opinion sends that text to Groq.
- Pasted reading texts stay in your browser. Generating questions sends the text; looking up a word sends the selection, its sentence and paragraph; vocabulary practice sends the chosen expressions and their context sentences.
- Speaking recordings stay in memory unless you tick "Keep this recording"; you can delete a saved recording or a whole attempt at any time.
- Progress is computed in your browser. **Generate targeted practice** sends only the chosen area's name and description and, if you leave the box ticked, up to five of your own mistakes with their corrections; never your full history.
- Backups are files you download. They are never uploaded, contain no API keys, and imports are fully validated before anything changes.
- Groq's handling and retention of what you send are governed by your Groq account settings and Groq's policies, which this app does not control.
