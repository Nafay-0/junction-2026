import { getRuntime } from "@/server/runtime";
import { resolveKitchen } from "@/server/console-kitchens";
import { backupMomentForThread } from "@/server/reliability/thread";
import { addDaysIso, isoWeekday, localNow } from "@/core/kitchen";
import { loadLocalEnv } from "./lib/env";
loadLocalEnv(); process.env.DOCK_WATCH_MINUTES = "0";
(async () => {
  const rt = await getRuntime();
  const ids = (process.env.IDS ?? "").split(",");
  for (const p of await rt.catalog.searchProducts({ ids, limit: 3 })) console.log(p.id, p.name, p.category, p.categoryCode, p.unit, p.packSize, p.deliveryReliability, JSON.stringify(p.attributes), JSON.stringify(p.allergens), JSON.stringify(p.nutrition?.values ?? null));
  for (const slug of (process.env.KITCHENS ?? "hotel-lumo,koulu-metsola,kahvila-sointu").split(",")) {
    const k = (await resolveKitchen(slug))!;
    const session = await rt.dock.authenticate(k.mandateToken, k.agentId, { via: "onsite", path: "/probe", method: "POST" } as never);
    const prof = await rt.kitchens.getProfile(k.info.orgId);
    const today = localNow(new Date()).date;
    let day = addDaysIso(today, Number(process.env.AHEAD ?? 4)); for (let i = 0; i < 7 && !prof!.deliveryWeekdays.includes(isoWeekday(day)); i++) day = addDaysIso(day, 1);
    console.log(`\n${slug} groups ${k.info.mandate.allowedCategories.length} cats; forbid ${k.info.mandate.forbiddenAllergens}; require ${k.info.mandate.requiredAttributes}; day ${day}`);
    for (const id of ids) {
      try {
        const req = await rt.dock.openRequest(session, { text: `probe ${id}`, neededBy: day, productIds: [id] });
        const q = await rt.dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: id, quantity: 2 }] });
        console.log(`  ${id}: quote ${q.policyPreview.outcome} ${q.quote.totalCents} ${q.quote.lines[0].deliveryDate} ${q.policyPreview.outcome === "reject" ? q.policyPreview.reasons.join(" ").slice(0, 200) : ""}`);
        const m = await backupMomentForThread(rt, session, { requestId: req.requestId, lines: q.quote.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents, deliveryDate: l.deliveryDate })) });
        console.log(`     ${m ? `${m.say} ${m.ask} | alts: ${m.alternatives.map((a) => `${a.rank} ${a.name} inside=${a.insidePreferences} gate=${a.gate}`).join("; ")}` : "no moment"}`);
      } catch (err) { console.log(`  ${id}: ${(err as Error).message.slice(0, 200)}`); }
    }
  }
  process.exit(0);
})();
