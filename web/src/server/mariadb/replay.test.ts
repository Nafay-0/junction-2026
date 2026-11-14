import { describe, expect, it } from "vitest";
import { InMemoryOutbox } from "@/core/approval";
import { InMemoryCatalog, MeteredCatalog } from "@/core/catalog";
import { generateEd25519KeyPair } from "@/core/keys";
import { Ledger } from "@/core/ledger";
import { createTrustRegistry, signMandate } from "@/core/mandate";
import { InMemoryDockRepository, createDock } from "@/core/orders";
import { SEED_PRODUCTS, SEED_STOCK } from "@/core/seed";
import { DEMO_ORG, demoMandate } from "../dev-fixtures";
import type { RuleRow } from "./history";
import { differences, judge, mandateRuleValue, reproduces, stateFor, termsDisagree } from "./replay";
import { orderBody } from "./rows";

/**
 * The gate run again on a past order: the real evaluatePolicy, fed the state as of two moments. No database here;
 * the states are built the way the gate_rules view returns them.
 */
async function placed() {
  const t0 = new Date("2026-10-20T07:30:00Z");
  let t = t0.getTime();
  const now = () => new Date(t);
  const org = await generateEd25519KeyPair("org-key");
  const repo = new InMemoryDockRepository();
  const dock = createDock({
    catalog: new MeteredCatalog(new InMemoryCatalog(SEED_PRODUCTS, SEED_STOCK, now)),
    repo,
    ledger: new Ledger(undefined, now),
    trustedIssuers: createTrustRegistry([{ kid: org.kid, orgId: DEMO_ORG.orgId, publicKey: org.publicKey }]),
    wholesalerKey: await generateEd25519KeyPair("w"),
    notifier: new InMemoryOutbox(),
    now,
  });
  const mandate = demoMandate(now(), { perOrderLimitCents: 40_000, forbiddenAllergens: [] });
  const session = await dock.authenticate(await signMandate(mandate, org), DEMO_ORG.agentId);
  const r = await dock.openRequest(session, { text: "500 L lactose-free milk", productIds: ["VA-1010"] });
  t += 60_000;
  const q = await dock.requestQuote(session, { requestId: r.requestId, lines: [{ productId: "VA-1010", quantity: 50 }] });
  const o = await dock.placeOrder(session, { requestId: r.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents })) });
  const full = (await repo.getOrder(o.orderId))!;
  return { body: orderBody(full, await repo.getRequest(r.requestId)), mandate };
}

const row = (area: RuleRow["area"], item: string, value: Record<string, unknown>, extra: Partial<RuleRow> = {}): RuleRow => ({ area, orgId: DEMO_ORG.orgId, item, inForce: true, value, changedBy: "test", since: "2026-10-01T00:00:00.000Z", ...extra });

describe("the gate run again on a past order", () => {
  it("gives the same order different verdicts as of two times, and names the rule that changed", async () => {
    const { body, mandate } = await placed();
    expect(body.recorded.outcome).toBe("needs_human_approval");
    const thenRows = [row("mandate", mandate.agentId, mandateRuleValue(mandate))];
    // Three weeks later the mandate was reissued with a higher limit and a new allergen rule (oat drink is not in this order).
    const later = { ...mandate, mandateId: "mnd_v3", perOrderLimitCents: 100_000, forbiddenAllergens: ["gluten"] };
    const nowRows = [row("mandate", mandate.agentId, mandateRuleValue(later))];

    const then = judge(body, stateFor(thenRows, body, body.createdAt), []);
    const now = judge(body, stateFor(nowRows, body, "2026-11-14T10:00:00Z"), []);
    expect(then.outcome).toBe("needs_human_approval");
    expect(now.outcome).toBe("auto_approve");
    const diff = differences(then, now);
    expect(diff.map((d) => d.rule)).toEqual(["per_order_limit"]);
    expect(diff[0].then?.outcome).toBe("escalate");
    expect(diff[0].at?.reason).toContain("€1,000.00");
    // The replay against the rules of its own moment reproduces what the gate decided then, and the mirrored terms
    // agree with the mandate the order carried. The reissued mandate's new id does not break the quote's binding.
    expect(reproduces(body, then).same).toBe(true);
    expect(termsDisagree(body, thenRows[0])).toEqual([]);
    expect(now.rules.find((r) => r.rule === "quote_binding")?.outcome).toBe("pass");
  });

  it("refuses under a week's spend that leaves no room, and says it is the budget", async () => {
    const { body, mandate } = await placed();
    const full = [row("mandate", mandate.agentId, mandateRuleValue({ ...mandate, perOrderLimitCents: 100_000 })), row("budget", DEMO_ORG.orgId, { committedCents: 180_000, heldCents: 0, weekOrders: [{ orderId: "ord_other", totalCents: 180_000, status: "committed" }], ordersInWeek: 1 })];
    const v = judge(body, stateFor(full, body, "2026-11-14T10:00:00Z"), []);
    expect(v.outcome).toBe("reject");
    expect(v.rules.find((r) => r.rule === "weekly_budget")?.outcome).toBe("fail");
    // The order's own amount in the week's list is not counted against itself.
    const own = [full[0], row("budget", DEMO_ORG.orgId, { committedCents: body.quote.totalCents, heldCents: 0, weekOrders: [{ orderId: body.orderId, totalCents: body.quote.totalCents, status: "committed" }], ordersInWeek: 1 })];
    expect(judge(body, stateFor(own, body, "2026-10-20T08:00:00Z"), []).read.spentCents).toBe(0);
  });

  it("refuses a product on a recall hold, and an agent under suspension at the door", async () => {
    const { body, mandate } = await placed();
    const m = row("mandate", mandate.agentId, mandateRuleValue({ ...mandate, perOrderLimitCents: 100_000 }));
    const hold = row("hold", "hold_1", { productId: "VA-1010", productName: "Milk box", reason: "Recall drill.", noticeUrl: "https://example.org/x", drill: true, status: "held" }, { orgId: "*" });
    const held = judge(body, stateFor([m, hold], body, "2026-10-29T10:00:00Z"), []);
    expect(held.outcome).toBe("reject");
    expect(held.rules.find((r) => r.rule === "recall_hold")).toMatchObject({ outcome: "fail" });
    const lifted = judge(body, stateFor([m, { ...hold, inForce: false }], body, "2026-10-31T10:00:00Z"), []);
    expect(lifted.outcome).toBe("auto_approve");
    expect(differences(held, lifted).map((d) => d.rule)).toEqual(["recall_hold"]);

    const sus = row("suspension", "sus_1", { scope: "agent", target: body.agentId, label: "the agent", reason: "Night calls", status: "active" });
    const door = judge(body, stateFor([m, sus], body, "2026-11-03T01:30:00Z"), []);
    expect(door.outcome).toBe("refused_at_door");
    expect(differences(door, lifted)[0].rule).toBe("operator_suspension");
    // Another kitchen's suspension does not close this one's door.
    expect(judge(body, stateFor([m, { ...sus, value: { ...sus.value, target: "agent_someone_else" } }], body, "2026-11-03T01:30:00Z"), []).door.open).toBe(true);
  });

  it("says plainly when no mandate was in force at the moment asked", async () => {
    const { body } = await placed();
    expect(judge(body, stateFor([], body, "2026-01-01T00:00:00Z"), []).outcome).toBe("no_mandate");
  });
});
