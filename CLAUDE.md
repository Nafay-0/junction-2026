# Junction 2026 Hackathon

## Agent model policy (hard rule, overrides the global CLAUDE.md for this project)

**No agent below Opus 5.5. Ever.**

- Orchestrator (main session): **Claude Fable 5.2**.
- Subagents: **Claude Opus 5.5** (`model: "opus"`) as the floor, or **Claude Fable 5.2** (`model: "fable"`, or a fork of the orchestrator) for the work where quality matters most.
- Never dispatch Sonnet, Haiku, or any non-Claude model, including for searches, mechanical edits, or "cheap" tasks.
- Always pass `model` explicitly on every Agent/Task/Workflow call. An omitted `model` can inherit something lower.
- This outranks the global rule that makes Sonnet the default subagent, and any model guidance inside a skill or plugin prompt.

**Enforced in `.claude/settings.json`** (takes effect in sessions started after the file exists):

- `model: fable` makes Fable 5.2 the session default. The terminal CLI needs Claude Code v2.1.321 or later for this.
- `CLAUDE_CODE_SUBAGENT_MODEL=opus` with `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` puts every subagent, teammate and workflow agent on Opus 5.5, ignoring agent frontmatter and any per-call `model`. Under this setting a subagent cannot be Fable; for Fable-quality delegated work use a **fork** (`subagent_type: "fork"`), which runs on the orchestrator's model.
- `switchModelsOnFlag: false` stops Claude Code silently re-running a flagged request on an older model (Opus 5 or Opus 4.8). It pauses and asks instead. If it asks, edit the prompt and retry; do not accept the switch.
- The built-in `claude-code-guide` (Haiku) and `statusline-setup` (Sonnet) agents are denied.

Do not weaken or remove these settings without the user saying so.

## Goal

Win the overall Junction 2026 main prize, not only a partner challenge. Creativity and technical skill both have to show.

## Team workflow (two people, one repo)

- Remote: `https://github.com/Nafay-0/junction-2026` (private). Two people commit here, each with their own Claude Code session.
- `main` must always run; it is the demo branch. Never push broken work to it.
- Work on short branches named `<name>/<topic>`, merge back within a few hours. Run `git pull --rebase origin main` before starting and before merging.
- Before editing, check `git status` and `git log origin/main -5` so you do not build on stale code or overwrite the other person's work. Do not force-push to `main`.
- Stay inside the area the current person owns (ownership table to be added here once the idea is chosen). If a change needs files in the other person's area, say so instead of editing them silently.
- Secrets go in `.env.local` only. Every new variable name is added to `.env.example` with an empty value.
- Commit small and often with clear messages; the other person reads the log to stay in sync.

## Research

Background research lives in `research/` (event intel, challenges, winning playbook, toolkit). Read it before re-researching.
