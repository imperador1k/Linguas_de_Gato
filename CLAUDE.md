# CLAUDE.md — Linguas de Gato

A personal, local-first language-learning app (English first, B2 → C1/C2). Read `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` and `docs/DESIGN_SYSTEM.md` before making non-trivial changes.

## Stack

npm workspaces · `apps/client` (React 19, Vite, Tailwind v4, React Router) · `apps/server` (Fastify 5, Node ≥ 22) · `packages/shared` (Zod contracts + pure domain logic) · Vitest · TypeScript strict.

## Commands (run from the repo root)

| Task | Command |
| --- | --- |
| Install | `npm install` |
| Dev (client :5173 + server :3001) | `npm run dev` |
| Type check everything | `npm run typecheck` |
| Tests | `npm test` |
| Production build | `npm run build` |
| Run production build | `npm start` (serves API and client on :3001) |

## Non-negotiable rules

- **Secrets** live only in `apps/server/.env` (git-ignored; template in `.env.example`). Never read secrets in client code, and never add `VITE_*` variables containing secrets.
- **No server persistence.** Uploaded audio is processed in memory or a temp file and deleted after the request.
- **YouTube:** official IFrame embed only. Never add stream extraction, downloaders, scraping or yt-dlp.
- **No gamification** (XP, streaks, badges) and **no fake data**. Unimplemented features are labelled "Planned".
- **Validate external input** with Zod schemas from `@ldg/shared`. Errors go through the central handler (`apps/server/src/plugins/error-handler.ts`) using the `{ error: { code, message, details? } }` envelope.
- **Dependencies:** keep them minimal and justify each new one.

## Conventions

- English for code, comments and docs. Comment the *why*, not the *what*.
- Files are `kebab-case.ts(x)`. Components are `PascalCase`. Hooks are `useThing`.
- Pure logic (parsing, validation, time maths) goes in `packages/shared/src/domain`, with tests next to it (`*.test.ts`).
- Server routes stay thin. Provider-specific code lives in `apps/server/src/modules/*`.
- UI primitives live in `apps/client/src/components/ui` (shadcn pattern: cva + `cn`). Use the design tokens and never raw hex values in components.
- Accessibility: labelled controls, visible focus, keyboard support, `prefers-reduced-motion`.
- Imports from the shared package use `@ldg/shared`. Within a package, use relative imports with a `.js` suffix on the server and in shared.

## Verification before claiming done

`npm run typecheck && npm test && npm run build`, then check the running app in a browser (Playwright MCP) at desktop and 375 px widths.

## Environment notes

- Windows "Controlled folder access" is enabled on this machine. Some tools cannot write inside `Documents`, while `node` and `npm` launched from PowerShell can.
