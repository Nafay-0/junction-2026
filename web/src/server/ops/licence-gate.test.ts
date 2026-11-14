import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dockRunnerHarness } from "@/crash/harness";
import { SUITE_VERSION } from "@/crash/scenarios";
import { signMandate } from "@/core/mandate";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "../dev-fixtures";
import { localFetch } from "../local-transport";
import { getRuntime, resetRuntime } from "../runtime";
import { LICENCE_MAX_AGE_DAYS, LICENCE_RULE, resolveLicence, type LicenceBinding } from "./licence-gate";
import type { LicenceRecord } from "./licences";

const BASE = "http://dock.test";
const MODEL = "anthropic:claude-test-1";
let mandate: string;
let dir: string;
const saved: Record<string, string | undefined> = {};
const ENV = ["DOCK_LICENCE_ENFORCE", "DOCK_LICENCES_FILE", "DOCK_LICENCE_BINDINGS", "DOCK_AGENT_MODEL"];

async function agent(method: string, p: string, body?: unknown) {
  const res = await localFetch(new Request(BASE + p, { method, headers: { "content-type": "application/json", authorization: `Mandate ${mandate}`, "dock-agent-id": DEMO_ORG.agentId }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}

/** Request -> quote -> order for `quantity` cases of VA-1010; returns the order response. */
async function order(quantity: number) {
  const r = await agent("POST", "/api/v1/requests", { text: "milk", neededBy: "2099-01-01" });
  const requestId = r.body.request.requestId as string;
  const q = await agent("POST", "/api/v1/quotes", { requestId, lines: [{ productId: "VA-1010", quantity }] });
  expect(q.status).toBe(201);
  const lines = q.body.quote.lines.map((l: { productId: string; quantity: number; unitPriceCents: number }) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents }));
  return agent("POST", "/api/v1/orders", { requestId, quoteToken: q.body.quoteToken, lines });
}

function licence(over: Partial<LicenceRecord> = {}): LicenceRecord {
  return { agentId: `model:${MODEL}`, crashAgent: `model:${MODEL}`, model: MODEL, harness: dockRunnerHarness().id, level: "L1", name: "Supervised", rating: 71.2, perOrderLimitCents: 25_000, substitution: "needs_approval", ratedAt: new Date().toISOString(), suite: SUITE_VERSION, ...over };
}

function files(records: LicenceRecord[], bindings: LicenceBinding[]) {
  writeFileSync(process.env.DOCK_LICENCES_FILE!, JSON.stringify({ licences: records }));
  writeFileSync(process.env.DOCK_LICENCE_BINDINGS!, JSON.stringify({ bindings }));
}

const ownBinding: LicenceBinding = { agentId: DEMO_ORG.agentId, crashAgent: "own", harness: "own", boundBy: "ops:test", boundAt: new Date().toISOString() };

beforeEach(async () => {
  for (const k of ENV) saved[k] = process.env[k];
  dir = mkdtempSync(path.join(tmpdir(), "dock-licence-"));
  process.env.DOCK_LICENCES_FILE = path.join(dir, "licences.json");
  process.env.DOCK_LICENCE_BINDINGS = path.join(dir, "bindings.json");
  delete process.env.DOCK_LICENCE_ENFORCE;
  process.env.DOCK_AGENT_MODEL = MODEL;
  resetRuntime();
  mandate = await signMandate(demoMandate(new Date()), await demoOrgKeyPair());
});

afterEach(() => {
  for (const k of ENV) if (saved[k] === undefined) delete process.env[k];
  else process.env[k] = saved[k];
  rmSync(dir, { recursive: true, force: true });
});

describe("crash-test licence at the gate", () => {
  it("is off by default: the demo kitchen's mandate alone decides", async () => {
    files([licence({ level: "L0", name: "Learner", perOrderLimitCents: 0 })], [ownBinding]);
    const placed = await order(2);
    expect(placed.status).toBe(201);
    expect(placed.body.order.status).toBe("committed");
    expect(placed.body.order.licence).toBeUndefined();
  });

  it("treats an agent with no licence at L0: every order goes to a person, and the answer and the ledger say why", async () => {
    process.env.DOCK_LICENCE_ENFORCE = "on";
    files([], []);
    const placed = await order(2);
    expect(placed.status).toBe(202);
    expect(placed.body.order.status).toBe("pending_approval");
    expect(placed.body.order.licence).toMatchObject({ level: "L0", basis: "unlicensed", limitFrom: "licence", appliedLimitCents: 0, mandateLimitCents: 100_000, decisive: true });
    expect(placed.body.order.licence.why).toMatch(/no crash-test licence is bound/);
    expect(placed.body.order.decision.reasons.join(" ")).toMatch(/crash-test licence \(L0 Learner\).*mandate allows €1,000/);
    const entry = (await getRuntime()).dock.ledger.entries().find((e) => e.data?.rule === LICENCE_RULE);
    expect(entry?.summary).toMatch(/because of the agent's crash-test licence, not its mandate/);
  });

  it("applies the stricter of mandate and licence for a bound agent: small orders alone, larger ones to a person", async () => {
    process.env.DOCK_LICENCE_ENFORCE = "on";
    files([licence()], [ownBinding]);
    const small = await order(2);
    expect(small.status).toBe(201);
    expect(small.body.order.licence).toMatchObject({ level: "L1", basis: "licensed", appliedLimitCents: 25_000, decisive: false });

    const bigger = await order(40); // over EUR 250, within the mandate's EUR 1,000
    expect(bigger.body.order.totalCents).toBeGreaterThan(25_000);
    expect(bigger.body.order.totalCents).toBeLessThanOrEqual(100_000);
    expect(bigger.status).toBe(202);
    expect(bigger.body.order.licence).toMatchObject({ level: "L1", limitFrom: "licence", decisive: true, crashAgent: `model:${MODEL}` });
    expect(bigger.body.order.decision.reasons.join(" ")).toMatch(/€250\.00 per order from the crash-test licence \(L1 Supervised\)/);
  });

  it("does not let a licence raise the mandate: the mandate's own limit stays the line when it is lower", async () => {
    process.env.DOCK_LICENCE_ENFORCE = "on";
    files([licence({ level: "L3", name: "Autonomous", perOrderLimitCents: 250_000 })], [ownBinding]);
    const placed = await order(2);
    expect(placed.body.order.licence).toMatchObject({ level: "L3", limitFrom: "mandate", appliedLimitCents: 100_000 });
  });

  it("honours a licence only for the harness, suite and age it was earned with", async () => {
    const at = { agentId: DEMO_ORG.agentId, orgId: DEMO_ORG.orgId };
    const records = (r: LicenceRecord) => (name: string) => (name === r.crashAgent ? r : undefined);
    const env = { DOCK_AGENT_MODEL: MODEL };
    expect(resolveLicence(at, { bindings: [ownBinding], records: records(licence()), env }).record?.level).toBe("L1");
    expect(resolveLicence(at, { bindings: [ownBinding], records: records(licence({ harness: "dock-runner@000000000000" })), env })).toMatchObject({ why: expect.stringMatching(/harness/) });
    expect(resolveLicence(at, { bindings: [ownBinding], records: records(licence({ suite: "crash-suite/0" })), env })).toMatchObject({ why: expect.stringMatching(/suite/) });
    const old = new Date(Date.now() - (LICENCE_MAX_AGE_DAYS + 1) * 86_400_000).toISOString();
    expect(resolveLicence(at, { bindings: [ownBinding], records: records(licence({ ratedAt: old })), env })).toMatchObject({ why: expect.stringMatching(/older than/) });
    // Another organisation's agent with the same id is not bound; nor is anyone when the server runs another model.
    expect(resolveLicence({ ...at, orgId: "org_other" }, { bindings: [{ ...ownBinding, orgId: DEMO_ORG.orgId }], records: records(licence()), env }).record).toBeUndefined();
    expect(resolveLicence(at, { bindings: [ownBinding], records: records(licence()), env: { DOCK_AGENT_MODEL: "openai:other" } }).record).toBeUndefined();
    // An explicit binding to a crash agent works the same way, and must name the harness the licence was earned in.
    const explicit = { ...ownBinding, crashAgent: `model:${MODEL}`, harness: dockRunnerHarness().id };
    expect(resolveLicence(at, { bindings: [explicit], records: records(licence()) }).record?.level).toBe("L1");
  });
});
