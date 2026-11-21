# Linguas de Gato

**A personal, local-first workspace I built to take my English from B2 to C1.**

I'm a Portuguese speaker. My English was good enough to get by, but not good enough to sound natural, write with precision or follow fast native speech. Language apps didn't help: they reward streaks and points, not real improvement. So I made the tool I actually wanted: one place to listen, read, speak and write in English, get honest feedback on my own words, and see which mistakes keep coming back.

*Línguas de gato* ("cat's tongues") are thin Portuguese butter biscuits, and a small pun on *línguas*, languages.

## Why this project exists

This is a **language-learning project first**. Its purpose was to improve my English through daily, deliberate practice, and the app is the result of that.

- **I designed it and directed it.** I wrote the requirements for every module, decided what "good feedback" means for a learner, reviewed every milestone and tested each feature with my own practice and real AI feedback.
- **The code was written with an AI pair programmer** (Anthropic's Claude, through Claude Code), working from my specifications one milestone at a time. I'm open about that: the point was never to show off hand-written code, but to build something that genuinely helps me learn.
- **The project itself became English practice.** Every specification, review and conversation behind it happened in English, so building it trained the same skills it practises.

## What it does

| Module | What you practise |
| --- | --- |
| **Listening** | Transcribe your own audio or video (Groq Whisper), or watch YouTube through the official player; follow the transcript, loop hard passages, take line-by-line dictation with a word-level diff, and answer comprehension questions grounded in what was said. |
| **Reading** | Read texts generated for your level or paste your own; look up any word or phrase *in its sentence*, save it, and check your understanding with questions that quote the text. |
| **Speaking** | Answer a question out loud, check what the app heard, and get feedback where every correction quotes your own words, plus fluency measurements and exercises built from your mistakes. |
| **Writing** | Essays, emails, reports and more, with feedback that keeps real errors apart from stylistic suggestions, and an improved version only if you ask for it. |
| **Grammar** | B2–C2 structures in six question types, checked against a verified answer key, with the rule behind every option. |
| **Vocabulary** | Your own dictionary of expressions, each kept with the sentence you found it in, a simple review schedule, and practice built from your words. |
| **Progress** | What you practised, with every number defined; recurring mistakes gathered across modules with the evidence behind them; recommendations and targeted practice. No points, streaks or invented scores. |
| **Today** | Where you left off, what is due for review and what to practise next. |

### Principles

- **Evidence, not gamification.** Every correction must quote what you actually said or wrote; anything that can't be verified is withheld. No XP, streaks or fake CEFR levels.
- **Local-first and private.** Everything you practise stays in your browser (IndexedDB). There are no accounts and no server database; backups are files you download.
- **AI only when you ask.** Nothing is sent to the AI provider until you press a button, and the API key never reaches the browser.

## Tech stack

- **Monorepo** with npm workspaces: `apps/client`, `apps/server`, `packages/shared`
- **Client:** React 19, Vite, Tailwind CSS v4, React Router
- **Server:** Fastify 5 on Node.js ≥ 22, proxying Groq (Whisper for transcription, an LLM with strict JSON schemas for feedback and exercise generation)
- **Shared:** Zod contracts and pure, tested domain logic (text comparison, answer checking, the learning-analytics engine)
- **Quality:** strict TypeScript, ~740 Vitest unit and API tests, and browser checks with Playwright at desktop, tablet and mobile widths in light and dark themes

## Getting started

Requirements: Node.js ≥ 22.12, npm ≥ 10, and a recent Chrome, Edge, Firefox or Safari (Speaking needs microphone access).

```bash
npm install
cp apps/server/.env.example apps/server/.env   # add a Groq API key for transcription, feedback and generation
npm run dev
```

Open http://127.0.0.1:5173. The API runs on http://127.0.0.1:3001.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Client and server in watch mode |
| `npm run typecheck` | Strict TypeScript across all workspaces |
| `npm test` | Unit and API tests (no API key needed) |
| `npm run build` | Production build |
| `npm start` | Serve the production build at http://127.0.0.1:3001 |

### Groq configuration

1. Create an API key at https://console.groq.com/keys.
2. Put it in `apps/server/.env` as `GROQ_API_KEY=…` (the file is git-ignored).
3. Restart the server.

| Variable | Default | Notes |
| --- | --- | --- |
| `GROQ_API_KEY` | (empty) | Enables transcription, feedback and exercise generation. |
| `GROQ_CHAT_MODEL` | `openai/gpt-oss-120b` | Model for feedback and generation. |
| `TRANSCRIPTION_MAX_UPLOAD_MB` | `25` | Groq's free-tier limit. |
| `TRANSCRIPTION_TIMEOUT_SECONDS` | `300` | Upper bound for one transcription request. |
| `GROQ_CHAT_RESPONSE_FORMAT` | `auto` | Strict JSON Schema where supported, JSON Object Mode otherwise. |
| `GROQ_REASONING_EFFORT` | `medium` | Sent only to GPT-OSS models. |
| `ASSESSMENT_TIMEOUT_SECONDS` | `120` | Upper bound for one feedback or generation request. |

## Privacy

Practice data stays in your browser. Text or audio is sent to Groq, through the local server, only when you press the button for that action (Transcribe, Get feedback, Generate, Look up). The full explanation is in the app under **Settings & data → Privacy & AI**.

## Documentation

- [Product specification](docs/PRODUCT_SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Design system](docs/DESIGN_SYSTEM.md)
- [Roadmap](docs/ROADMAP.md)
- [UX audit and redesign plan](docs/M7_UX_AUDIT.md)

## Credits

Designed, specified and tested by **Miguel Pereira Santos** ([@imperador1k](https://github.com/imperador1k)).
Code written with **Claude** (Anthropic) as an AI pair programmer.
