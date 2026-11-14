/**
 * Driving school, step 1: a supervised fine-tuning set from the crash test's reference agent, rendered exactly as
 * Dock's buyer-agent runner (src/server/agent/runner.ts) shows a model the job, so a small open model learns to drive
 * the same tools the same way it will be tested.
 *
 *   pnpm tsx scripts/crash-sft.ts --seeds 2-21 --out ../modal/driving_school/data/train.jsonl
 *
 * One example per (scenario, seed) the reference wins with 100: OpenAI chat format with `tools`:
 *   system     buyerAgentSystem({ today, weekday, serverInstructions: briefing + Dock's MCP instructions })
 *   user       the buyer's task in plain words
 *   assistant  one tool call per turn, as the reference made it (arguments verbatim)
 *   tool       JSON.stringify of the tool's full result, as the crash adapter's DockConnection returns it
 *   assistant  a short final message to the buyer (the message it passed to finish)
 * Tokens and ids are Dock's real ones (no aliasing): the model has to learn to copy a quote token from a result.
 * Held-out seeds for evaluation (101-103) are never written here.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { localNow } from "@/core/kitchen";
import { reference } from "@/crash/agents/reference";
import type { Harness } from "@/crash/agents/types";
import { CrashEnv } from "@/crash/env";
import { SUITE } from "@/crash/scenarios";
import { scoreRun } from "@/crash/score";
import { buyerAgentSystem } from "@/server/agent/prompts";
import { MCP_INSTRUCTIONS } from "@/server/mcp/server";

const argv = process.argv.slice(2);
const opt = (n: string) => (argv.indexOf(`--${n}`) >= 0 ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HELD_OUT = new Set([101, 102, 103]);

function seedsOf(spec: string): number[] {
  const out: number[] = [];
  for (const part of spec.split(",")) {
    const [a, b] = part.split("-").map(Number);
    for (let s = a; s <= (b ?? a); s++) out.push(s);
  }
  return out;
}

const stub: Harness = {
  start: "",
  recordIntake: () => undefined,
  noteAnsweredForHuman: () => undefined,
  reportFromText: () => undefined,
  orderIds: async () => [],
  intakeAnswer: () => ({ refuse: false }),
};

async function main() {
  const seeds = seedsOf(opt("seeds") ?? "2-21");
  const bad = seeds.filter((s) => HELD_OUT.has(s));
  if (bad.length) throw new Error(`Seeds ${bad.join(", ")} are held out for evaluation.`);
  const out = opt("out") ?? "../modal/driving_school/data/train.jsonl";
  const lines: string[] = [];
  let skipped = 0;
  for (const seed of seeds)
    for (const scenario of SUITE) {
      const env = await CrashEnv.create(scenario, seed);
      await reference.run(env, { ...stub, start: env.built.world.start });
      env.agentReturned();
      const record = await env.record();
      const score = scoreRun(env.built, record, env.outcomeContext());
      if (score.score < 100) {
        skipped++;
        continue;
      }
      const local = localNow(new Date(env.built.world.start));
      const system = buyerAgentSystem({ today: local.date, weekday: WEEKDAYS[new Date(`${local.date}T12:00:00Z`).getUTCDay()], serverInstructions: `${env.briefing}\n\n${MCP_INSTRUCTIONS}` });
      const messages: Record<string, unknown>[] = [
        { role: "system", content: system },
        { role: "user", content: env.task.text },
      ];
      let n = 0;
      let finalMessage = "";
      for (const s of record.steps) {
        if (s.kind !== "tool_call" || !s.tool) continue;
        const id = `call_${++n}`;
        messages.push({ role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name: s.tool, arguments: JSON.stringify(s.args ?? {}) } }] });
        messages.push({ role: "tool", tool_call_id: id, content: JSON.stringify(s.result) });
        if (s.tool === "finish") finalMessage = String((s.args as { message?: string })?.message ?? "");
      }
      messages.push({ role: "assistant", content: finalMessage || "Done." });
      const tools = env.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
      lines.push(JSON.stringify({ id: `${scenario.id}__s${seed}`, scenario: scenario.id, seed, messages, tools }));
    }
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, lines.join("\n") + "\n");
  console.log(`${lines.length} example(s) from seeds ${seeds[0]}..${seeds.at(-1)} (${skipped} below 100 skipped) -> ${out}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
