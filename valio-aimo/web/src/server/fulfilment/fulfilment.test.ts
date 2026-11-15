import { beforeEach, describe, expect, it } from "vitest";
import { resolveKitchen } from "@/server/console-kitchens";
import { resetMemoryService } from "@/server/memory/runtime";
import { getRuntime, resetRuntime, type Runtime } from "@/server/runtime";
import { confirmAddress, setAddress, setMailTransport, settled } from "@/server/notify/service";
import { renderMail } from "@/server/notify/render";
import { FakeTransport } from "@/server/notify/transport";
import { ordersPage, opsOrderTimeline } from "@/server/ops/orders-view";
import { orderCard } from "@/server/thread/cards";
import { threadStore } from "@/server/thread/engine";
import { fulfilmentLine } from "@/server/thread/fulfilment";
import type { AgentTurn, OrderCard } from "@/server/thread/types";
import { decideFulfilment, fulfilmentOf } from "./service";

/**
 * The wholesaler's team confirms a placed order for delivery, or says it cannot be delivered: a record on top of the
 * committed order. The order, its price and its signed receipt do not change; the kitchen hears it by mail and in its
 * conversation, and the ledger names the staff member.
 */

async function kaari() {
  const rt = await getRuntime();
  const k = (await resolveKitchen("kaari"))!;
  const session = await rt.dock.authenticate(k.mandateToken, k.agentId, { via: "onsite", path: "/test", method: "POST" } as never);
  return { rt, k, session, ref: { orgId: k.info.orgId, slug: "kaari", name: k.info.name } };
}

let nth = 0;
async function order(rt: Runtime, session: Awaited<ReturnType<typeof kaari>>["session"]) {
  const productId = ["VA-3101", "VA-2301"][nth++ % 2];
  const req = await rt.dock.openRequest(session, { text: `5 packs of ${productId}` });
  await rt.dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId, quantity: 5 }] });
  return rt.dock.placeOrder(session, { requestId: req.requestId });
}

async function flush(rt: Runtime) {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 5));
    await settled(rt);
  }
}

beforeEach(() => {
  nth = 0;
  resetRuntime();
  resetMemoryService();
  process.env.DOCK_MEMORY_LLM = "off";
  process.env.DOCK_RATE_LIMITS = "off";
});

describe("the wholesaler's confirmation", () => {
  it("waits on a placed order, and is recorded once, naming the staff member, without touching the order", async () => {
    const { rt, session } = await kaari();
    const o = await order(rt, session);
    expect(o.status).toBe("committed");
    expect(await fulfilmentOf(rt, o)).toEqual({ state: "waiting" });
    expect(await fulfilmentOf(rt, { ...o, status: "pending_approval" })).toBeUndefined();

    const before = await rt.dock.getOrder(session, o.orderId);
    const f = await decideFulfilment(rt, o, { decision: "confirm", by: "Mira Lehto" });
    expect(f).toMatchObject({ state: "confirmed", by: "Mira Lehto", orderId: o.orderId });
    expect(await fulfilmentOf(rt, o)).toMatchObject({ state: "confirmed", by: "Mira Lehto" });
    // The order, its fixed price and its signed receipt are as they were.
    expect(await rt.dock.getOrder(session, o.orderId)).toEqual(before);

    const e = rt.dock.ledger.entries().filter((x) => x.type === "order" && (x.data as { step?: string }).step === "fulfilment");
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ actor: "staff:Mira Lehto", orderId: o.orderId, data: { decision: "confirmed", by: "Mira Lehto" } });
    expect(e[0].summary).toMatch(/confirmed order .* for delivery, at the fixed price/);

    await expect(decideFulfilment(rt, o, { decision: "refuse", by: "Mira Lehto", reason: "No truck" })).rejects.toMatchObject({ status: 409, code: "already_decided" });
  });

  it("needs a reason to refuse, and only a placed order is decided", async () => {
    const { rt, session } = await kaari();
    const o = await order(rt, session);
    await expect(decideFulfilment(rt, o, { decision: "refuse", by: "Mira Lehto", reason: "  " })).rejects.toMatchObject({ status: 400, code: "reason_required" });
    await expect(decideFulfilment(rt, { ...o, status: "pending_approval" }, { decision: "confirm", by: "Mira Lehto" })).rejects.toMatchObject({ status: 409, code: "order_not_placed" });
    const f = await decideFulfilment(rt, o, { decision: "refuse", by: "Mira Lehto", reason: "The morning truck is full" });
    expect(f).toMatchObject({ state: "refused", reason: "The morning truck is full" });
  });

  it("shows on the operations timeline and in the Orders list, with a count of those waiting", async () => {
    const { rt, session } = await kaari();
    const a = await order(rt, session);
    const b = await order(rt, session);
    let page = await ordersPage(rt, {});
    expect(page.facets.statuses.find((s) => s.id === "to_confirm")?.n).toBe(2);
    expect((await ordersPage(rt, { status: "to_confirm" })).rows.map((r) => r.orderId).sort()).toEqual([a.orderId, b.orderId].sort());

    await decideFulfilment(rt, a, { decision: "confirm", by: "Mira Lehto" });
    page = await ordersPage(rt, {});
    expect(page.facets.statuses.find((s) => s.id === "to_confirm")?.n).toBe(1);
    expect(page.rows.find((r) => r.orderId === a.orderId)?.fulfilment).toBe("confirmed");

    const t = await opsOrderTimeline(rt, a.orderId);
    expect(t?.fulfilment).toMatchObject({ state: "confirmed", by: "Mira Lehto" });
    expect(JSON.stringify(t?.steps)).toMatch(/Confirmed for delivery by Mira Lehto/);
  });

  it("mails the kitchen's confirmed address, and says it in the kitchen's conversation beneath the order", async () => {
    const { rt, session, ref } = await kaari();
    const fake = new FakeTransport();
    setMailTransport(rt, fake);
    await setAddress(rt, ref, "chef.kaari@example.com", { by: "Sanna Koskinen", via: "test", lang: "en" });
    await flush(rt);
    await confirmAddress(rt, /\/mail\/confirm\?t=([\w.-]+)/.exec(fake.sent.at(-1)!.html)![1]);
    const o = await order(rt, session);
    await flush(rt);

    // The order in the conversation, as the agent left it.
    const store = await threadStore();
    const thread = store.get("kaari", ref.orgId);
    const card = orderCard(o);
    store.addTurn(thread, { turnId: "a_test", role: "agent", at: new Date().toISOString(), replyTo: "b_test", status: "done", steps: [], cards: [card], line: "I've ordered it." } as AgentTurn);

    const sent = fake.sent.length;
    await decideFulfilment(rt, o, { decision: "confirm", by: "Mira Lehto" });
    await flush(rt);
    expect(fake.sent.length).toBe(sent + 1);
    expect(fake.sent.at(-1)!.subject).toMatch(/^Your order is confirmed for delivery/);

    const turn = thread.turns.find((x) => x.turnId === "a_test") as AgentTurn;
    expect((turn.cards[0] as OrderCard).fulfilment).toMatchObject({ state: "confirmed" });
    expect(turn.line).toContain("I've ordered it.\nThe wholesaler's team confirmed your order");
  });

  it("is said in three languages, and the mail says why it could not be confirmed", () => {
    const card = { lines: [{ name: "Valio Eila® lactose-free milk drink 1.5 % 1 l" }], deliveryDate: "2026-11-16" } as unknown as OrderCard;
    expect(fulfilmentLine(card, { state: "confirmed" }, "en")).toBe("The wholesaler's team confirmed your order of Valio Eila lactose-free milk drink 1.5 % 1 l for Monday 16 Nov.");
    expect(fulfilmentLine(card, { state: "confirmed" }, "fi")).toMatch(/^Tukkurin tiimi vahvisti tilauksesi/);
    expect(fulfilmentLine(card, { state: "confirmed" }, "sv")).toMatch(/^Grossistens team bekräftade din beställning .* till måndag 16\/11\.$/);
    expect(fulfilmentLine(card, { state: "refused", reason: "the morning truck is full" }, "en")).toMatch(/could not confirm your order .*: the morning truck is full\. Shall I look for another option\?$/);

    for (const lang of ["en", "fi", "sv"] as const) {
      const m = renderMail({ kind: "changed", change: "not_confirmed", kitchen: { orgId: "org_x", slug: "x", name: "Kaari" }, orderId: "ord_1", totalCents: 1234, date: "2026-11-16", reason: "the morning truck is full", links: { order: "https://x/o", store: "https://x/k" } } as never, { lang, maskedTo: "c•••@example.com", stopUrl: "https://x/s", settingsUrl: "https://x/m" } as never);
      expect(m.text).toMatch(/the morning truck is full/i);
      expect(m.subject.length).toBeGreaterThan(5);
    }
  });
});
