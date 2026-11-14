import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildOrderTimeline, type OrderSource } from "./order-timeline";
import { ordersPage } from "./orders-view";
import { placeOneOfEach, SOURCES, type SourceName } from "./order-sources.test-support";

/**
 * Nothing missing: one order from every source on one test dock (no network, no model), each in the operations list
 * with its source, and each with a complete timeline: the steps every order has, the steps its source adds, in ledger
 * order, every one with an actor. The kitchen's view holds the same steps.
 */
let placed: Awaited<ReturnType<typeof placeOneOfEach>>;
const env = { ...process.env };
beforeAll(async () => {
  placed = await placeOneOfEach();
}, 120_000);
afterAll(() => {
  process.env = { ...env };
});

const EXPECTED_SOURCE: Record<SourceName, OrderSource> = {
  conversation: "conversation",
  voice: "voice",
  photo: "photo",
  mcp: "mcp",
  rest: "rest",
  aiven_agent: "aiven_agent",
  watch_renewal: "watch_renewal",
  watch_substitute: "watch_substitute",
  offer: "offer",
  backup: "backup",
  presenter: "presenter",
};

/** What each source must add to the common steps: [ledger type, a word of its step] or a check on the steps. */
const SOURCE_STEPS: Partial<Record<SourceName, (t: ReturnType<typeof buildOrderTimeline>) => string | undefined>> = {
  conversation: (t) => (t.steps.some((s) => s.phase === "conversation" && s.person && /buyer/i.test(s.title)) ? undefined : "the buyer's words in the conversation"),
  voice: (t) => (t.steps.some((s) => s.phase === "conversation" && /voice/.test(s.title)) ? undefined : "the buyer's turn by voice"),
  photo: (t) => (t.steps.some((s) => s.ledger.type === "request") && t.door === "photo" ? undefined : "the photo door"),
  watch_renewal: (t) => (t.steps.some((s) => s.ledger.type === "watch" && s.agentChoice) ? undefined : "the watch's renewal, as the agent's own choice"),
  watch_substitute: (t) => (t.steps.some((s) => s.ledger.type === "watch" && /instead of/.test(s.title)) ? undefined : "the substitute the watch chose"),
  backup: (t) => (t.steps.some((s) => s.ledger.type === "watch" && /backup/i.test(s.title)) ? undefined : "the backup used"),
  offer: (t) => (t.steps.some((s) => s.ledger.type === "offer" && s.person) ? undefined : "the buyer accepting the offer"),
  presenter: (t) => (t.steps.some((s) => s.phase === "asked" && s.person && /demo order/.test(s.title)) ? undefined : "who asked for the demo order"),
};

describe("every order from every source, with a complete timeline", () => {
  it("lists all eleven in the operations list with their source", async () => {
    const page = await ordersPage(placed.rt, { size: 200 });
    for (const source of SOURCES) {
      const row = page.rows.find((r) => r.orderId === placed.orders[source].orderId);
      expect(row, source).toBeDefined();
      expect(row!.source, source).toBe(EXPECTED_SOURCE[source]);
      expect(row!.decided.words, source).toBeTruthy();
    }
  });

  it.each(SOURCES)("%s: every step present, in order, none without an actor", async (source) => {
    const { rt, orders, errors } = placed;
    expect(errors[source], errors[source]).toBeUndefined();
    const order = (await rt.dock.listOrders()).find((o) => o.orderId === orders[source].orderId)!;
    const t = buildOrderTimeline({ order, ledger: rt.dock.ledger.readonly(), viewer: "ops" });
    expect(t.source).toBe(EXPECTED_SOURCE[source]);
    expect(t.complete, `${source}: ${t.complete.missing.join(", ")}`).toEqual({ ok: true, missing: [] });
    expect(SOURCE_STEPS[source]?.(t), source).toBeUndefined();
    const seqs = t.steps.map((s) => s.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    for (const s of t.steps) {
      expect(s.actor.name, `${source} #${s.seq}`).toBeTruthy();
      expect(s.title, `${source} #${s.seq}`).toBeTruthy();
    }
    // The order's own steps come in the order an order lives: asked, quoted, decided, then signed off or placed.
    const firstOf = (type: string) => t.steps.findIndex((s) => s.ledger.type === type);
    expect(firstOf("request")).toBeLessThan(firstOf("quote"));
    expect(firstOf("quote")).toBeLessThan(firstOf("decision"));
    if (order.status === "committed") expect(firstOf("decision")).toBeLessThan(firstOf("order"));
    // The kitchen reads the same steps of its own order (with its own memory in full).
    const mine = buildOrderTimeline({ order, ledger: rt.dock.ledger.readonly(), viewer: "buyer" });
    expect(mine.steps.map((s) => s.seq)).toEqual(seqs);
  });
});
