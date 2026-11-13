import { describe, expect, it } from "vitest";
import { GENESIS_HASH, Ledger, explain, verifyLedger, type LedgerEntry } from "./ledger";

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
});
