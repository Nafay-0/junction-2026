import { beforeEach, describe, expect, it } from "vitest";
import { signMandate } from "@/core/mandate";
import type { AgentSession } from "@/core/orders";
import { compareReadings, fieldValues, type Reading } from "@/core/second-reading";
import { clearSecondReadings, rememberSecondReading } from "./agent/second-reading-store";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "./dev-fixtures";
import { buildTrace } from "./ops/trace";
import { safeguards } from "./ops/views";
import { getRuntime, resetRuntime, type Runtime } from "./runtime";

/**
 * The second reading through the running server: the interpreter leaves its record in the store, the intake that opens
 * on the same words picks it up, and the operations trace and safeguards page show it.
 */
let rt: Runtime;
let session: AgentSession;
const TEXT = "I need 100 litres of lactose-free milk";
const first: Reading = { item: { text: "lactose-free milk", attributes: ["lactose_free"], excludedAttributes: [] }, quantity: { amount: 100, unit: "L" }, requiredClaims: [], forbiddenAllergens: [], sameAsLastTime: false };

function remember(text: string, second: Partial<Reading>) {
  const c = compareReadings(first, { ...first, ...second }, { text });
  rememberSecondReading(DEMO_ORG.orgId, text, {
    status: c.agreed ? "agreed" : "differed",
    firstModel: "anthropic:claude-opus-5-5",
    secondModel: "featherless:nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16",
    secondMs: 1300,
    waitedMs: 0,
    differences: c.differences,
    minor: c.minor,
    firstValues: fieldValues(first),
    at: new Date().toISOString(),
  });
}

beforeEach(async () => {
  resetRuntime();
  clearSecondReadings();
  rt = await getRuntime();
  session = await rt.dock.authenticate(await signMandate(demoMandate(new Date()), await demoOrgKeyPair()), DEMO_ORG.agentId);
});

const open = (text: string) => rt.dock.intake.open(session, { need: { text, item: { text: "lactose-free milk", category: "milk", attributes: ["lactose_free"] }, quantity: { amount: 100, unit: "L" } } });

describe("the second reading through the server", () => {
  it("a disagreement is asked in the intake, shown in the trace, and counted on the safeguards page", async () => {
    remember(TEXT, { quantity: { amount: 1000, unit: "L" } });
    const step = await open(TEXT);
    expect(step.concerns[0]).toMatchObject({ code: "readings_differ" });
    const trace = buildTrace({ requestId: step.requestId, entries: rt.dock.ledger.entries() });
    const read = trace.steps.find((s) => s.title.startsWith("Read twice"))!;
    expect(read.title).toBe("Read twice: the readings differ on the amount");
    expect(read.lines[0]).toMatch(/Claude Opus 5\.5 read “100 L”, NVIDIA Nemotron 3 Nano read “1,000 L”/);
    expect(read.facts).toEqual(expect.arrayContaining([{ label: "Second reader", value: "NVIDIA Nemotron 3 Nano" }]));

    await rt.dock.intake.respondToConcerns(session, step.requestId, { by: "Aino", responses: [{ key: step.concerns[0].key, choice: "keep_first" }] });
    remember(`${TEXT} today`, {});
    await open(`${TEXT} today`);
    const s = (await safeguards(rt)).secondReading;
    expect(s).toMatchObject({ agreed: 1, differed: 1, unavailable: 0, settled: { keptFirst: 1, tookSecond: 0, rewrote: 0 }, readers: { first: ["Claude Opus 5.5"], second: ["NVIDIA Nemotron 3 Nano"] } });
    expect(s.recent[0]).toMatchObject({ requestId: step.requestId, fields: ["amount"] });
  });

  it("an agreement is one quiet trace step and no question", async () => {
    remember(TEXT, {});
    const step = await open(TEXT);
    expect(step.concerns.filter((c) => c.code === "readings_differ")).toEqual([]);
    const trace = buildTrace({ requestId: step.requestId, entries: rt.dock.ledger.entries() });
    expect(trace.steps.find((s) => s.title === "Read twice: the two readings agree")).toBeTruthy();
  });
});
