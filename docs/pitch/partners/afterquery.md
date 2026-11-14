# AfterQuery, "Break the Agent": the crash test

AfterQuery's RL lead, Daksh Raghuvanshi, is also on the main jury. His stated interest: "teams that can explain
exactly why an agent fails in their world, and whose reward holds when someone tries to break it"
(`research/01-event-intel.md`). His bio mentions StoreBench, "a live-commerce environment where no frontier model
matched a simple scripted operator" (`research/02-challenges.md`). Expect him to compare.

## What it is, in plain words

A safety rating for AI buyers, like a crash test for cars. Thirteen hard purchasing situations, each built around
one decision a careless buyer gets wrong: 240 litres is 20 cases, not 240; "by Monday" when the cheapest milk's
order cut-off has passed; low-lactose is not lactose-free; missing allergen data is unknown, not safe; a timeout
after the order went through means check before ordering again. Each episode gets a fresh, isolated AimoPilot with its
own clock, catalogue and ledger. The agent sees the same tools an MCP client sees. The score comes from the gate's
own records, never from the agent's account. The rating then maps to a licence level (L0 to L3) with a spending limit.

Code: `web/src/crash/`. Documentation: `web/README.md`, section "Crash test". Merged to `main` in `4c1ca9d`.

## Against the brief

| Brief (`research/05-official-briefs.md`) | What exists | Status |
|---|---|---|
| An environment where a frontier agent measurably falls short of a stronger reference | Scripted reference policy scores 100 on all 13 (tested on seeds 1, 2 and 7). Models, one run each on seed 1: GPT-6 Luna 61.9, Gemini 3.1 Flash Lite 66.2 (one episode invalid), Nemotron-3-Nano-30B 37.0, Qwen3-8B 26.1, Qwen3-4B 24.7 | **Partly.** The models tested are small, cheap ones. No frontier model completed a full run (Claude Haiku 5.5 ran only two single episodes; Nemotron-3-Super was refused by the provider). The reference is a script, not a stronger model |
| Reproducible reference run | `pnpm crash:reproduce`: reference, 3 baselines, 6 exploits, seed 1, 3 repeats each, about 2 s; checks byte-identical trajectories and prints a summary digest | Yes (`web/src/crash/crash.test.ts`: "is deterministic…", "the reference buyer plays it perfectly on several seeds") |
| Do-nothing and stop-early baselines | Both score 0 on every scenario | Yes (README scores table; test "doing nothing, stopping early or claiming success scores 0") |
| Three agent runs | Supported (`--repeat 3`); the licence is judged on the worst repeat | **Not done for models.** Each model ran once |
| Reward integrity: judges hunt exploits for 15 minutes | Our own hunt, in the README's "Trying to break our own reward" table: claim success without ordering (0), honest nothing (1.5), always decline (7.7), always escalate (72, licence L1), always first product (34), over-order 1.5x (42.8), scan the live price service, split an over-limit order, hide the need-by date. Two real holes found and fixed: catalogue order used to put the right product first, and scanning prices used to find the target cheese | Yes, and documented with what was fixed |
| One-command reproduction from the README | `cd web && pnpm crash:reproduce` | Yes |
| Optional: train a smaller model and show it improves | Not done. Trajectories are written in a training-ready format (`dock-crash-trajectory/1`) | No |

## Why an agent fails here, in one sentence each (from the model runs in `web/README.md`)

- GPT-6 Luna: listed the options to the buyer and stopped instead of deciding (partial stock, quote expiry); renewed a
  drifted standing order without asking; declined the impossible deadline without the earliest date.
- Gemini 3.1 Flash Lite: stopped with a message instead of ordering in three scenarios; same drift and deadline
  misses.
- The small open models (Qwen3, Nemotron Nano): mostly stopped before ordering, or ordered nothing; Qwen3-8B read
  "Monday" as Tuesday.

## Where to see it

- Terminal: `cd web && pnpm crash:reproduce` (no keys needed), `pnpm crash --list`.
- Operations desk: `/ops/agents` shows licences only when results are exported to the server; on Saturday 01:30 the
  live site did not have the crash test deployed, and the page says "Not crash-tested yet".

## What is true and what is not yet

- True: thirteen scenarios, deterministic scripted runs, baselines, a documented exploit hunt, a licence function
  (`licensedMandate` in `web/src/crash/licence.ts`) tested to cap a mandate.
- Not yet: the licence does not set limits at the live gate. Model runs are single runs. Raw model trajectories are
  not in the repository (`crash-results/` is git-ignored), so the model table is reproducible only by rerunning with
  keys. Scenarios are mostly dairy; each isolates one decision, while real days combine several (the README's own
  "Known limits").

## If you enter this challenge

Before Sunday: run each model three times (`--repeat 3`), run one frontier model on the full suite, and commit the
exported summary (`pnpm crash:export`; check it contains no secrets). Someone must be free for AfterQuery's 10-minute
demo during review.
