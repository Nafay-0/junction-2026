import { beforeEach, describe, expect, it } from "vitest";
import { resolveKitchen } from "@/server/console-kitchens";
import { resetMemoryService } from "@/server/memory/runtime";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { isStageable, runWatch, setAutoRenew, stageStockOut, standingFor, watchView } from "./service";
import { watchMomentForThread } from "./thread";

/**
 * The two scenarios on the three public test accounts (the kitchens judges sign in to): each has a recurring order the
 * watch learns and one that creeps, staging works for them (never for a restaurant's own account), a staged stock-out
 * is what the kitchen's own intake sees too, and a reset of the test accounts clears it.
 */

const TEST_KITCHENS = ["hotel-lumo", "koulu-metsola", "kahvila-sointu"];

async function kitchen(slug: string) {
  const rt = await getRuntime();
  const k = (await resolveKitchen(slug))!;
  return { rt, k, session: await rt.dock.authenticate(k.mandateToken, k.agentId, { via: "onsite", path: "/test", method: "POST" } as never) };
}

beforeEach(() => {
  resetRuntime();
  resetMemoryService();
  process.env.DOCK_MEMORY_LLM = "off";
  process.env.DOCK_RATE_LIMITS = "off";
});

describe("the watch on the public test accounts", () => {
  it("only demo kitchens and the shared test accounts can be staged", () => {
    expect(isStageable({ kind: "demo" })).toBe(true);
    expect(isStageable({ kind: "visitor" })).toBe(true);
    expect(isStageable({ kind: "account", shared: true })).toBe(true);
    expect(isStageable({ kind: "account" })).toBe(false);
  });

  it.each(TEST_KITCHENS)("%s: a learned weekly pattern and one recurring order that has crept up, from its seed", async (slug) => {
    const { rt, k } = await kitchen(slug);
    expect(k.info.account?.shared).toBe(true);
    const s = await standingFor(rt, k.info.orgId);
    expect(s.length).toBeGreaterThanOrEqual(2);
    expect(s.every((x) => x.basedOn.weeks.length >= 2)).toBe(true);
    const crept = s.filter((x) => x.slots.some((slot) => slot.points.length >= 4)).find((x) => x.drifted);
    expect(crept?.drift.portions?.direction).toBe("up");
    expect((await watchView(rt)).stats).toBeDefined();
    expect((await (await import("./service")).stageableKitchens(rt)).map((x) => x.slug)).toContain(slug);
  });

  it.each(TEST_KITCHENS)("%s: switching auto-renew on for the creeping order holds it and asks", async (slug) => {
    const { rt, k, session } = await kitchen(slug);
    const s = await standingFor(rt, k.info.orgId);
    const crept = s.find((x) => x.drifted && x.next && x.drift.portions)!;
    const a = await setAutoRenew(rt, session, { family: crept.family, on: true, by: "Tester", via: "test" });
    expect(a.renewal?.state).toBe("held");
    const m = (await watchMomentForThread(rt, session, "en", { asked: true }))!;
    expect(m.kind).toBe("renewal_held");
    expect(m.ask).toMatch(/Renew at .+, go back to the usual .+, or skip this week\?/);
  });

  it.each(TEST_KITCHENS)("%s: a staged stock-out is what the watch and the kitchen's own quote both see; nobody else", async (slug) => {
    const { rt, k, session } = await kitchen(slug);
    const usual = (await standingFor(rt, k.info.orgId))[0];
    await stageStockOut(rt, { kitchen: slug, productId: usual.product.productId, by: "Staff Tester" });
    // The conversation looks first when the watch has not looked lately: the moment is there without a run.
    const m = (await watchMomentForThread(rt, session, "en", { asked: true }))!;
    expect(m.kind).toBe("stock_out");
    expect(m.staged).toBe(true);
    expect(m.proof?.simulated).toBe(true);
    // The kitchen asks for the staged product directly: the same answer, staged.
    const req = await rt.dock.openRequest(session, { text: `${usual.product.name}, for the usual day`, productIds: [usual.product.productId] });
    await expect(rt.dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: usual.product.productId, quantity: 1 }] })).rejects.toThrow(/STAGED for the demo/);
    const look = await rt.dock.lookupAvailability(session, { requestId: req.requestId, productIds: [usual.product.productId], includeClaims: true });
    expect(look.unavailable[0].message).toMatch(/^STAGED for the demo/);
    // Another kitchen asking for the same product gets the partner's answer.
    const other = await kitchen("kaari");
    const r2 = await rt.dock.openRequest(other.session, { text: "a check", productIds: [usual.product.productId] });
    const theirs = await rt.dock.lookupAvailability(other.session, { requestId: r2.requestId, productIds: [usual.product.productId] });
    expect(theirs.unavailable.find((u) => /STAGED/.test(u.message))).toBeUndefined();
  });

  it("a reset of the test accounts lifts what was staged for them and switches their auto-renew off", async () => {
    const { rt, k, session } = await kitchen("hotel-lumo");
    const s = await standingFor(rt, k.info.orgId);
    await stageStockOut(rt, { kitchen: "hotel-lumo", productId: s[0].product.productId, by: "Staff Tester" });
    await setAutoRenew(rt, session, { family: s[0].family, on: true, by: "Tester", via: "test", renewNow: false });
    expect((await watchView(rt)).stats).toMatchObject({ staged: 1, autoRenewOn: 1 });
    await rt.accounts.resetTestAccounts("in a test");
    const v = await watchView(rt);
    expect(v.stats).toMatchObject({ staged: 0, autoRenewOn: 0 });
    expect(v.stages[0].liftedBy).toMatch(/test account reset/);
    // The reset kitchen is a fresh organisation: nothing staged over its live answers.
    const fresh = await kitchen("hotel-lumo");
    expect(fresh.k.info.orgId).not.toBe(k.info.orgId);
    const [r] = await runWatch(rt, { kitchens: ["hotel-lumo"], fresh: true });
    expect(r.findings.filter((f) => f.staged)).toEqual([]);
  });
});
