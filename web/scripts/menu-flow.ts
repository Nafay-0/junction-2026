/**
 * Planning a dish as the buyer described it, on the test kitchens (Kahvila Sointu, Hotel Lumo), in process on the real
 * catalogue: ideas checked before they are offered, the picked dish in three groups, a correction in words, and for a
 * plan that is not the dish the honest sentence with the ways forward. Prints each step's time.
 *
 *   pnpm tsx scripts/menu-flow.ts [--only kahvila-sointu|hotel-lumo] [--words "..."]
 */
import { loadLocalEnv } from "./lib/env";

loadLocalEnv();
const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const words = arg("--words") ?? "i Have a big lunch coming up next week need to plan a dish for 20 people";

async function main() {
  const { menuKitchen } = await import("@/server/agent/menu/runtime");
  const th = await import("@/server/agent/menu/thread");
  const { dailyUsage } = await import("@/server/limits");
  const { formatEur } = await import("@/core/util");
  for (const slug of ["kahvila-sointu", "hotel-lumo"].filter((s) => !arg("--only") || s === arg("--only"))) {
    const first = await menuKitchen(slug);
    let kitchen = first.kitchen;
    if (!kitchen) {
      await first.rt.accounts.resetTestAccounts("script");
      kitchen = (await menuKitchen(slug)).kitchen;
    }
    console.log(`\n== ${kitchen!.info.name}: "${words}"`);
    let t0 = Date.now();
    const ideas = await th.menuIdeas(slug, words, "Tester (script)", "en");
    console.log(`   ideas (${((Date.now() - t0) / 1000).toFixed(1)} s): ${ideas.say} ${ideas.ask}`);
    for (const i of ideas.ideas) console.log(`     - ${i.name}: ${i.buyable ? "buyable" : `NOT buyable: ${i.missing.map((m) => `${m.ingredient} [${m.code}${m.group ? `: ${m.group}` : ""}]`).join(", ")}`}${i.reason ? ` | ${i.reason}` : ""}`);
    const pick = ideas.ideas.find((i) => /meatball|lihapulla/i.test(i.name)) ?? ideas.ideas[0];
    t0 = Date.now();
    const g = await th.pickIdea(slug, ideas.ideasId, pick.dishId, "Tester (script)", "en", { covers: 20 });
    console.log(`   picked "${pick.name}" (${((Date.now() - t0) / 1000).toFixed(1)} s): ${g.say} ${g.ask}`);
    console.log(`     on hand: ${g.onHand.map((x) => `${x.ingredient} ${x.need ?? ""} (${x.basis})`).join("; ") || "-"}`);
    console.log(`     to order: ${g.toOrder.map((x) => `${x.ingredient} ${x.need ?? ""} -> ${x.packs} × ${x.product} ${formatEur(x.totalCents ?? 0)} ${x.deliveryDate}`).join("; ") || "-"}`);
    console.log(`     cannot get: ${g.cannotGet.map((x) => `${x.ingredient} ${x.need ?? ""} [${x.code}] ${x.words}`).join("; ") || "-"}`);
    console.log(`     total to order ${formatEur(g.totalToOrderCents)}; per cover ${g.perCoverCents === null ? "not given (not the whole dish)" : formatEur(g.perCoverCents)}; complete ${g.complete} (${g.covered}/${g.of}); day ${g.day}`);
    t0 = Date.now();
    const c = await th.changeMenu(slug, g.planId, "we have butter", "Tester (script)", "en");
    console.log(`   "we have butter" (${((Date.now() - t0) / 1000).toFixed(1)} s): ${c.say}`);
    if (!g.complete) {
      t0 = Date.now();
      const inc = await th.incompleteChoices(slug, g.planId, "en", { by: "Tester (script)" });
      console.log(`   not the dish (${((Date.now() - t0) / 1000).toFixed(1)} s): ${inc.say} ${inc.ask}`);
      for (const ch of inc.choices) console.log(`     choice ${ch.kind}: ${ch.words}`);
    }
  }
  console.log(`\nModel spend: ${JSON.stringify(dailyUsage().llm)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
