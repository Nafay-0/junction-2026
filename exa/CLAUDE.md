# Exa project rules (`exa/`)

These apply on top of the root `CLAUDE.md`. Its agent model policy and team workflow still hold. That policy is about the Claude Code agents that write the code; the product's own runtime models are listed in `web/src/lib/agent/models.ts` and include fast models on purpose.

## Ownership

- This folder is Asadullah's. Nafay owns Dock: `/web`, `/infra` and `/.github/workflows/` at the repo root. Do not edit those. If a change needs them, say so instead.
- Everything for this project stays inside `exa/`. Edit shared root files (`CLAUDE.md`, `README.md`, `.env.example`, `.gitignore`, `research/`, `.claude/`) only with small changes, and name them in the commit message.

## Git

- Asadullah pulls and pushes by hand. Claude commits only, on a branch named `asad/<topic>`, and never pushes.
- Before starting work, see what Nafay's side has landed since the last pull: `git log origin/main -10` and `git branch -r`. Nafay's agents merge into `main` often.

## The app (`exa/web`)

- Read `README.md` (one level up) for what is built and the code map, and `web/AGENTS.md`: this is Next.js 16 and AI SDK 7, and both differ from older versions. Their docs ship in `node_modules/next/dist/docs/` and `node_modules/ai/docs/`. Check names there, not from memory.
- Exa's API changed a lot in 2026. Before changing an Exa call, read `reports/Exa Internet Butler playbook.md`. Call Exa through `web/src/lib/exa/client.ts` so cost tracking and caching keep working.
- A tool returns the payload its widget renders; the shapes live in `web/src/lib/widgets/types.ts`. Every payload carries `sources`, and every widget shows them.
- Tools that stream progress are async generators. The last value they `yield` is the result; a generator's `return` value is ignored by the AI SDK.
- Reasoning is never replayed across turns (see the comment in `web/src/app/api/chat/route.ts`). Keep it that way: it is what makes model switching and context trimming safe.
- Sift (`web/src/lib/agent/tools/sift.ts`) checks many pages against the user's wishes with Gemini's decision model, through `web/src/lib/decisions/client.ts`. The judge is only ever given what Exa returned, and "the page does not say" stays a third answer beside yes and no: do not fold it into no. One request carries every page and every question (at most 1,000 questions); the field names are the ones in `node_modules/@google/genai` (`decisions.create`) and the docs (aistudio.google.com/docs/decisions-api). After touching either file run `pnpm smoke decisions` and one real question through the app.
- New widgets follow `web/WIDGETS.md` and get a fixture so they show up in `/dev/widgets`.
- Before committing: `pnpm typecheck`, `pnpm lint`, and for anything that touches the agent, one real question through the running app.
- Thinking and effort settings live in `web/src/lib/agent/options.ts`, one entry per model and job. Claude and Gemini take different parameters, and models inside a family reject different values. After changing that file or adding a model, run `pnpm smoke options` (18 small requests against the live APIs).
- Web and desktop are one codebase and one server. The desktop app (`web/desktop/`) loads the interface from the server and adds the live browser. Do not fork the interface for either: use `clientKind()` / `useDesktopApp()` where they differ. The web gets no browser tools (`createTools`) and its instructions say to point people to the desktop app; keep both in step when adding a tool that acts.
- The live browser's engine (`web/src/lib/browser/`: `session.ts`, `guard.ts`, `snapshot.ts`, `engine.ts`) runs in the desktop app's main process, bundled by `desktop/build.mjs`. It must not import `server-only`, Next or anything from the server; the server must not import `session.ts` or `engine.ts`. The agent's browser tools have no `execute` on the server: the interface hands each step to the app (`butler.tsx`, `lib/browser/client.ts`).
- Every agent step goes through `guard.ts`. Payment, passwords and one-time codes are refused in code; anything that commits the user waits for approval inside the engine. Do not loosen a rule to make a site work: hand the page to the user instead. After touching `guard.ts` run `pnpm test:guard`; after touching anything in `lib/browser/`, `desktop/` or `components/browser/` run `pnpm test:desktop <port>` with the server up (it uses a throwaway profile and signs in with the admin from `.env.local`). Never test a real booking, order or message on a real site past the approval step; use `/dev/sandbox.html`.
- Do not open a remote-debugging port in the app, do not open a browser outside the app, and do not add anything that hides the agent from sites (no automation-hiding switches, no stealth plugins): the view is honest about being Beryl. The agent's mouse goes through `sendInputEvent` and its keys only after the view holds the keyboard (`desktop/relay.cjs`); keep both, or its input lands in the interface instead of the page.
- Accounts and data (`web/src/lib/db/`, `web/src/lib/auth/`): every API route that touches someone's data starts with `requireUser()` (or `requireAdmin()`), and every query is scoped to that user. `/api/chat` and `/api/conversations` are outside the proxy on purpose (large bodies) and check for themselves. After changing `schema.ts` run `pnpm db:generate` and commit the migration; after changing auth or the conversations API run `pnpm test:auth <port>`. There is one admin, from `ADMIN_EMAIL`/`ADMIN_PASSWORD`; never add a way to make another. Never print or commit the admin password.
- A conversation is continued only in the kind of client it was started in (`origin`). The server enforces it in `/api/chat` and the conversations API; the interface shows the note.
- Voice (`web/src/lib/voice/`, `web/src/components/voice/`, `web/src/app/api/voice/`): the browser talks to Gemini's Live API directly with a short-lived token from `/api/voice/token`; the API key must never reach the browser, and everything the agent is told or may do goes into the token's locked config, not into what the interface sends. A call writes into the conversation's own messages (`live-call.ts`), so a tool part it writes must have the same shape a typed conversation would produce. A step that commits the user is approved by a press on screen, never by voice. Check Gemini's names in the docs (aistudio.google.com/docs/live-api) and in `node_modules/@google/genai`, not from memory: they change. After touching voice run `pnpm test:voice <port>`.
- The name and the logo's shapes are in `web/src/lib/brand.ts`. After changing the logo run `pnpm icons`, and update the two hand-copied files it names.
- Keys go in `exa/.env.local`. Add every new variable name to `exa/.env.example` with an empty value.
