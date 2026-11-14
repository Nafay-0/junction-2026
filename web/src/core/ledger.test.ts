import { describe, expect, it } from "vitest";
import { GENESIS_HASH, InMemoryLedgerStore, Ledger, explain, verifyLedger, type LedgerEntry } from "./ledger";

const T0 = new Date("2026-11-13T10:00:00.000Z");

function sample(): Ledger {
  let tick = 0;
  const ledger = new Ledger(undefined, () => new Date(T0.getTime() + 1000 * tick++));
  ledger.append({ type: "request", actor: "agent:a1", requestId: "req_1", summary: "Agent a1 asked for 1,000 L of lactose-free milk by Monday.", data: { text: "1000 L lactose-free milk" } });
  ledger.append({ type: "lookup", actor: "agent:a1", requestId: "req_1", summary: "Searched master data: 8 products.", data: { source: "master_data" } });
  ledger.append({ type: "quote", actor: "dock", requestId: "req_1", summary: "Issued quote qt_1 for €1,322.00.", data: { quoteId: "qt_1" } });
  ledger.append({
    type: "decision",
    actor: "dock",
    requestId: "req_1",
    orderId: "ord_1",
    summary: "Needs sign-off from Aino Virtanen.",
    data: { outcome: "needs_human_approval", reasons: ["Over the per-order limit.", "Substitute needs approval."] },
  });
  ledger.append({ type: "order", actor: "dock", requestId: "req_2", orderId: "ord_2", summary: "Committed order ord_2.", data: {} });
  return ledger;
}

const clone = (e: LedgerEntry[]): LedgerEntry[] => JSON.parse(JSON.stringify(e));

describe("ledger", () => {
  it("chains each entry to the previous one", () => {
    const entries = sample().entries();
    expect(entries.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(entries[0].prevHash).toBe(GENESIS_HASH);
    for (let i = 1; i < entries.length; i++) expect(entries[i].prevHash).toBe(entries[i - 1].hash);
    expect(entries[1].at).toBe("2026-11-13T10:00:01.000Z");
  });

  it("verifies an untouched ledger, also after a JSON round trip", () => {
    const ledger = sample();
    expect(ledger.verify()).toMatchObject({ ok: true, length: 5 });
    expect(verifyLedger(clone(ledger.entries()))).toMatchObject({ ok: true, length: 5 });
    expect(verifyLedger([])).toMatchObject({ ok: true, length: 0 });
  });

  it("detects an edited entry", () => {
    const entries = clone(sample().entries());
    (entries[2].data as { quoteId: string }).quoteId = "qt_forged";
    expect(verifyLedger(entries)).toMatchObject({ ok: false, brokenAt: 2, problem: "hash_mismatch" });
  });

  it("detects an edited entry even when the editor recomputes its hash", () => {
    const ledger = sample();
    const entries = clone(ledger.entries());
    entries[1].summary = "Searched nothing.";
    entries[1].hash = Ledger.hashOf(entries[1]);
    expect(verifyLedger(entries)).toMatchObject({ ok: false, brokenAt: 2, problem: "chain_break" });
  });

  it("detects a removed entry", () => {
    const entries = clone(sample().entries());
    entries.splice(2, 1);
    expect(verifyLedger(entries)).toMatchObject({ ok: false, brokenAt: 3 });
  });

  it("detects reordered entries", () => {
    const entries = clone(sample().entries());
    [entries[1], entries[2]] = [entries[2], entries[1]];
    expect(verifyLedger(entries).ok).toBe(false);
  });

  it("detects a removed first entry", () => {
    const entries = clone(sample().entries()).slice(1);
    expect(verifyLedger(entries)).toMatchObject({ ok: false, brokenAt: 1 });
  });

  it("detects a cut-off tail when checked against a known head", () => {
    const ledger = sample();
    const head = ledger.head()!;
    const entries = clone(ledger.entries()).slice(0, 3);
    expect(verifyLedger(entries).ok).toBe(true); // a chain cannot see its own missing tail...
    expect(verifyLedger(entries, head)).toMatchObject({ ok: false, problem: "head_mismatch" }); // ...an anchor can
    expect(verifyLedger(clone(ledger.entries()), head).ok).toBe(true);
  });

  it("is append-only: callers get copies", () => {
    const ledger = sample();
    const entries = ledger.entries();
    entries[0].summary = "rewritten";
    entries.pop();
    expect(ledger.entries()[0].summary).not.toBe("rewritten");
    expect(ledger.verify()).toMatchObject({ ok: true, length: 5 });
  });

  it("filters by request or order", () => {
    const ledger = sample();
    expect(ledger.entries({ requestId: "req_1" })).toHaveLength(4);
    expect(ledger.entries({ orderId: "ord_2" }).map((e) => e.seq)).toEqual([4]);
  });

  it("renders a plain-language explanation, with the reasons behind decisions", () => {
    const text = explain(sample().entries({ requestId: "req_1" }));
    expect(text[0]).toMatch(/10:00:00.*asked for 1,000 L of lactose-free milk/);
    expect(text.join("\n")).toMatch(/Needs sign-off from Aino Virtanen[\s\S]*Over the per-order limit/);
  });

  it("shares frozen entries with readers that only look, and indexes them by request and order", () => {
    const ledger = sample();
    const all = ledger.readonly();
    expect(all).toHaveLength(5);
    expect(Object.isFrozen(all[3])).toBe(true);
    expect(Object.isFrozen(all[3].data.reasons)).toBe(true);
    expect(() => {
      (all[0] as { summary: string }).summary = "rewritten";
    }).toThrow(TypeError);
    expect(ledger.readonly({ requestId: "req_1" }).map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    expect(ledger.readonly({ orderId: "ord_2" }).map((e) => e.seq)).toEqual([4]);
    expect(ledger.readonly({ requestId: "req_1", orderId: "ord_1" }).map((e) => e.seq)).toEqual([3]);
    expect(ledger.readonly({ requestId: "nope" })).toEqual([]);
    expect(ledger.since(2).map((e) => e.seq)).toEqual([3, 4]);
    expect(ledger.since(-1)).toHaveLength(5);
    expect(ledger.since(4)).toEqual([]);
    // copies stay copies
    const copy = ledger.entries({ requestId: "req_1" });
    copy[0].summary = "changed";
    expect(ledger.readonly()[0].summary).not.toBe("changed");
  });

  it("verifies incrementally, from the head it verified last, with the same answer as a full check", () => {
    const store = new InMemoryLedgerStore();
    const ledger = new Ledger(store);
    expect(ledger.verify()).toMatchObject({ ok: true, length: 0, head: null });
    for (let i = 0; i < 50; i++) {
      ledger.append({ type: "lookup", actor: "dock", requestId: `req_${i % 7}`, summary: `step ${i}`, data: { i } });
      if (i % 9 === 0) expect(ledger.verify()).toEqual(ledger.verifyFull());
    }
    expect(ledger.verify()).toEqual({ ok: true, length: 50, head: ledger.head() });
    expect(ledger.verify(ledger.head()!)).toMatchObject({ ok: true });
    expect(ledger.verify({ seq: 60, hash: "x" })).toMatchObject({ ok: false, problem: "head_mismatch" });
    // An entry put straight into the store (not through append) that breaks the chain is found by the next verify.
    const forged = { ...structuredClone(store.all()[49]), seq: 50, summary: "forged", hash: "f".repeat(64) };
    store.append(forged);
    expect(ledger.verify()).toMatchObject({ ok: false, brokenAt: 50, problem: "chain_break" });
    expect(ledger.verifyFull()).toMatchObject({ ok: false, brokenAt: 50, problem: "chain_break" });
  });

  it("indexes and verifies entries a store held before the ledger opened it", () => {
    const first = sample();
    const store = new InMemoryLedgerStore();
    for (const e of first.entries()) store.append(e);
    const reopened = new Ledger(store);
    expect(reopened.verify()).toMatchObject({ ok: true, length: 5 });
    expect(reopened.readonly({ requestId: "req_1" })).toHaveLength(4);
    reopened.append({ type: "order", actor: "dock", requestId: "req_1", orderId: "ord_1", summary: "Committed." });
    expect(reopened.readonly({ orderId: "ord_1" }).map((e) => e.seq)).toEqual([3, 5]);
    expect(reopened.verify()).toMatchObject({ ok: true, length: 6 });
  });
});
