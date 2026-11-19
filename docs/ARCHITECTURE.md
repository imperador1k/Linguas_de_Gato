# Architecture — Linguas de Gato

## 1. Overview

```
┌──────────────────────────── Browser ────────────────────────────┐
│  apps/client  (React 19 + Vite + Tailwind v4)                   │
│   ├─ features/*        module UIs (listening, dashboard, …)     │
│   ├─ components/ui     owned shadcn-style primitives            │
│   ├─ lib/api-client    typed fetch wrapper, error envelope      │
│   └─ local data        IndexedDB (sessions), localStorage (theme)│
│                │ /api/* (same origin; Vite proxy in dev)         │
└────────────────┼────────────────────────────────────────────────┘
                 ▼
┌──────────────── apps/server  (Fastify 5, Node 22) ──────────────┐
│   routes/health, routes/capabilities, routes/transcriptions     │
│   (later feedback) → modules/ai (provider abstraction → Groq)   │
│   modules/transcription (streamed upload → temp dir, cleanup)   │
│   plugins/error-handler, plugins/request-guards (CSRF, rebind)  │
│   config/env (Zod-validated environment, secrets live here)     │
└────────────────┬────────────────────────────────────────────────┘
                 ▼
            Groq API (Whisper, LLM)   — server-to-server only

packages/shared — API contracts (Zod schemas + types) and pure domain
logic (languages, media validation, YouTube URL parsing, subtitle
parsing, time utilities, text comparison/WER, practice time maths,
media signatures, transcript cue building, persisted-record and
transcription schemas). Imported by both apps. No runtime I/O.
```

The architecture is deliberately small: two applications and one shared library in a single npm workspace. There is no database, no auth, and no container infrastructure.

## 2. Repository layout

```
.
├─ apps/
│  ├─ client/                 Vite + React SPA
│  │  └─ src/
│  │     ├─ app/              router, module registry
│  │     ├─ components/
│  │     │  ├─ ui/            primitives (button, card, input, …)
│  │     │  └─ layout/        shell, navigation, page header
│  │     ├─ features/
│  │     │  ├─ dashboard/
│  │     │  ├─ listening/     importer, player, practice, dictation,
│  │     │  │                 storage/ (IndexedDB), youtube/, session/,
│  │     │  │                 transcription/ (upload, options, status)
│  │     │  └─ planned/       placeholder page for planned modules
│  │     ├─ hooks/            cross-feature hooks
│  │     ├─ lib/              api client, utils, theme
│  │     └─ styles/           globals.css (design tokens)
│  └─ server/                 Fastify API
│     ├─ src/
│     │  ├─ config/           env loading and validation
│     │  ├─ plugins/          error handler, request guards
│     │  ├─ routes/           HTTP routes (thin)
│     │  ├─ modules/ai/       provider interfaces, Groq transcription
│     │  ├─ modules/transcription/  upload receiving, temp-file sweep
│     │  ├─ app.ts            buildApp() (used by tests)
│     │  └─ main.ts           process entry point
│     └─ test/                route tests (fastify.inject)
├─ packages/
│  └─ shared/                 contracts + pure domain logic (tested)
├─ docs/                      product, architecture, roadmap, design
└─ CLAUDE.md                  working agreement for AI assistants
```

## 3. Key decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | npm workspaces with `apps/*` and `packages/*` | Separate client and server, shared types, one install. No Turborepo or Nx: the project is too small for them. |
| D2 | `packages/shared` holds Zod schemas for every API contract | One source of truth for validation on the server and parsing on the client. |
| D3 | Pure domain logic (subtitles, YouTube, media rules) lives in `shared` | Deterministic, framework-free, easy to unit test, reusable by future modules. |
| D4 | Owned UI primitives in the shadcn pattern (cva + `cn`) instead of the CLI and a component runtime | Full control over the design system, fewer dependencies. Radix or Base UI can be added per component when a complex widget (combobox, popover) needs it. |
| D5 | Tailwind v4 with CSS-first tokens (`@theme inline` over CSS variables) | A single file defines the design system, with light and dark themes. |
| D6 | React Router data router (`createBrowserRouter`) | Deep links per module, nested layout route, lazy routes later. |
| D7 | Self-hosted variable fonts (`@fontsource-variable/*`) | No third-party font requests, works offline, stable rendering. |
| D8 | Server binds to `127.0.0.1` and is same-origin with the client (Vite proxy in dev, static serving in prod) | No CORS surface, and not exposed to the LAN by default. |
| D9 | AI behind a provider interface (`modules/ai`) | Groq first. Another provider can be swapped in without touching routes. |
| D10 | Environment validated with Zod at startup. Node's `process.loadEnvFile` instead of dotenv | Fail fast with clear messages, one dependency fewer. |
| D11 | No server persistence. Uploads are processed in memory or a temp file and discarded | Product requirement, smaller attack surface. |
| D12 | Capabilities endpoint drives feature availability in the UI | The UI never pretends a feature works. It asks the server what is configured. |
| D13 | Native IndexedDB behind a `ListeningRepository` interface, no `idb` package | The surface is small (a dozen operations); owning it lets us map browser failures (private mode, quota, blocked upgrades) to clear errors. An in-memory implementation of the same interface is the fallback. |
| D14 | Persisted records validated with Zod schemas from `shared` on read | A corrupt or outdated record is skipped instead of crashing the UI. The same schemas will back the M7 JSON export. |
| D15 | Local media is not copied into IndexedDB by default; opt-in copy ≤ 500 MB with a quota check | The learner already has the file. Copying it by default would duplicate large files and burn quota. On reload the session asks for the file and checks its name and size. |
| D16 | One player-agnostic `Playback` contract for local media and YouTube | Replay-line, A-B loop and dictation are written once. YouTube has no time-update event, so its adapter polls `getCurrentTime()` every 200 ms. |
| D17 | YouTube through the official IFrame Player API on `youtube-nocookie.com` | Required to read the playback position for transcript sync. CSP `script-src` adds only `https://www.youtube.com` (the API script origin). No media access. |
| D18 | Session identity in the URL (`/listening/session/:id?mode=&line=`) | A reload restores exactly where the learner was, without extra "last session" state. |
| D19 | Groq over direct HTTP (native `fetch` + `fs.openAsBlob`) instead of `groq-sdk` | No new runtime dependency; the upload streams from the temp file instead of memory; explicit abort and timeout; no silent automatic retries (the SDK retries 429/5xx twice, which would re-upload up to 100 MB). The response is validated with our own Zod schema either way, since the SDK type doesn't model word timestamps. |
| D20 | `@fastify/multipart` streaming to a per-request temp directory | The official Fastify plugin, with per-request limits. Streaming keeps memory flat for large files; the directory is removed in `finally` and swept at startup after a crash. |
| D21 | Sentence cues built from word timestamps (`buildTranscriptCues`, linear-time alignment) | Whisper segments are acoustic chunks that often split sentences, which makes poor dictation lines. Segments are used as they are when no word timing exists; timing is never invented. |
| D22 | Request guards (loopback Host, Sec-Fetch-Site, custom header) on state-changing API calls | A local server is reachable from any open web page (CSRF, DNS rebinding). The first endpoint that spends the learner's paid quota made this necessary. |
| D23 | Real upload progress, indeterminate processing | XHR reports genuine bytes sent. Groq reports no progress, so the UI shows elapsed time only and never an invented percentage. |

## 4. Shared package consumption

`@ldg/shared` is TypeScript source compiled to `dist/` for production.

- **Client (Vite, Vitest):** a `resolve.alias` maps `@ldg/shared` to `packages/shared/src`, so changes are picked up instantly.
- **Server dev (tsx) and type checks:** tsconfig `paths` map `@ldg/shared` to the source, and tsx honours them.
- **Server build:** `tsconfig.build.json` has no `paths`, so the package resolves through `node_modules` to `dist/` (types from `dist/*.d.ts`). The root `build` script builds `shared` first.

## 5. API contracts

All responses are JSON. Every error uses one envelope:

```jsonc
// 4xx / 5xx
{ "error": { "code": "VALIDATION_ERROR", "message": "Human-readable summary", "details": [/* optional */] } }
```

Error codes: `VALIDATION_ERROR` (400), `FORBIDDEN` (403), `NOT_FOUND` (404), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `RATE_LIMITED` (429), `PROVIDER_ERROR` (502), `PROVIDER_UNAVAILABLE` (503), `PROVIDER_TIMEOUT` (504), `INTERNAL_ERROR` (500). A 500 never includes stack traces or internal messages.

State-changing requests (anything but GET/HEAD/OPTIONS under `/api`) must send `X-LDG-Client: web` and pass the request guards (§7).

### 5.1 Implemented

| Method | Path | Response |
| --- | --- | --- |
| GET | `/api/health` | `{ status: "ok", version: string, uptimeSeconds: number }` |
| GET | `/api/capabilities` | `{ targetLanguages: LanguageCode[], transcription: { available, configured, provider: "groq" \| null, maxUploadBytes }, feedback: { available, configured, provider } }` |
| POST | `/api/transcriptions` | `TranscriptionResult` (below) |

**`POST /api/transcriptions`** (M2). `multipart/form-data`; the text fields come **before** the file, because the stream is parsed in order:

| Field | Values | Default |
| --- | --- | --- |
| `model` | `whisper-large-v3-turbo` ("Fast") · `whisper-large-v3` ("Higher accuracy") | turbo |
| `language` | `en` · `auto` (omits the language so Whisper detects it) | `en` |
| `file` | FLAC, MP3, MP4, MPEG, MPGA, M4A, OGG, WAV, WebM; ≤ `TRANSCRIPTION_MAX_UPLOAD_MB` | required |

Response (`transcriptionResultSchema` in `shared`):

```jsonc
{
  "provider": "groq", "model": "whisper-large-v3-turbo",
  "requestedLanguage": "en",        // null for automatic detection
  "detectedLanguage": "English",    // as reported by the provider, or null
  "durationSeconds": 30,             // or null
  "text": "…",
  "segments": [{ "id": "1", "startMs": 900, "endMs": 8600, "text": "…", "avgLogprob": -0.2, "noSpeechProb": 0.01 }],
  "words":    [{ "text": "I", "startMs": 1000, "endMs": 1500 }]   // [] when not returned
}
```

Errors: 400 invalid options/fields or empty file · 403 request guard · 413 over the limit (ours or Groq's) · 415 unsupported type, MIME mismatch or content that isn't the claimed format · 429 another transcription running, or Groq's rate limit (with Retry-After seconds) · 502 Groq error or invalid provider response · 503 not configured, key rejected or Groq unreachable · 504 timeout. If the browser disconnects, the provider call is aborted and no response is sent.

The Groq call itself (verified against https://console.groq.com/docs/speech-to-text and the official SDK's types via Context7): `POST {GROQ_API_BASE_URL}/audio/transcriptions` with `model`, `response_format=verbose_json`, `temperature=0`, `timestamp_granularities[]=segment` and `=word`, optional `language`, and the file as `audio.<ext>` (never the learner's file name).

### 5.2 Planned

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| POST | `/api/feedback/writing` | `{ language, text, task? }` | `WritingFeedback { corrections[], naturalness[], summary }` |
| POST | `/api/feedback/speaking` | `{ language, transcript, prompt? }` | `SpeakingFeedback { … }` |

The exact Groq request formats will be verified against current documentation when each endpoint is implemented.

## 6. Data boundaries

| Boundary | Rule |
| --- | --- |
| Browser ↔ Server | Only explicit, user-initiated payloads (audio for transcription, text for feedback). Validated with Zod on arrival. |
| Server ↔ Groq | Secrets added server-side. Responses are validated (Zod) and normalised before being returned. Uploaded audio exists only in a per-request temp directory that is deleted in `finally`, including on errors and cancellation; stale directories from a crash are swept at startup. Groq's own retention is governed by the learner's Groq account, not by this app. |
| Browser storage | Learner data stays local. A future export/import feature uses a versioned JSON schema in `shared`. |
| YouTube | IFrame embed only. The client stores the video ID, never media bytes. |

## 7. Security (OWASP-aligned)

- **Secrets:** `GROQ_API_KEY` exists only in `apps/server/.env` (git-ignored). The client bundle has no access to it (verified by scanning the build). The provider keeps it in a private class field, and any key-like text in a provider error is redacted before it reaches a response. Vite only exposes `VITE_*` variables, and none are secret. `GROQ_API_BASE_URL` accepts only https, or http on loopback, so the key never crosses a network unencrypted.
- **Input validation:** Zod for env, request bodies, multipart fields and provider responses. Uploads: an allow-listed extension, a MIME type consistent with it, the size limit enforced while streaming, a magic-byte check of the content (`detectMediaContainer`), and limits of one file and two known fields.
- **Uploads on disk:** a fresh `mkdtemp` directory per request (unpredictable name, no user-controlled path segments), a fixed file name `upload.<ext>`, mode `0600`, `wx` flag; deleted in `finally`.
- **Request guards (CSRF / DNS rebinding):** a local server is reachable by any web page the learner has open. For state-changing `/api` calls, `plugins/request-guards.ts` requires (1) a loopback `Host` when bound to loopback, (2) no `Sec-Fetch-Site: cross-site/same-site`, and (3) the `X-LDG-Client` header, which cross-origin pages cannot send without a CORS preflight that the server never grants. It runs `onRequest`, so blocked uploads are never read.
- **Headers:** `@fastify/helmet` with a restrictive CSP. `script-src` is `'self'` plus `https://www.youtube.com` (the official IFrame API only, never inline), `frame-src` is limited to YouTube's embed origins and `media-src` to `self` and `blob:`.
- **Error handling:** one central handler maps known errors to the envelope and logs unknown errors server-side only.
- **Network exposure:** binds to `127.0.0.1` by default, has no CORS, and the global JSON body limit stays at 1 MB; only the transcription route accepts a larger body (the upload limit plus multipart overhead).
- **Abuse limits:** at most two concurrent transcriptions (429 beyond that), an upload limit, and a provider timeout. `@fastify/rate-limit` was not added: on a single-user loopback server, the concurrency cap, the request guards and Groq's own rate limits cover the realistic risks without another dependency.
- **Logging:** metadata only (model, language, bytes, timings, counts). Never file names, audio, transcript text or headers carrying credentials.
- **Dependencies:** kept minimal and run `npm audit` in validation.

## 8. Frontend architecture

- **Routing:** `/` (overview), `/listening`, `/speaking`, `/writing`, `/grammar`, `/reading`, `/vocabulary`, `/progress`. Planned modules render an honest "Planned" page driven by the module registry (`app/modules.ts`).
- **State:** local component state and small hooks. Add a store only when cross-feature state appears (likely Progress).
- **Media:** the `useMediaPlayer` hook wraps an `HTMLMediaElement` (time, duration, rate, volume, seeking). The UI layer renders the custom controls. Subtitle cues are matched to the current time with a binary search (`findActiveCueIndex`).
- **Persistence:** `lib/storage/indexed-db.ts` holds promise helpers and the `StorageError` mapping (`unavailable`, `quota`, `blocked`, `version`, `unknown`). The Listening repository (`features/listening/storage`) owns database `linguas-de-gato`, version 1:

  | Store | Key | Contents |
  | --- | --- | --- |
  | `sessions` | `id` | Title, source (file metadata or YouTube ID), transcript summary, playback position and rate, A-B loop, timestamps |
  | `transcripts` | `sessionId` | Cues; for generated transcripts also the provider's segments and word timestamps (optional fields added in M2, schema version unchanged) |
  | `media` | `sessionId` | Optional opt-in Blob copy of a local file |
  | `dictation` | `[sessionId, cueId]` | Reference text and the last 20 attempts |

  Upgrades migrate step by step from `oldVersion`; never edit a released step. Multi-store changes (delete a session, replace a transcript, which also clears dictation) run in one transaction. `updateSession` is read-modify-write in a single transaction, so concurrent updates don't overwrite each other. Other tabs close their connection on `versionchange`, so upgrades are not blocked indefinitely. Future modules (vocabulary, mistakes) add their stores in a new version.
- **Practice:** `useBoundedPlayback` implements replay-line and A-B loops on any `Playback`. It uses interval polling (not rAF), so loops keep working in background tabs, and the pure decision lives in `resolveRangeAction` (`shared`).
- **Transcription (M2):** `features/listening/transcription/`. `useTranscriptionJob` uploads with `apiUpload` (XMLHttpRequest, because fetch can't report upload progress): genuine byte progress while uploading, then an indeterminate "processing" state with elapsed time only. Cancelling aborts the request; the server then aborts the Groq call and deletes the temp file. On success, `createTranscribedSession` turns the result into M1 shapes with `buildTranscriptCues` (`shared`), which re-cuts Whisper's acoustic segments into sentence-sized dictation lines timed by word timestamps (greedy linear alignment), and stores the session and transcript in one transaction. The learner lands on the session with "Start dictation" offered. In an existing file session, the same job feeds the workspace's transcript replacement, which confirms before clearing dictation history.

## 9. Testing strategy

| Layer | Tool | Scope |
| --- | --- | --- |
| Domain (`shared`) | Vitest | Subtitle parsing, YouTube parsing, media validation and content signatures, time utilities, text comparison and WER, practice time maths, dictation progress, transcript cue building, record schemas |
| Client storage | Vitest + `fake-indexeddb` (dev only) | Repository contract run against both the IndexedDB and in-memory implementations, atomic session+transcript creation, M1-record compatibility, reload persistence, corrupt records, aborted writes, blocked upgrades, missing IndexedDB, error mapping, session creation from a transcription |
| Server | Vitest + `fastify.inject` + real sockets | Routes, error envelope, capabilities, security headers, env validation, transcription with mocked Groq responses (success, missing metadata, invalid responses, 400/401/413/429/5xx, network failure, timeout, concurrency), upload validation (type, MIME, content, size, fields), temp-file cleanup on every path including client disconnects mid-upload and mid-provider-call, request guards, key redaction, stale-upload sweep. No real API key is needed. |
| Client | Playwright MCP (manual, scripted checks) | Navigation, Listening flows, responsive layout, accessibility tree |

Component tests (Testing Library) will be added when the client gains non-trivial interactive logic beyond what `shared` covers.

## 10. Localisation

- **Target language:** `LanguageCode` and a language registry live in `shared`. All future content (exercises, vocabulary, transcripts) carries a `language` field.
- **Interface language:** English strings are in components for now. If interface localisation becomes a goal, extract the strings to message catalogs. The module registry already centralises module names and descriptions.

## 11. Design system

See [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md).
