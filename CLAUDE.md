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

Win the overall Junction 2026 main prize (€10,000), not only a partner challenge. Creativity and technical skill both have to show.

## Projects and ownership

Two separate projects share this repo. Each person owns one, and its Claude Code session stays inside that project's folders.

| Project | Challenge | Folders | Owner |
|---|---|---|---|
| Dock (AimoPilot) | Valio Aimo, "Trusted Trade Agents" | `valio-aimo/` (the app in `valio-aimo/web/`, plus `infra/`, `docs/`, `examples/`, `modal/`, `qa/`, `video/`), and the workflows `ci`, `crash-gate`, `crash-models`, `demo-suite` in `.github/workflows/` | Nafay (`Nafay-0`) |
| Exa project (name to come) | Exa, "The Internet Butler" | `exa/` (rules in `exa/CLAUDE.md`) | Asadullah (`Asadullah378`) |
| Shared | | `CLAUDE.md`, `README.md`, `research/`, `.claude/`, `.env.example`, `.gitignore` | Both: small edits only, named in the commit message |

The next section describes Dock. The Exa project's brief and plan are in `exa/README.md`.

## What we are building (decided Fri 13 Nov, evening)

**Challenge:** Valio Aimo, "Trusted Trade Agents" (€4,000 / €2,000 / €1,000). Name: **AimoPilot** (decided Sat 14 Nov; the partner has no objection). Code identifiers, routes and `DOCK_*` environment variables keep the working title "Dock".

**Pitch:** the open loading dock for AI buyers. Any company's purchasing agent can order from a wholesaler through open standards, carrying a signed mandate that says what it may buy; anything beyond the mandate needs a human sign-off on their phone. The model is never trusted: plain code checks every order.

**Valio's rubric** (full text and their wish list in `research/07-valio-challenge-detail.md`; read it before changing behaviour):
- 30% working end-to-end demo: the full request → lookup → order/approval flow in the mocked environment.
- 20% solving the user's need: how precisely the agent matches what the buyer asked for, **with the least manual correction needed**. Ask or confirm only when it changes the outcome.
- 20% autonomy and controls: what the agent decides alone, what needs sign-off, how decisions are logged and auditable.
- 15% robustness to exceptions: partial availability, substitutions, delivery constraints (order cut-off times).
- 15% openness and path to production: open documented standards, visible assumptions, justified choices, next steps.

**What Valio says it would love to see:** a trust protocol (an outside agent can verify Valio's claims on stock, price and origin without a manual check); a guardrails model (spend thresholds, substitutions outside stated preferences); "good-better-best" ranking for substitutes and partial availability; an audit trail readable by both the buyer and Valio.

**Valio's required flow:** Request → Lookup → Order (commit at a fixed price) → Approval (agent decides alone, or a human signs off). Their example: "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability."

**Valio's constraints:** it is not a chatbot. We mock today's webshop, not a marketplace. Query the pricing and availability APIs only when needed, never for all products. They supply mock pricing/availability APIs plus product, delivery-reliability and carbon-footprint files.

**The demo path that must always work:** reviewer scans a QR code and becomes the approver → agent gets the milk request → lookup hits partial availability → agent proposes a substitute → order exceeds the mandate → approval arrives on the reviewer's phone → signed order appears on the main screen → reviewer tries to make the agent misbehave and the gate refuses with a reason.

**The experience (decided Fri 13 Nov, late):** the project is shown as a two-sided portal, the shape this team won Valio Aimo's challenge with last year (Omni-Valio), not as a bare API.
- **Kitchen portal** (`/k/<kitchen>`): feels like a food-service webshop; the kitchen's own purchasing agent works inside it, remembers earlier requests and orders, and shows its work as structured cards. Not a chat thread: the partner says twice that this is not a chatbot.
- **Operations portal** (`/ops`): the wholesaler's staff see every agent at the door, a replayable step-by-step trace of any request, the safeguards and how often each fired, and can suspend an agent.
- **Landing page** (`/`: what it is, sign in, sign up a restaurant), **phone sign-off** (`/join`, `/approve/<id>`), **the wall** (`/wall`), and the **open interface** (`/api/mcp`, OpenAPI) that outside agents use. The on-site agent is only one client of the same gate.
- Do not copy code from last year's project; event rules restrict pre-existing code. Do not imitate the real company's branding; keep the "demo on synthetic data" note visible.

**Main-prize judging:** assigned peer reviewers score Innovation, Impact, Implementation at our table on Sunday 10:30; top 5 pitch for 3 minutes plus 3 minutes of questions. Final submission Sunday 10:00 with a video of at most 2:00.

**Code layout:** everything of this project lives under `valio-aimo/` (moved there on 15 Nov, next to the Exa project's `exa/`). The app is `valio-aimo/web/` (Next.js, TypeScript, pnpm). Framework-free logic lives in `valio-aimo/web/src/core/` and is covered by tests; nothing in `core/` may call an LLM. Paths in this file such as `research/…` are from the repository root; the project's own workflows run only when `valio-aimo/**` changes.

## Team workflow (two people, one repo)

- Remote: `https://github.com/Nafay-0/junction-2026` (private). Two people commit here, each with their own Claude Code session.
- `main` must always run; it is the demo branch. Never push broken work to it.
- Work on short branches named `<name>/<topic>`, merge back within a few hours. Run `git pull --rebase origin main` before starting and before merging.
- Before editing, check `git status` and `git log origin/main -5` so you do not build on stale code or overwrite the other person's work. Do not force-push to `main`.
- Stay inside the area the current person owns (see "Projects and ownership" above). If a change needs files in the other person's area, say so instead of editing them silently.
- Secrets go in `.env.local` only. Every new variable name is added to `.env.example` with an empty value.
- Commit small and often with clear messages; the other person reads the log to stay in sync.

## Research

Background research lives in `research/` (event intel, challenges, winning playbook, toolkit). Read it before re-researching.
