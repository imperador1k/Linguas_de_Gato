# Linguas de Gato

A personal, local-first workspace for deliberate language practice. English comes first, aimed at moving from B2 to C1/C2.

- **Listening** (available): local audio and video with a keyboard-friendly player, **automatic transcription with Groq Whisper**, YouTube through the official IFrame Player API, SRT/WebVTT transcripts that follow playback, replay-line and A-B loops, line-by-line dictation with a word-level diff, and AI comprehension exercises grounded in the transcript. Sessions are saved in the browser (IndexedDB) and survive reloads.
- **Speaking** (available): B2 and C1 speaking tasks, your own topics and AI-generated B2/C1/C2 tasks, microphone recording, a transcript you review before anything is assessed, detailed AI feedback where every correction quotes your own words, fluency measurements from timestamps, and exercises built from your mistakes. Attempts are saved in the browser.
- **Writing, Grammar, Reading, Vocabulary, Progress**: planned (see [docs/ROADMAP.md](docs/ROADMAP.md)).

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
| `GROQ_API_KEY` | (empty) | Enables transcription, speaking feedback and exercise generation. |
| `TRANSCRIPTION_MAX_UPLOAD_MB` | `25` | Groq's free-tier limit. Raise it (up to 100) only if your Groq plan accepts larger files. |
| `TRANSCRIPTION_TIMEOUT_SECONDS` | `300` | Upper bound for one transcription request (10–1800). |
| `GROQ_CHAT_MODEL` | `openai/gpt-oss-120b` | Chat model for speaking feedback and exercise generation. |
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
- When you press **Generate** (a speaking task or listening exercises), your settings and optional topic text, or the session's transcript text, are sent to Groq. Nothing is generated without that click.
- Speaking recordings stay in memory unless you tick "Keep this recording"; you can delete a saved recording or a whole attempt at any time.
- Groq's handling and retention of what you send are governed by your Groq account settings and Groq's policies, which this app does not control.
