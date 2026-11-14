/**
 * Records the memory writer's model proposals for the scripted kitchens and the test interactions, so tests and
 * `pnpm memory:demo` replay real model output without calling a model. Also compares candidate models on the
 * same interactions: latency, cost, how many proposals plain code kept (the rest fail the evidence checks).
 *
 *   pnpm memory:record                          compare the default models, print a table
 *   pnpm memory:record --save                   ...and write src/server/memory/recordings.ts from the first model
 *   pnpm memory:record --models anthropic:claude-haiku-5-5 --save
 *
 * Spends real money: about 20 calls per model at roughly $0.0003 each.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { emptyProfile } from "@/core/kitchen";
import { decide } from "@/server/memory/decide";
import type { Interaction } from "@/server/memory/model";
import { MEMORY_MODEL_DEFAULTS, llmProposer, recordingKey, toCandidate, type LlmProposal } from "@/server/memory/propose";
import { BENCH_KITCHENS } from "@/server/memory/scenarios";
import { TEST_INTERACTIONS } from "@/server/memory/test-interactions";
import { loadLocalEnv } from "./lib/env";

loadLocalEnv();
const args = process.argv.slice(2);
const save = args.includes("--save");
const mi = args.indexOf("--models");
const models = mi >= 0 ? args[mi + 1].split(",") : [...MEMORY_MODEL_DEFAULTS];

const interactions: Interaction[] = [
  ...BENCH_KITCHENS.flatMap((k) =>
    k.steps
      .filter((s) => s.text)
      .map((s, i) => ({ id: `${k.orgId}_${i}`, at: s.at, door: s.door, by: k.person, ...(s.site ? { site: s.site } : {}), segments: [{ id: "s1", source: s.source ?? "buyer", text: s.text! }], events: [] }) as Interaction),
  ),
  ...TEST_INTERACTIONS,
];

async function main() {
  const recordings: Record<string, Record<string, LlmProposal>> = {};
  let total = 0;
  for (const model of models) {
    const propose = llmProposer({ model, timeoutMs: 30_000 });
    recordings[model] = {};
    let ms = 0;
    let cost = 0;
    let proposed = 0;
    let kept = 0;
    let errors = 0;
    for (const it of interactions) {
      const r = await propose({ interaction: it, families: ["milk", "yoghurt", "cream"] });
      if (r.error) {
        errors++;
        console.log(`  ${model} error on "${it.segments[0]?.text.slice(0, 40)}": ${r.error}`);
        continue;
      }
      ms += r.ms;
      cost += r.costUsd ?? 0;
      proposed += r.raw.candidates.length;
      const d = decide(emptyProfile("org_x", "x"), r.raw.candidates.map(toCandidate), it, new Date(it.at));
      kept += d.outcomes.filter((o) => o.action !== "discarded").length;
      const dropped = d.outcomes.filter((o) => o.action === "discarded").map((o) => o.reason);
      console.log(`  ${model.padEnd(30)} ${String(r.ms).padStart(5)} ms  ${r.raw.candidates.map((c) => c.kind).join(",") || "-"}${dropped.length ? `  dropped: ${dropped.join("; ")}` : ""}  | ${it.segments.map((s) => s.text).join(" / ").slice(0, 70)}`);
      recordings[model][recordingKey(it)] = r.raw;
    }
    total += cost;
    console.log(`${model}: ${interactions.length - errors}/${interactions.length} answered, mean ${Math.round(ms / Math.max(1, interactions.length - errors))} ms, ${proposed} proposed, ${kept} kept by code, $${cost.toFixed(4)}\n`);
  }
  console.log(`Total spend: $${total.toFixed(4)}`);
  if (save) {
    const chosen = recordings[models[0]];
    const file = path.resolve("src/server/memory/recordings.ts");
    writeFileSync(
      file,
      `// Recorded by \`pnpm memory:record --save\` from ${models[0]} on ${new Date().toISOString().slice(0, 10)}. Real model output, replayed in tests and the demo.\nimport type { LlmProposal } from "./propose";\n\nexport const RECORDED_MODEL = ${JSON.stringify(models[0])};\n\nexport const RECORDINGS: Record<string, LlmProposal> = ${JSON.stringify(chosen, null, 2)};\n`,
    );
    console.log(`Saved ${Object.keys(chosen).length} recordings to ${path.relative(process.cwd(), file)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
