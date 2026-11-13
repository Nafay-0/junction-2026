# Exa project rules (`exa/`)

These apply on top of the root `CLAUDE.md`. Its agent model policy and team workflow still hold.

## Ownership

- This folder is Asadullah's. Nafay owns Dock: `web/`, `infra/` and `.github/workflows/`. Do not edit those. If a change needs them, say so instead.
- Everything for this project stays inside `exa/`. Edit shared root files (`CLAUDE.md`, `README.md`, `.env.example`, `.gitignore`, `research/`, `.claude/`) only with small changes, and name them in the commit message.

## Git

- Asadullah pulls and pushes by hand. Claude commits only, on a branch named `asad/<topic>`, and never pushes.
- Before starting work, see what Nafay's side has landed since the last pull: `git log origin/main -10` and `git branch -r`. Nafay's agents merge into `main` often.

## Building

- The brief and judging criteria are in `exa/README.md`. Every answer the agent gives shows the source it came from.
- Judges type their own queries, so test with input you did not write. Keep cached Exa results for the rehearsed demo cases in case the venue Wi-Fi fails.
- Keys go in `exa/.env.local`. Add every new variable name to `exa/.env.example` with an empty value.
