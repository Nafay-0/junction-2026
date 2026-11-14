/**
 * The planner's checks on the test kitchens, on whatever catalogue this checkout runs (the tester's three cases):
 *
 *   Metsola school kitchen (no fish):  "kalapuikot ja perunamuusi 120 oppilaalle perjantaiksi"
 *                                      "we need pesto pasta with salmon for 120 kids on thursday"
 *   Hotel Lumo:                        "chocolate cake for 10 portions", then 20
 *
 *   pnpm tsx scripts/menu-checks.ts [--only metsola|lumo]
 *
 * Prints what the conversation gets (thread.ts menuChecks) and the plan's own facts. Model calls: the planner.
 */
import { formatEur } from "@/core/util";
import { loadLocalEnv } from "./lib/env";

loadLocalEnv();
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;

async function main() {
  const { menuKitchen } = await import("@/server/agent/menu/runtime");
  const { menuChecks } = await import("@/server/agent/menu/thread");
  const { dailyUsage } = await import("@/server/limits");
  const { changeMenu } = await import("@/server/agent/menu/thread");
  const show = async (slug: string, words: string, lang: "en" | "fi", covers?: number, change?: string) => {
    let { service, kitchen, rt } = await menuKitchen(slug);
    if (!kitchen) {
      await rt.accounts.resetTestAccounts("script");
      ({ service, kitchen, rt } = await menuKitchen(slug));
    }
    if (!kitchen) throw new Error(`no kitchen ${slug}`);
    console.log(`\n== ${kitchen.info.name}: "${words}"`);
    const first = await service.plan(kitchen, words, "Tester (script)");
    await service.settled(first.record.planId);
    let { record, view } = await service.get(kitchen, first.record.planId);
    const print = async () => {
      const c = await menuChecks(slug, record.planId, lang);
      console.log(`   [${lang}] ${c.say}${c.ask ? ` ${c.ask}` : ""}`);
      console.log(`   dishes: ${record.draft.dishes.map((d) => d.name).join("; ")}; covers ${record.settings.covers}; day ${record.settings.deliverBy}`);
      if (c.refusedDish) console.log(`   refusedDish: ${JSON.stringify(c.refusedDish)}`);
      if (c.instead.length) console.log(`   instead: ${c.instead.map((x) => `${x.name} [${x.ingredients.join(", ")}]`).join(" | ")}`);
      for (const r of c.ruleRefusals) console.log(`   rule refusal: ${r.ingredient}: "${r.rule.text}" (${r.rule.source})`);
      console.log(`   day ${c.day.date}: ${c.day.ok ? "every line makes it" : c.day.lines.filter((l) => !l.ok).map((l) => `${l.ingredient}: ${l.why}`).join("; ")}`);
      for (const x of c.coverage) console.log(`   ${x.dish} / ${x.ingredient}: ${x.status}${x.code ? ` [${x.code}]` : ""} (${x.words.slice(0, 120)})`);
      for (const l of view.lines.filter((x) => x.gross)) console.log(`     ${l.name}: ${l.working}`);
      console.log(`   total ${formatEur(view.totals.totalCents)}; blockers: ${view.totals.blockers.join(" | ") || "none"}`);
      for (const n of record.notes) console.log(`   note: ${n}`);
    };
    await print();
    if (covers) {
      console.log(`   -> covers ${covers}`);
      ({ record, view } = await service.edit(kitchen, record.planId, [{ op: "covers", covers }], "Tester (script)"));
      await print();
    }
    if (change) {
      const c = await changeMenu(slug, record.planId, change, "Tester (script)", lang);
      console.log(`   -> "${change}": ${c.say}`);
      for (const x of c.changed) console.log(`      changed: ${x}`);
      ({ record, view } = await service.get(kitchen, record.planId));
    }
  };
  if (!only || only === "metsola") {
    await show("koulu-metsola", "kalapuikot ja perunamuusi 120 oppilaalle perjantaiksi", "fi");
    await show("koulu-metsola", "we need pesto pasta with salmon for 120 kids on thursday", "en");
  }
  if (!only || only === "lumo") {
    await show("hotel-lumo", "chocolate cake for 10 portions", "en", 20);
    await show("hotel-lumo", "chocolate cake", "en", 10, "make it lactose-free");
  }
  console.log(`\nModel spend this run: ${JSON.stringify(dailyUsage().llm)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
