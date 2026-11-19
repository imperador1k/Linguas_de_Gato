# Architecture — Linguas de Gato

## 1. Overview

```
┌──────────────────────────── Browser ────────────────────────────┐
│  apps/client  (React 19 + Vite + Tailwind v4)                   │
│   ├─ features/*        module UIs (listening, dashboard, …)     │
│   ├─ components/ui     owned shadcn-style primitives            │
│   ├─ lib/api-client    typed fetch wrapper, error envelope      │
│   └─ local data        localStorage now, IndexedDB later        │
│                │ /api/* (same origin; Vite proxy in dev)         │
└────────────────┼────────────────────────────────────────────────┘
                 ▼
┌──────────────── apps/server  (Fastify 5, Node 22) ──────────────┐
│   routes/health, routes/capabilities, (later) transcriptions,   │
│   feedback → modules/ai  (provider abstraction → Groq)          │
│   plugins/error-handler (central error envelope)                │
│   config/env (Zod-validated environment, secrets live here)     │
└────────────────┬────────────────────────────────────────────────┘
                 ▼
            Groq API (Whisper, LLM)   — server-to-server only

packages/shared — API contracts (Zod schemas + types) and pure domain
logic (languages, media validation, YouTube URL parsing, subtitle
parsing, time utilities). Imported by both apps. No runtime I/O.
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
│  │     │  ├─ listening/     media importer + player + transcript
│  │     │  └─ planned/       placeholder page for planned modules
│  │     ├─ hooks/            cross-feature hooks
│  │     ├─ lib/              api client, utils, theme
│  │     └─ styles/           globals.css (design tokens)
│  └─ server/                 Fastify API
│     ├─ src/
│     │  ├─ config/           env loading and validation
│     │  ├─ plugins/          error handler
│     │  ├─ routes/           HTTP routes (thin)
│     │  ├─ modules/ai/       provider interfaces + registry
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

Error codes: `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `RATE_LIMITED` (429), `PROVIDER_UNAVAILABLE` (503), `PROVIDER_ERROR` (502), `INTERNAL_ERROR` (500). A 500 never includes stack traces or internal messages.

### 5.1 Implemented

| Method | Path | Response |
| --- | --- | --- |
| GET | `/api/health` | `{ status: "ok", version: string, uptimeSeconds: number }` |
| GET | `/api/capabilities` | `{ targetLanguages: LanguageCode[], transcription: { available: boolean, provider: "groq" \| null, maxUploadBytes: number }, feedback: { available: boolean, provider: "groq" \| null } }` |

### 5.2 Planned

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| POST | `/api/transcriptions` | `multipart/form-data`: `file` (audio/video ≤ `maxUploadBytes`), `language` (`en`) | `Transcript { language, durationSeconds, text, segments: [{ id, startMs, endMs, text }], sentences: [{ id, startMs, endMs, text }] }` |
| POST | `/api/feedback/writing` | `{ language, text, task? }` | `WritingFeedback { corrections[], naturalness[], summary }` |
| POST | `/api/feedback/speaking` | `{ language, transcript, prompt? }` | `SpeakingFeedback { … }` |

The exact Groq request formats will be verified against current documentation when each endpoint is implemented.

## 6. Data boundaries

| Boundary | Rule |
| --- | --- |
| Browser ↔ Server | Only explicit, user-initiated payloads (audio for transcription, text for feedback). Validated with Zod on arrival. |
| Server ↔ Groq | Secrets added server-side. Responses are validated before being returned. |
| Browser storage | Learner data stays local. A future export/import feature uses a versioned JSON schema in `shared`. |
| YouTube | IFrame embed only. The client stores the video ID, never media bytes. |

## 7. Security (OWASP-aligned)

- **Secrets:** `GROQ_API_KEY` exists only in `apps/server/.env` (git-ignored). The client bundle has no access to it. Vite only exposes `VITE_*` variables, and none are secret.
- **Input validation:** Zod for env, request bodies and query strings. Multipart limits on file size, file count and field count (with the transcription endpoint).
- **Headers:** `@fastify/helmet` with a restrictive CSP. `frame-src` is limited to YouTube's embed origins and `media-src` to `self` and `blob:`.
- **Error handling:** one central handler maps known errors to the envelope and logs unknown errors server-side only.
- **Network exposure:** binds to `127.0.0.1` by default, has no CORS, and the JSON body limit is 1 MB.
- **Abuse limits:** `@fastify/rate-limit` on AI endpoints (planned with the first AI route).
- **Dependencies:** kept minimal and run `npm audit` in validation.

## 8. Frontend architecture

- **Routing:** `/` (overview), `/listening`, `/speaking`, `/writing`, `/grammar`, `/reading`, `/vocabulary`, `/progress`. Planned modules render an honest "Planned" page driven by the module registry (`app/modules.ts`).
- **State:** local component state and small hooks. Add a store only when cross-feature state appears (likely Progress).
- **Media:** the `useMediaPlayer` hook wraps an `HTMLMediaElement` (time, duration, rate, volume, seeking). The UI layer renders the custom controls. Subtitle cues are matched to the current time with a binary search (`findActiveCueIndex`).
- **Persistence (later):** one IndexedDB wrapper module with versioned stores (`sessions`, `transcripts`, `vocabulary`, `mistakes`). It will use the tiny `idb` package or native APIs, decided at implementation time.

## 9. Testing strategy

| Layer | Tool | Scope |
| --- | --- | --- |
| Domain (`shared`) | Vitest | Subtitle parsing, YouTube parsing, media validation, time utilities |
| Server | Vitest + `fastify.inject` | Routes, error envelope, 404s, capabilities with and without a key, security headers |
| Client | Playwright MCP (manual, scripted checks) | Navigation, Listening flows, responsive layout, accessibility tree |

Component tests (Testing Library) will be added when the client gains non-trivial interactive logic beyond what `shared` covers.

## 10. Localisation

- **Target language:** `LanguageCode` and a language registry live in `shared`. All future content (exercises, vocabulary, transcripts) carries a `language` field.
- **Interface language:** English strings are in components for now. If interface localisation becomes a goal, extract the strings to message catalogs. The module registry already centralises module names and descriptions.

## 11. Design system

See [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md).
