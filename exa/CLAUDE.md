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
- New widgets follow `web/WIDGETS.md` and get a fixture so they show up in `/dev/widgets`.
- Before committing: `pnpm typecheck`, `pnpm lint`, and for anything that touches the agent, one real question through the running app.
- Thinking and effort settings live in `web/src/lib/agent/options.ts`, one entry per model and job. Claude and Gemini take different parameters, and models inside a family reject different values. After changing that file or adding a model, run `pnpm smoke options` (18 small requests against the live APIs).
- The live browser (`web/src/lib/browser/`): every agent step goes through `guard.ts`. Payment, passwords and one-time codes are refused in code; anything that commits the user needs approval. Do not loosen a rule to make a site work: hand the page to the user instead. After touching `guard.ts`, `session.ts` or `snapshot.ts`, run `pnpm test:guard` and, with the dev server up, `pnpm test:browser <port>`. Never test a real booking, order or message on a real site past the approval step; use `/dev/sandbox.html`. The own-Chrome mode is tested with `pnpm test:own <port>`, which starts a stand-in Chrome: never attach to the user's real Chrome from a test, and never change Chrome's settings for them.
- The desktop app (`web/desktop/`, `pnpm desktop`): the browser is a view inside the app, driven through `desktop/relay.cjs`. After touching `desktop/`, `components/browser/desktop-view.tsx` or the desktop parts of `session.ts`, run `pnpm test:desktop <port>` with the dev server up; it uses a throwaway profile, never the real app's sign-ins. Do not open a remote-debugging port in the app or add anything that hides the agent from sites (no automation-hiding switches, no stealth plugins): the view is honest about being Baton. The agent's mouse goes through `sendInputEvent` and its keys only after the view holds the keyboard; keep both, or its input lands in the interface instead of the page.
- Keys go in `exa/.env.local`. Add every new variable name to `exa/.env.example` with an empty value.
