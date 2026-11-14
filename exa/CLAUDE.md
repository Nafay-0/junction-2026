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
- Keys go in `exa/.env.local`. Add every new variable name to `exa/.env.example` with an empty value.
