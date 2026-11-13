# Junction 2026

Our project for the Junction 2026 hackathon. Two people, one repo. The idea and stack are not locked yet; this file will grow once they are.

## Get set up

```bash
git clone https://github.com/Nafay-0/junction-2026.git
cd junction-2026
cp .env.example .env.local   # then fill in the keys (shared privately, never committed)
```

If you use Claude Code, open it in this folder. It reads `CLAUDE.md` automatically, which holds the rules we both work under, including which models agents may run on.

## How we work together

- `main` always runs. It is what we demo from, so nothing broken gets merged into it.
- Work on a short branch named `yourname/what-it-is`, for example `sam/voice-input`. Merge back within a few hours; long-lived branches cause conflicts we do not have time for.
- Before starting work: `git pull --rebase origin main`. Before merging: pull again and check the app still runs.
- Split by area so we rarely touch the same files. Who owns what is listed in `CLAUDE.md` once we have chosen the idea.
- Secrets live in `.env.local` only. Add every new variable name to `.env.example` with an empty value so the other person knows it exists.

## What is in here

| Path | Contents |
|---|---|
| `CLAUDE.md` | Rules for Claude Code in this repo: agent models, goal, team workflow |
| `research/` | Background research: event rules and judging, partner challenges, what has won before, tooling |
| `.env.example` | Names of the environment variables the app needs |
| `web/src/crash/` | The crash test: scenarios, scoring, agents and the licence. Run `cd web && pnpm crash:reproduce`; see [web/README.md](web/README.md#crash-test) |
