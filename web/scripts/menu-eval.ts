/**
 * The menu planner's evaluation, live: each request of the set goes to the model and through the whole plan
 * against the real catalogue and the partner's live API (a few batched calls per case), then the same checks as
 * the recorded tests. Opt-in: it spends money (about 6 to 10 cents a case with Sonnet 5.5).
 *
 *   pnpm menu:eval                       all cases
 *   pnpm menu:eval --case salmon-soup    one case
 *   pnpm menu:eval --record              also save the model outputs as the recordings the tests replay
 */
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flag, loadLocalEnv } from "./lib/agent-cli";

loadLocalEnv();

async function main() {
  const args = process.argv.slice(2);
  const only = flag(args, "--case");
  const doRecord = args.includes("--record");
  const { CASES, invariants } = await import("../src/server/agent/menu/eval/cases");
  const { menuKitchen, menuMode } = await import("../src/server/agent/menu/runtime");
  const { resetRuntime } = await import("../src/server/runtime");
  const { localNow } = await import("../src/core/kitchen");
  const { formatEur } = await import("../src/core/util");
  if (menuMode() !== "model") throw new Error("No model configured: set ANTHROPIC_API_KEY (or DOCK_MENU_MODEL).");
  const dir = path.join(process.cwd(), "src/server/agent/menu/eval/recorded");
  let spent = 0;
  const failures: string[] = [];
  for (const c of CASES.filter((x) => !only || x.id === only)) {
    resetRuntime(); // a fresh runtime per case: its own live allowance, no orders left from the case before
    const { service, kitchen, rt } = await menuKitchen(c.kitchen);
    if (!kitchen) throw new Error(`no kitchen ${c.kitchen}`);
    const t0 = Date.now();
    const first = await service.plan(kitchen, c.text, "evaluation");
    const firstMs = Date.now() - t0;
    await service.settled(first.record.planId);
    const { record, view } = await service.get(kitchen, first.record.planId);
    const today = localNow(new Date(record.createdAt)).date;
    const checks = [...c.expect(record.draft, today), ...(record.state === "planned" ? [...invariants(view, record.draft, { forbidden: kitchen.mandate.forbiddenAllergens }), ...(c.plan?.(view, record.draft) ?? [])] : [])];
    spent += record.model.costUsd ?? 0;
    const bad = checks.filter((x) => !x.ok);
    console.log(`\n## ${c.id} (${c.covers}) [${rt.catalogSource.kind}]  ${bad.length ? `${bad.length} of ${checks.length} checks FAILED` : `all ${checks.length} checks passed`}`);
    console.log(`   "${c.text.replace(/\n/g, " / ")}"`);
    console.log(
      `   plan on screen in ${(firstMs / 1000).toFixed(1)} s (model ${(record.timings.draftMs / 1000).toFixed(1)} s, catalogue ${(record.timings.matchMs / 1000).toFixed(1)} s, live ${(record.timings.liveMs / 1000).toFixed(1)} s), proposals +${(record.timings.fixMs / 1000).toFixed(1)} s; ${record.liveUse.calls} live calls / ${record.liveUse.products} products; $${(record.model.costUsd ?? 0).toFixed(3)}`,
    );
    if (record.state === "declined") console.log(`   declined: ${record.declineReason}`);
    for (const d of record.draft.dishes) console.log(`   dish: ${d.name} (${d.course}${d.serviceDate ? `, ${d.serviceDate}` : ""}): ${d.ingredients.map((i) => `${i.key} ${i.perCover.amount}${i.perCover.unit}`).join(", ")}`);
    for (const l of view.lines.filter((x) => x.status !== "struck")) {
      console.log(`   - [${l.status}] ${l.name}: ${l.working}${l.chosen ? ` -> ${l.chosen.products.map((p) => `${p.packText} ${p.name}`).join(" + ")} ${formatEur(l.chosen.totalCents)}` : ""}`);
      for (const d of l.doubts.filter((x) => !x.accepted)) console.log(`       ! ${d.kind}: ${d.text.slice(0, 200)}`);
      for (const f of l.fixes) console.log(`       ~ ${f.kind}: ${f.title}: ${f.check?.ok ? `${f.check.product} ${formatEur(f.check.totalCents)}` : `not offered (${f.check && !f.check.ok ? f.check.reason.slice(0, 120) : "unchecked"})`}`);
    }
    console.log(`   total ${formatEur(view.totals.totalCents)}, ${view.totals.lines} lines, ${view.totals.openDoubts} open decisions${view.totals.signOff.needed ? `, sign-off: ${view.totals.signOff.approver?.name}` : ""}${view.totals.blockers.length ? `; blockers: ${view.totals.blockers.join(" ")}` : ""}`);
    if (record.draft.corrections.length) console.log(`   code corrected: ${record.draft.corrections.join(" | ")}`);
    for (const b of bad) {
      console.log(`   FAILED ${b.name}: ${b.detail ?? ""}`);
      failures.push(`${c.id}: ${b.name} (${b.detail ?? ""})`);
    }
    if (doRecord) {
      const rec = { id: c.id, kitchen: c.kitchen, text: c.text, now: record.createdAt, model: record.model.id, ms: record.model.ms, costUsd: record.model.costUsd, calls: record.model.calls, raw: record.raw.draft, fixes: record.raw.fixes };
      writeFileSync(path.join(dir, `${c.id}.json`), `${JSON.stringify(rec, null, 1)}\n`);
    }
  }
  if (doRecord) {
    const ids = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => f.replace(/\.json$/, ""));
    const v = (id: string) => id.replace(/[^a-z0-9]+(.)/g, (_, ch: string) => ch.toUpperCase());
    writeFileSync(
      path.join(dir, "index.ts"),
      `// Generated by \`pnpm menu:eval --record\`. Recorded model outputs for the evaluation set (model text only, no catalogue data).\nimport type { Recording } from "../../recorded";\n${ids.map((id) => `import ${v(id)} from "./${id}.json";`).join("\n")}\n\nexport const RECORDINGS: Recording[] = [${ids.map((id) => `${v(id)} as Recording`).join(", ")}];\n`,
    );
  }
  console.log(`\n${failures.length ? `${failures.length} failed checks:\n  ${failures.join("\n  ")}` : "All checks passed."}\nModel spend: $${spent.toFixed(3)}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
