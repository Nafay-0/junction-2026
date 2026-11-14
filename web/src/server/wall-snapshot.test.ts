import { beforeEach, describe, expect, it } from "vitest";
import type { LedgerEntry } from "@/core/ledger";
import { resolveKitchen } from "./console-kitchens";
import { liveCheck } from "./kitchen-portal";
import { getRuntime, resetRuntime } from "./runtime";
import { progress, wallSnapshot } from "./wall-snapshot";

beforeEach(() => {
  process.env.DOCK_CATALOG = "seed";
  resetRuntime();
});

const entry = (seq: number, type: LedgerEntry["type"], data: Record<string, unknown>): LedgerEntry => ({ seq, at: `2026-11-14T10:0${seq}:00.000Z`, type, actor: "dock", summary: "", requestId: "req_1", data, prevHash: "", hash: "" });

describe("the wall", () => {
  it("does not show a buyer opening products in the catalogue as a request stuck at 'Checking live prices'", async () => {
    const k = await resolveKitchen("kaari");
    await liveCheck(k!, ["VA-1010"]);
    const rt = await getRuntime();
    expect(rt.dock.ledger.entries().some((e) => e.type === "lookup")).toBe(true);
    const wall = await wallSnapshot(rt);
    expect(wall.feed.filter((f) => /Checking live prices/.test(f.status))).toEqual([]);
  });

  it("says a fixed price ran out when nobody ordered on it, instead of 'Price fixed' for ever", () => {
    const list = [entry(1, "request", { text: "100 L milk" }), entry(2, "quote", { totalCents: 12_900, expiresAt: "2026-11-14T10:30:00.000Z" })];
    expect(progress(list, new Date("2026-11-14T10:10:00.000Z")).status).toMatch(/^Price fixed at/);
    expect(progress(list, new Date("2026-11-14T10:31:00.000Z")).status).toBe("Price ran out; not ordered");
    const decided = [...list, entry(3, "decision", { outcome: "auto_approve", totalCents: 12_900 })];
    expect(progress(decided, new Date("2026-11-14T10:31:00.000Z")).status).toBe("Within the agent's mandate");
  });
});
