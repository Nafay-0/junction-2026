import { MariaStore } from "@/server/history/maria-store";
import { describe, expect, it } from "vitest";
import { demoMandate } from "../dev-fixtures";
import { connectMaria } from "./client";
import { changesFrom, type RuleRow } from "./history";
import { MariaMirror } from "./mirror";
import { keyOf, mandateRow, planWrites, type Row } from "./rows";
import { mirrorHealth } from "./service";

const written = (rows: Row[]) => new Map(rows.map((r) => [keyOf("gate_mandate", r), r]));

describe("planning the mirror's writes", () => {
  const m1 = demoMandate(new Date("2026-10-20T06:00:00Z"));

  it("re-signing the same terms under a new id is a quiet update, not a change of rule", () => {
    const resigned = demoMandate(new Date("2026-10-21T06:00:00Z")); // new id and window, same terms
    const w = planWrites("gate_mandate", written([mandateRow(m1)]), [mandateRow(resigned)]);
    expect(w).toHaveLength(1);
    expect(w[0].op).toBe("touch");
    expect(w[0].op === "touch" && w[0].cols).toEqual(["mandate_id", "valid_from", "valid_until"]);
  });

  it("a new limit is an UPDATE of the versioned columns (MariaDB keeps the old row), and who signed it travels with it", () => {
    const raised = { ...demoMandate(new Date("2026-11-04T06:00:00Z")), perOrderLimitCents: 150_000 };
    const w = planWrites("gate_mandate", written([mandateRow(m1)]), [mandateRow(raised)]);
    expect(w.map((x) => x.op)).toEqual(["update"]);
    expect(w[0].op === "update" && w[0].cols).toContain("per_order_limit_cents");
    expect(w[0].row.changed_by).toContain(raised.mandateId);
  });

  it("nothing changed: no write at all; a mandate no longer presented is deleted", () => {
    expect(planWrites("gate_mandate", written([mandateRow(m1)]), [mandateRow(m1)])).toEqual([]);
    expect(planWrites("gate_mandate", written([mandateRow(m1)]), []).map((x) => x.op)).toEqual(["delete"]);
  });

  it("orders are never deleted from the mirror; one the app forgot (an in-memory restart) is marked, once", () => {
    const o = { order_id: "ord_1", status: "committed", outcome: "auto_approve", authorised_by: "mandate", total_cents: 100 };
    const w = planWrites("gate_order", new Map([["ord_1", o]]), []);
    expect(w).toMatchObject([{ op: "update", row: { order_id: "ord_1", status: "forgotten" } }]);
    expect(planWrites("gate_order", new Map([["ord_1", { ...o, status: "forgotten" }]]), [])).toEqual([]);
  });

  it("a suspension the app no longer has after a restart is ended, not left in force", () => {
    const prev = { suspension_id: "s1", scope: "agent", target: "a", org_id: "o", label: "A", reason: "r", status: "active", changed_by: "Jussi", change_note: null };
    const w = planWrites("gate_suspension", new Map([["s1", prev]]), []);
    expect(w).toMatchObject([{ op: "update", row: { status: "resumed", changed_by: "no longer in the app's state (it restarted)" } }]);
    expect(planWrites("gate_suspension", new Map([["s1", { ...prev, status: "resumed" }]]), [])).toEqual([]);
  });

  it("a budget that drops with no new order says the window moved on", () => {
    const prev = { org_id: "org", committed_cents: 1000, held_cents: 0, week_orders: [{ orderId: "a" }], orders_in_week: 1, changed_by: "order a, committed" };
    const next = { ...prev, committed_cents: 0, week_orders: [], orders_in_week: 0 };
    const w = planWrites("gate_budget", new Map([["org", prev]]), [next]);
    expect(w[0].row.changed_by).toBe("the 7-day window moved on");
  });
});

describe("from versions to changes", () => {
  const v = (item: string, since: string, until: string | undefined, value: Record<string, unknown>, inForce = true, area: RuleRow["area"] = "mandate"): RuleRow => ({ area, orgId: "o", item, inForce, value, changedBy: `by ${since}`, since, until });
  it("pairs consecutive versions into added, changed and ended, only inside the window", () => {
    const rows = [
      v("agent", "2026-10-01T00:00:00.000Z", "2026-10-10T00:00:00.000Z", { perOrderLimitCents: 40000 }),
      v("agent", "2026-10-10T00:00:00.000Z", undefined, { perOrderLimitCents: 100000 }),
      v("hold", "2026-10-05T00:00:00.000Z", "2026-10-07T00:00:00.000Z", { productId: "X" }, true, "hold"),
      v("hold", "2026-10-07T00:00:00.000Z", undefined, { productId: "X" }, false, "hold"),
      v("rule", "2026-10-03T00:00:00.000Z", "2026-10-08T00:00:00.000Z", { text: "Never nuts" }, true, "kitchen_rule"),
    ];
    const c = changesFrom(rows, "2026-10-02T00:00:00.000Z", "2026-11-01T00:00:00.000Z");
    expect(c.map((x) => `${x.area}:${x.kind}`)).toEqual(["kitchen_rule:added", "hold:added", "hold:ended", "kitchen_rule:ended", "mandate:changed"]);
    expect(c.at(-1)!.fields).toEqual([{ field: "perOrderLimitCents", before: 40000, after: 100000 }]);
    expect(c.find((x) => x.area === "hold" && x.kind === "ended")!.by).toBe("by 2026-10-07T00:00:00.000Z");
    expect(changesFrom(rows, "2026-10-11T00:00:00.000Z", "2026-11-01T00:00:00.000Z")).toEqual([]);
  });
});

describe("the mirror is never in the path of an order", () => {
  it("a poke with MariaDB unreachable returns at once, and the status says it is failing", async () => {
    const db = connectMaria("mariadb://dock:dock@127.0.0.1:1/dock_audit", { connections: 1, timeoutMs: 300 });
    const mirror = new MariaMirror({ store: new MariaStore(db), writer: "test", intervalMs: 0, debounceMs: 1, read: async () => ({ now: new Date(), mandates: [], orders: [], requests: new Map(), unverified: new Map(), kitchens: [], holds: [], suspensions: [] }) });
    const t0 = performance.now();
    mirror.poke();
    expect(performance.now() - t0).toBeLessThan(5);
    await expect(mirror.sync()).rejects.toBeTruthy();
    expect(mirrorHealth(mirror.status()).state).toBe("failing");
    await mirror.stop();
    await db.close().catch(() => undefined);
  });
});

describe("suspensions as the ledger records them", () => {
  it("rebuilds the registry's suspensions, resumes included, from the control entries", async () => {
    const { createTestDock } = await import("../aiven/test-dock");
    const { SuspensionRegistry } = await import("../ops/suspensions");
    const { suspensionsFromLedger } = await import("./attach");
    const { dock } = await createTestDock();
    const reg = new SuspensionRegistry(dock);
    const a = reg.suspend({ scope: "agent", target: "agent_x", label: "X", reason: "Night calls", by: "Jussi" });
    reg.suspend({ scope: "org", target: "org_y", label: "Y", reason: "Unpaid", by: "Leena" });
    reg.resume(a.suspensionId, { by: "Jussi", note: "Checked" });
    const pick = (s: { suspensionId: string; scope: string; target: string; reason: string; by: string; resumedBy?: string; resumeNote?: string }) => ({ id: s.suspensionId, scope: s.scope, target: s.target, reason: s.reason, by: s.by, resumedBy: s.resumedBy, note: s.resumeNote });
    expect(suspensionsFromLedger(dock.ledger.entries()).map(pick)).toEqual(reg.all().map(pick));
  });
});
