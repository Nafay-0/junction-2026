import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addDaysIso, localNow } from "@/core/kitchen";
import { resolveKitchen } from "@/server/console-kitchens";
import { resetMemoryService } from "@/server/memory/runtime";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { runWatch, stageStockOut, watchView } from "../watch/service";
import { watchMomentForThread } from "../watch/thread";
import { backupEvents, deliveryRecordsFor, offerBackups } from "./service";
import { answerBackup, backupAnswerOf, backupMomentForThread } from "./thread";

/**
 * A backup "in case it is not delivered", end to end on the seed catalogue: Kaari orders the seed's 1.5 l Arla milk
 * (its delivery record: 0.88, "about 19 times in 20"); the agent offers a backup; "you choose" lines up the best inside
 * the kitchen's preferences, buying nothing; the product is then staged out of stock and the watch orders the backup by
 * itself and reports it, with no second question.
 */

const POOR = "JP-3010"; // the seed's 1 l lactose-free milk, deliveryReliability 0.93: poor under this test's 0.95 line
const GOOD = "VA-1001"; // 0.99: never flagged

async function kaari() {
  const rt = await getRuntime();
  const k = (await resolveKitchen("kaari"))!;
  return { rt, k, session: await rt.dock.authenticate(k.mandateToken, k.agentId, { via: "onsite", path: "/test", method: "POST" } as never) };
}

async function order(productId: string, packs: number) {
  const { rt, session } = await kaari();
  const day = addDaysIso(localNow(new Date()).date, 3);
  const req = await rt.dock.openRequest(session, { text: `${packs} packs of ${productId}`, neededBy: day, productIds: [productId] });
  const q = await rt.dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId, quantity: packs }] });
  return rt.dock.placeOrder(session, { requestId: req.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId: p, quantity, unitPriceCents }) => ({ productId: p, quantity, unitPriceCents })) });
}

beforeEach(() => {
  resetRuntime();
  resetMemoryService();
  process.env.DOCK_MEMORY_LLM = "off";
  process.env.DOCK_RATE_LIMITS = "off";
  process.env.DOCK_RELIABILITY_WARN = "0.95"; // the seed has few poor records; the real line is 0.90 (core/reliability.ts)
});
afterEach(() => {
  delete process.env.DOCK_RELIABILITY_WARN;
});

describe("a backup in case it is not delivered", () => {
  it("says nothing for a product with a good record", async () => {
    const { rt, session } = await kaari();
    const o = await order(GOOD, 5);
    expect(await backupMomentForThread(rt, session, { orderId: o.orderId })).toBeUndefined();
    expect(await deliveryRecordsFor(rt, session.mandate.issuer.orgId, o.lines)).toEqual([]);
  });

  it("offers one at order time for a poor record, lines it up on 'you choose', and uses it when the product cannot come", async () => {
    const { rt, session } = await kaari();
    const o = await order(POOR, 4);
    const m = (await backupMomentForThread(rt, session, { orderId: o.orderId }, "en"))!;
    expect(m.say).toMatch(/^One thing: the .+ has arrived as ordered about 19 times in 20\.$/);
    expect(m.ask).toMatch(/^Want a backup lined up in case it doesn't come\? The .+ is the closest/);
    expect(m.alternatives.length).toBeGreaterThan(0);
    expect(m.steps.join(" ")).toMatch(/History, not a forecast/);
    const fi = (await backupMomentForThread(rt, session, { orderId: o.orderId }, "fi"))!;
    expect(fi.say).toMatch(/noin 19 kertaa 20:stä/);
    expect(backupAnswerOf(m, "you choose")).toBe("you_choose");
    expect(backupAnswerOf(m, "valitse sinä")).toBe("you_choose");
    expect(backupAnswerOf(m, "no thanks")).toBe("no");
    expect(backupAnswerOf(m, "yes")).toBe("yes");
    if (m.alternatives[1]) expect(backupAnswerOf(m, "the second one")).toBe(`pick:${m.alternatives[1].productId}`);
    // Over MCP and REST the order carries the record (and, once chosen, the backup).
    expect((await deliveryRecordsFor(rt, session.mandate.issuer.orgId, o.lines, { orderId: o.orderId }))[0]).toMatchObject({ productId: POOR, deliveryRecord: { poor: true }, backup: { state: "offered" } });

    const ordersBefore = (await rt.dock.listOrders({ orgId: session.mandate.issuer.orgId })).length;
    const set = await answerBackup(rt, session, m.id, "you_choose", { by: "Sanna Koskinen", via: "test conversation", lang: "en" });
    expect(set.reply).toMatch(/^Done: if the .+ doesn't come, I'll order the .+ instead.*Nothing extra is bought now\.$/);
    expect(set.backup?.chosen).toMatchObject({ how: "you_choose", by: "Sanna Koskinen", insidePreferences: true });
    expect((await rt.dock.listOrders({ orgId: session.mandate.issuer.orgId })).length).toBe(ordersBefore); // nothing bought now

    // The product cannot come (staged): the watch orders the backup by itself and reports it; no question.
    await stageStockOut(rt, { kitchen: "kaari", productId: POOR, by: "Staff Tester" });
    const [r] = await runWatch(rt, { kitchens: ["kaari"], fresh: true });
    const f = r.findings.find((x) => x.product.productId === POOR)!;
    if (!f) throw new Error(JSON.stringify({ note: r.note, keys: r.keys, findings: r.findings.map((x) => x.product.productId) }));
    expect(f.decision).toMatchObject({ via: "backup", productId: set.backup!.chosen!.productId });
    expect(["committed", "pending_approval"]).toContain(f.decision!.status);
    const report = (await watchMomentForThread(rt, session, "en", { asked: true }))!;
    expect(report.kind).toBe("substitute_placed");
    expect(report.facts.backup).toBe(true);
    expect(report.ask).toBeUndefined();
    expect(report.say).toMatch(/so I ordered the backup you lined up/);
    const events = await backupEvents(rt, "1970-01-01");
    expect(events[0]).toMatchObject({ kind: "backup_used", chosenBy: "Sanna Koskinen", staged: true });
    expect(rt.dock.ledger.entries().filter((e) => e.type === "watch").map((e) => e.data?.step)).toEqual(expect.arrayContaining(["backup_offered", "backup_set", "backup_used"]));
    expect((await watchView(rt)).backups[0].state).toBe("used");
    expect(rt.dock.ledger.verify().ok).toBe(true);
  });

  it("no backup wanted: recorded, and the watch then asks as usual", async () => {
    const { rt, session } = await kaari();
    const o = await order(POOR, 4);
    const [b] = await offerBackups(rt, session, { orderId: o.orderId, requestId: o.requestId, lines: o.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents, deliveryDate: l.deliveryDate })) });
    const out = await answerBackup(rt, session, b.backupId, "no", { by: "Sanna", via: "test" });
    expect(out.reply).toBe("Fine, no backup.");
    await stageStockOut(rt, { kitchen: "kaari", productId: POOR, by: "Staff Tester" });
    const [r] = await runWatch(rt, { kitchens: ["kaari"], fresh: true });
    expect(r.findings.find((x) => x.product.productId === POOR)?.state).toBe("open");
  });
});
