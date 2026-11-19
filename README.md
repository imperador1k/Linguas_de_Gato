# Linguas de Gato

A personal, local-first workspace for deliberate language practice. English comes first, aimed at moving from B2 to C1/C2.

- **Listening** (available): local audio and video with a keyboard-friendly player, YouTube through the official embed, and SRT/WebVTT transcripts that follow playback.
- **Speaking, Writing, Grammar, Reading, Vocabulary, Progress**: planned (see [docs/ROADMAP.md](docs/ROADMAP.md)).

## Requirements

- Node.js ≥ 22.12 and npm ≥ 10

## Getting started

```bash
npm install
cp apps/server/.env.example apps/server/.env   # optional until transcription ships
npm run dev
```

Open http://127.0.0.1:5173. The API runs on http://127.0.0.1:3001, and Vite proxies `/api`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Client and server in watch mode |
| `npm run typecheck` | Strict TypeScript across all workspaces |
| `npm test` | Unit and API tests (Vitest) |
| `npm run build` | Production build (shared → server → client) |
| `npm start` | Serve the production build at http://127.0.0.1:3001 |

## Documentation

- [Product specification](docs/PRODUCT_SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Design system](docs/DESIGN_SYSTEM.md)
- [Roadmap](docs/ROADMAP.md)

## Privacy

There are no accounts, no server database and no analytics. Practice data stays in your browser. API keys live only in `apps/server/.env`, which is git-ignored.
