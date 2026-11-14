/**
 * Three weeks of two kitchens through the real intake, with the kitchen memory on, and the same weeks with it off.
 * Prints what was learned, what was asked once and never again, which anomalies were caught and why, and the
 * before-and-after counts. Replays recorded model output (recordings.ts), so it is free and repeatable;
 * `--live` asks the memory model instead (about $0.01).
 *
 *   pnpm memory:demo           both kitchens
 *   pnpm memory:demo --live    with the live memory model
 */
import { effort, runBench, type Counts, type KitchenRun } from "@/server/memory/bench";
import { itemView } from "@/server/memory/model";
import { llmProposer, recordedProposer } from "@/server/memory/propose";
import { RECORDED_MODEL, RECORDINGS } from "@/server/memory/recordings";
import { BENCH_KITCHENS } from "@/server/memory/scenarios";
import { loadLocalEnv } from "./lib/env";

const live = process.argv.includes("--live");
if (live) loadLocalEnv();
process.env.DOCK_RATE_LIMITS ??= "off";

const say = (s = "") => console.log(s);
const rule = (t: string) => say(`\n${"=".repeat(78)}\n ${t}\n${"=".repeat(78)}`);

function printRun(run: KitchenRun) {
  for (const s of run.steps) {
    say(`\n  ${s.step}`);
    for (const u of s.usage) say(`    memory  ${u}`);
    for (const c of s.concerns) say(`    CHECK   ${c.code}: ${c.message}\n            -> ${c.response}`);
    if (s.ordered) say(`    order   ${s.ordered}`);
    for (const n of s.notes) say(`    note    ${n}`);
    const learned = s.learned?.outcomes.filter((o) => o.action !== "merged" || o.reason.startsWith("confirmed")) ?? [];
    for (const o of learned) say(`    learn   ${o.action.padEnd(12)} ${o.text ?? (o.candidate ? JSON.stringify(o.candidate.fact) : "")}  [${o.reason}]`);
    for (const q of s.questions) say(`    ASKED   ${q}`);
  }
}

async function main() {
  const proposer = live ? llmProposer() : recordedProposer(RECORDINGS);
  say(`Memory model: ${live ? "live" : `recorded output of ${RECORDED_MODEL}`}. Catalogue: synthetic bench products.`);
  const results = await runBench(BENCH_KITCHENS, { proposer });
  for (const r of results) {
    rule(`${r.kitchen}: three weeks with memory ON`);
    printRun(r.on);
    const view = await r.on.memory!.view(r.on.orgId);
    say(`\n  What ${r.kitchen}'s memory holds now (${view.items.length} items):`);
    for (const v of view.items.map((i) => i)) {
      say(`    [${v.strength.padEnd(6)} ${v.status === "active" ? "" : `${v.status} `}${v.audience === "shared" ? "shared " : "PRIVATE"}] ${v.text}  (${v.lastSource ?? ""})`);
    }
    const staff = await r.on.memory!.staffView("Operations desk", [r.on.orgId]);
    const sharedCount = staff.kitchens[0]?.items.length ?? 0;
    say(`  The wholesaler's staff see ${sharedCount} of them; private ones stay with the kitchen.`);
    void itemView;
  }

  rule("Before and after: the same requests with memory off and on");
  const cols = ["remember", "questions", "falseAlarms", "picks", "corrections", "caught", "missed", "unsafe"] as const;
  say(`  ${"".padEnd(24)}      ${cols.map((c) => c.padStart(12)).join("")}  ${"effort".padStart(7)}`);
  const total = { off: Object.fromEntries(cols.map((c) => [c, 0])) as Counts, on: Object.fromEntries(cols.map((c) => [c, 0])) as Counts };
  const row = (name: string, mode: string, c: Counts) => say(`  ${name.padEnd(24)} ${mode.padEnd(4)} ${cols.map((k) => String(c[k]).padStart(12)).join("")}  ${String(effort(c)).padStart(7)}`);
  for (const r of results) {
    for (const mode of ["off", "on"] as const) {
      row(r.kitchen, mode, r[mode].counts);
      for (const k of cols) total[mode][k] += r[mode].counts[k];
    }
  }
  row("both kitchens", "off", total.off);
  row("both kitchens", "on", total.on);
  say("");
  say("  remember: \"should I remember this?\", asked once per thing. questions: asked before options. falseAlarms: checks waved through.");
  say("  picks: cards the buyer had to choose between. corrections: the agent got it wrong and the buyer had to fix it.");
  say("  caught / missed: slips in a request that a check caught or let through. unsafe: a card breaking the kitchen's safety needs.");
  say("  effort = remember + questions + falseAlarms + picks + corrections: every tap beyond saying what is needed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
