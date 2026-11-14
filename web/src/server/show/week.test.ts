import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as approvalRoute from "@/app/api/v1/approvals/[approvalId]/route";
import * as challengeRoute from "@/app/api/v1/approvals/[approvalId]/challenge/route";
import * as joinRoute from "@/app/api/v1/join/route";
import * as joinVerifyRoute from "@/app/api/v1/join/verify/route";
import type { DockEvent } from "@/core/events";
import { SoftwareAuthenticator } from "@/core/test-webauthn";
import { getRuntime, resetRuntime } from "../runtime";
import { forgetCast } from "./cast";
import { catalogueLock } from "./lock";
import { activeWeekFor, resetShow, startWeek, stopWeek, weekDone } from "./registry";
import type { WeekRun } from "./types";
import { TEST_PACE } from "./week";

const BASE = "https://dock.test";
// Sunday 15 Nov 2026, 09:00 in Helsinki: the morning of the peer review. Five delivery days ahead (Mon to Fri).
const SUNDAY_MORNING = new Date("2026-11-15T07:00:00Z");
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function request(method: string, path: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return new Request(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

/** A visitor scans the QR code and makes a passkey on their (software) phone. */
async function join() {
  const auth = new SoftwareAuthenticator(BASE);
  const start = (await (await joinRoute.POST(request("POST", "/api/v1/join"))).json()) as Json;
  const res = await joinVerifyRoute.POST(request("POST", "/api/v1/join/verify", { response: auth.register(start.options) }));
  const done = (await res.json()) as Json;
  return { auth, sandbox: done.sandbox as Json, cookie: res.headers.get("set-cookie")!.split(";")[0] };
}

/** The visitor's phone: when a sign-off request arrives for their kitchen, approve (or decline) it with the passkey. */
async function phone(auth: SoftwareAuthenticator, orgId: string, decision: "approve" | "decline" = "approve") {
  const { events } = await getRuntime();
  const signed: string[] = [];
  const off = events.subscribe(
    (e: DockEvent) => e.type === "approval_requested" && e.orgId === orgId,
    (e) => {
      void (async () => {
        const approvalId = e.approvalId!;
        const ch = (await (await challengeRoute.POST(request("POST", `/api/v1/approvals/${approvalId}/challenge`, { decision }), params({ approvalId }))).json()) as Json;
        await approvalRoute.POST(request("POST", `/api/v1/approvals/${approvalId}`, { decision, proof: { kind: "webauthn", response: auth.assert(ch.options) } }), params({ approvalId }));
        signed.push(approvalId);
      })();
    },
  );
  return { signed, off };
}

const step = (run: WeekRun, kind: string) => run.steps.find((s) => s.kind === kind)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: SUNDAY_MORNING });
  resetRuntime();
  resetShow();
  forgetCast();
  delete process.env.DOCK_DEMO_TAP_APPROVAL;
  delete process.env.DOCK_PUBLIC_URL;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a week in a kitchen", () => {
  it("plays every day through the real gate, with the sign-off on the visitor's phone, and cleans up", async () => {
    const { auth, sandbox } = await join();
    const rt = await getRuntime();
    const before = structuredClone(await rt.kitchens.getProfile(sandbox.orgId));
    const { signed, off } = await phone(auth, sandbox.orgId);
    const started = await startWeek(rt, { sandboxId: sandbox.sandboxId, pace: TEST_PACE, signOffTimeoutMs: 20_000 });
    expect(started.kitchen).toMatchObject({ name: sandbox.kitchenName, passkey: true, house: false });
    const run = (await weekDone(started.runId))!;
    off();

    expect(run.state).toBe("finished");
    expect(run.steps.map((s) => [s.kind, s.status])).toEqual([
      ["standing", "done"],
      ["slip", "done"],
      ["stockout", "done"],
      ["lastminute", "done"],
      ["drift", "done"],
      ["refusal", "done"],
    ]);

    // Monday: same as last time, placed by the agent alone.
    expect(step(run, "standing")).toMatchObject({ gate: { outcome: "auto_approve" }, order: { status: "committed" }, askedPerson: 0 });

    // Tuesday: ten times the usual is caught with its reason, the scripted answer is labelled, the usual is ordered.
    const slip = step(run, "slip");
    expect(slip.concern).toMatchObject({ code: "quantity_tenfold", scripted: true });
    expect(slip.concern!.message).toMatch(/600 L where you usually order about \d+ L: did you mean 60 L\?/);
    expect(slip.order).toMatchObject({ status: "committed" });
    expect(slip.order!.lines.reduce((n, l) => n + Number(l.amount.split(" ")[0]), 0)).toBeLessThan(80);

    // Wednesday: the usual product is out of stock (simulated, labelled), alternatives ranked, all lactose-free.
    const out = step(run, "stockout");
    expect(out.simulated).toHaveLength(1);
    expect(out.simulated[0]).toMatch(/^Simulated: /);
    expect(out.excluded.some((e) => e.simulated)).toBe(true);
    expect(out.options.length).toBeGreaterThan(1);
    expect(out.options[0].rank).toBe("best");
    expect(out.order).toMatchObject({ status: "committed" });
    expect(run.simulated).toEqual(out.simulated);
    const ledger = rt.dock.ledger.entries();
    expect(ledger.filter((e) => e.type === ("control" as never) && /SIMULATED/.test(e.summary))).toHaveLength(1);
    expect(ledger.some((e) => /Simulation ended/.test(e.summary))).toBe(true);

    // Thursday: over the limit, stopped at the gate, signed on the phone with the passkey, then committed.
    const gate = step(run, "lastminute");
    expect(gate.gate).toMatchObject({ outcome: "needs_human_approval", rule: "per_order_limit" });
    expect(gate.signOff).toMatchObject({ state: "approved", method: "passkey", verified: true, approverName: sandbox.approverName });
    expect(gate.order).toMatchObject({ status: "committed" });
    expect(signed).toHaveLength(1);

    // Friday: the drifted standing order is queried by the core's standing-order check, renewed at the agreed amount.
    const drift = step(run, "drift");
    expect(drift.concern).toMatchObject({ code: "standing_order_range", scripted: true });
    expect(drift.order).toMatchObject({ status: "committed" });

    // Saturday: refused at the gate with the allergen rule named.
    const refused = step(run, "refusal");
    expect(refused.gate).toMatchObject({ outcome: "reject", rule: "forbidden_allergens" });
    expect(refused.order).toMatchObject({ status: "rejected" });

    expect(run.tally).toMatchObject({ decisions: 9, askedPerson: 3, refused: 1, wrongOrders: 0, committed: 5 });
    expect(rt.dock.ledger.verify().ok).toBe(true);

    // Clean: nothing waits for sign-off, the kitchen's own past is back, no simulation is left.
    const pending = (await rt.dock.listOrders()).filter((o) => o.orgId === sandbox.orgId && o.status === "pending_approval");
    expect(pending).toHaveLength(0);
    expect(await rt.kitchens.getProfile(sandbox.orgId)).toEqual(before);
    const offers = await rt.catalog.getLiveOffers(["VA-1010", "AR-2010"]);
    expect(offers.map((o) => o.availablePacks > 0)).toEqual([true, true]);
  }, 60_000);

  it("withdraws the order when nobody signs in time, and says so", async () => {
    const { sandbox } = await join();
    const rt = await getRuntime();
    const started = await startWeek(rt, { sandboxId: sandbox.sandboxId, pace: TEST_PACE, signOffTimeoutMs: 300 });
    const run = (await weekDone(started.runId))!;
    const gate = step(run, "lastminute");
    expect(gate.signOff).toMatchObject({ state: "timed_out" });
    expect(gate.order).toMatchObject({ status: "withdrawn" });
    expect(gate.did.at(-1)).toMatch(/Nothing was bought without a person/);
    expect(run.state).toBe("finished");
    expect(run.tally.wrongOrders).toBe(0);
  }, 60_000);

  it("runs two visitors' weeks at once without them touching each other", async () => {
    const a = await join();
    const b = await join();
    const rt = await getRuntime();
    const pa = await phone(a.auth, a.sandbox.orgId);
    const pb = await phone(b.auth, b.sandbox.orgId, "decline");
    const [ra, rb] = await Promise.all([
      startWeek(rt, { sandboxId: a.sandbox.sandboxId, pace: TEST_PACE, signOffTimeoutMs: 20_000 }),
      startWeek(rt, { sandboxId: b.sandbox.sandboxId, pace: TEST_PACE, signOffTimeoutMs: 20_000 }),
    ]);
    const [runA, runB] = await Promise.all([weekDone(ra.runId), weekDone(rb.runId)]);
    pa.off();
    pb.off();
    expect(runA!.state).toBe("finished");
    expect(runB!.state).toBe("finished");
    for (const run of [runA!, runB!]) {
      expect(step(run, "stockout").excluded.some((e) => e.simulated)).toBe(true);
      expect(step(run, "standing").order?.status).toBe("committed"); // never saw the other's simulated stock-out
    }
    expect(step(runA!, "lastminute").signOff?.state).toBe("approved");
    expect(step(runB!, "lastminute").signOff?.state).toBe("declined");
    const orgsOf = (run: WeekRun) => new Set(run.steps.flatMap((s) => s.orderIds));
    expect([...orgsOf(runA!)].some((id) => orgsOf(runB!).has(id))).toBe(false);
    expect(catalogueLock().busy).toBe(false);
  }, 90_000);

  it("restarts cleanly: a second start stops the first and the next week still finishes", async () => {
    const { sandbox } = await join();
    const rt = await getRuntime();
    const first = await startWeek(rt, { sandboxId: sandbox.sandboxId, pace: { introMs: 50, beatMs: 50, dwellMs: 200, gateDwellMs: 200 }, signOffTimeoutMs: 300 });
    const second = await startWeek(rt, { sandboxId: sandbox.sandboxId, pace: TEST_PACE, signOffTimeoutMs: 300 });
    const firstRun = (await weekDone(first.runId))!;
    expect(firstRun.state).toBe("cancelled");
    const run = (await weekDone(second.runId))!;
    expect(run.state).toBe("finished");
    expect(step(run, "standing").order?.status).toBe("committed");
    expect(activeWeekFor(sandbox.sandboxId)?.runId).toBe(second.runId);
    expect(await stopWeek("week_nope")).toBeUndefined();
  }, 60_000);

  it("runs in the house kitchen when no phone joined, and its sign-off times out honestly", async () => {
    const rt = await getRuntime();
    const started = await startWeek(rt, { pace: TEST_PACE, signOffTimeoutMs: 200 });
    expect(started.kitchen).toMatchObject({ house: true, passkey: false });
    const run = (await weekDone(started.runId))!;
    expect(step(run, "lastminute").signOff).toMatchObject({ state: "timed_out", phone: false });
  }, 60_000);
});
