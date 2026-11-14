# NVIDIA and Featherless

**Short version: both were evaluated, neither is in the product's live path. This is a thin use; say so.**

## What they do in the project, in plain words

Featherless hosts open models behind one API. We used it to try open models in two places: as AI buyers in the
crash test, and as readers of photographed order lists. NVIDIA's models came through Featherless: Nemotron as a
buyer, Cosmos-Reason2 as a reader. Any Featherless model can be set as the list reader with
`DOCK_SCAN_MODEL=featherless:<id>`, but the default is Claude Haiku 5.5.

## Results

**Crash test** (one run each, seed 1; `web/README.md`, "Model results"):

| Model (via Featherless) | Overall, out of 100 | Licence |
|---|---|---|
| NVIDIA-Nemotron-3-Nano-30B-A3B | 37.0 | L0 |
| Qwen3-8B | 26.1 | L0 |
| Qwen3-4B | 24.7 | L0 |
| NVIDIA-Nemotron-3-Super-120B-A12B | not scored: provider at capacity (HTTP 429) on 12 of 13 episodes | |

**Reading order lists** (37 item lines; `web/docs/doors.md`, "Evaluation"):

| Model (via Featherless) | Items right, run 1 / run 2 | Notes |
|---|---|---|
| NVIDIA Cosmos-Reason2-32B | 25 / 11 | No PDF input; timeouts; dropped whole notes |
| Qwen3-VL-32B | 32 / 29 | No PDF input |

For comparison, Claude Haiku 5.5 read 33 / 37, and it is the one we chose. Featherless offers no Nemotron
vision-language model, so NVIDIA's own vision model there, Cosmos-Reason2, was evaluated instead.

## Where to see it

`web/src/crash/` (`pnpm crash --agent featherless:Qwen/Qwen3-4B`, needs `FEATHERLESS_API_KEY`),
`web/src/server/channels/scan/read.ts`, `web/docs/doors.md`.

## What is true and what is not

- True: the crash test runs open models through Featherless, and the results above are recorded in the README.
- Not: no open model is used by default anywhere in the product. The bigger Nemotron model could not be scored
  because the provider was at capacity. NVIDIA's "best use of Nemotron" tech challenge would be a weak entry.
