import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveKitchen } from "@/server/console-kitchens";
import type { Kitchen } from "@/server/kitchen-portal";
import { DEFAULT_TERMS } from "@/server/accounts/terms";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { SoftwareAuthenticator } from "@/core/test-webauthn";
import { rulesSignOff, rulesSignOffOptions, submitTurn, threadStore } from "./engine";
import { diffOf, groundedChange, isNarrowing, needsSignOff, normaliseChange, snapshotAfter, snapshotOf } from "./rules";
import type { Card, RulesCard, ThreadEvent } from "./types";

/**
 * The rules card (docs/agent-thread.md "Widgets": rules). Plain code works out before and after for each kind of
 * change; a change is signed only by the kitchen's own signed-in person, through the mechanism its kind of kitchen
 * has (narrowing reissue for any kitchen, new terms for an account), and every step is in the ledger.
 */

const ADDR = "198.51.100.9";

async function turn(k: Kitchen | string, body: Record<string, unknown>): Promise<{ cards: Card[]; events: ThreadEvent[] }> {
  const store = await threadStore();
  const slug = typeof k === "string" ? k : k.info.slug;
  const events: ThreadEvent[] = [];
  let id = "";
  const done = new Promise<void>((resolve) => {
    const off = store.subscribe(slug, (e) => {
      events.push(e);
      if (e.type === "status" && e.turnId === id && e.status !== "working") {
        off();
        resolve();
      }
    });
  });
  const reply = await submitTurn(k, body);
  id = reply.agentTurnId;
  await done;
  // A card replaced in place lives in the turn that first showed it: the turn's own cards, then those it replaced.
  const own = store.agentTurn(store.peek(slug)!, id)!.cards;
  const replaced = events.flatMap((e) => (e.type === "card" && e.turnId !== id ? [e.card] : []));
  return { cards: [...own, ...replaced], events };
}

const rulesOf = (cards: Card[]) => cards.find((c): c is RulesCard => c.type === "rules");
const noticeOf = (cards: Card[]) => cards.find((c) => c.type === "notice");

async function accountKitchen(username: string, person: "own" | "none" | "call" | "other" = "own") {
  const rt = await getRuntime();
  await rt.accounts.signUp({ restaurant: `Ravintola ${username}`, username, password: "a-long-password-1" }, ADDR);
  await rt.accounts.signKitchen(username, { ...DEFAULT_TERMS, signer: "Aino Virtanen" });
  const k = (await resolveKitchen(username))!;
  const who = { own: { channel: "portal_session" as const, name: "Aino Virtanen", account: username }, call: { channel: "portal_session" as const, name: "Aino Virtanen", account: username, callOnly: true as const }, other: { channel: "portal_session" as const, name: "Someone", account: "someone-else" }, none: undefined }[person];
  return { rt, k: { ...k, console: { kitchen: username, session: `s_${username}`, ...(who ? { person: who } : {}) } } as Kitchen };
}

const RP = { id: "localhost", name: "AimoPilot", origins: ["http://localhost:3000"] };
/** The kitchen's signer with a passkey on this (software) device, as Agent and rules adds one. */
async function signerDevice(rt: Awaited<ReturnType<typeof getRuntime>>, username: string) {
  const auth = new SoftwareAuthenticator("http://localhost:3000");
  const a = (await rt.accounts.get(username))!;
  await rt.accounts.completeDevice(auth.register(await rt.accounts.beginDevice(a, RP, "session")), { username });
  return auth;
}

const events = (rt: Awaited<ReturnType<typeof getRuntime>>, name: string) => rt.dock.ledger.entries().filter((e) => (e.data as { event?: string; step?: string }).event === name || (e.data as { step?: string }).step === name);

beforeEach(() => {
  resetRuntime();
  process.env.DOCK_MEMORY = "off";
  process.env.DOCK_RATE_LIMITS = "off";
  process.env.DOCK_CATALOG = "seed";
  const g = globalThis as { __dockConsoleTokens?: unknown; __dockMenuTokens?: unknown };
  g.__dockConsoleTokens = g.__dockMenuTokens = undefined;
});
afterEach(() => {
  delete process.env.DOCK_MEMORY;
});

describe("before and after, in plain code, for each kind of change", () => {
  const base = { perOrderLimitCents: 30000, weeklyBudgetCents: 300000, categories: ["milk"], groups: [{ id: "10", name: "Dairy" }], requiredAttributes: [], forbiddenAllergens: [], approvers: [{ name: "Aino", role: "kitchen_signer", maxApprovalCents: 300000 }], maxLeadDays: 7, substitution: "within_preferences" };
  const terms = { ...DEFAULT_TERMS, signer: "Aino" };

  it("a forbidden allergen narrows: only that list moves, nothing widens", () => {
    const c = normaliseChange({ forbidAdd: ["nuts"] });
    expect(isNarrowing(c)).toBe(true);
    const d = diffOf(base, snapshotAfter(base, c, terms));
    expect(d).toEqual([{ field: "forbiddenAllergens", before: "", after: "nuts", widens: false }]);
  });

  it("a required claim narrows, in the buyer's language too", () => {
    const c = normaliseChange({ requireAdd: ["laktoositon"] });
    expect(c).toEqual({ requireAdd: ["lactose_free"] });
    expect(diffOf(base, snapshotAfter(base, c, terms))).toEqual([{ field: "requiredAttributes", before: "", after: "lactose_free", widens: false }]);
  });

  it("raising the per-order limit is a change of terms that widens", () => {
    const c = normaliseChange({ perOrderLimitEur: 800 });
    expect(isNarrowing(c)).toBe(false);
    const d = diffOf(snapshotOf({ perOrderLimitCents: 30000, weeklyBudgetCents: 300000, allowedCategories: [], requiredAttributes: [], forbiddenAllergens: [], approvers: [{ name: "Aino", role: "kitchen_signer", maxApprovalCents: 300000 }], delivery: { maxLeadDays: 7 }, substitution: { rule: "within_preferences" } } as never, terms), snapshotAfter(base, c, terms));
    expect(d.find((x) => x.field === "perOrderLimitEur")).toEqual({ field: "perOrderLimitEur", before: "300", after: "800", widens: true });
  });

  it("lowering the budget narrows; taking a rule away widens; a new signer is shown by name", () => {
    const withNuts = { ...base, forbiddenAllergens: ["nuts"] };
    const t = { ...terms, forbid: ["nuts" as const] };
    expect(diffOf(base, snapshotAfter(base, { weeklyBudgetEur: 2000 }, terms)).find((x) => x.field === "weeklyBudgetEur")).toMatchObject({ before: "3000", after: "2000", widens: false });
    expect(diffOf(withNuts, snapshotAfter(withNuts, { forbidRemove: ["nuts"] }, t))).toContainEqual({ field: "forbiddenAllergens", before: "nuts", after: "", widens: true });
    expect(diffOf(base, snapshotAfter(base, { signer: "Maija Laine" }, terms))).toContainEqual({ field: "signer", before: "Aino", after: "Maija Laine", widens: false });
  });

  it("terms the account page would refuse are refused here too (a per-order limit above the weekly budget)", () => {
    expect(() => snapshotAfter(base, { perOrderLimitEur: 5000 }, terms)).toThrow();
  });

  it("keeps only what the buyer's words carry: an amount they did not write is dropped, not proposed", () => {
    expect(groundedChange({ perOrderLimitEur: 800 }, "raise the limit to 800")).toEqual({ change: { perOrderLimitEur: 800 }, dropped: [] });
    expect(groundedChange({ perOrderLimitEur: 900 }, "raise the limit a bit")).toEqual({ change: {}, dropped: ["perOrderLimitEur 900"] });
    expect(groundedChange({ weeklyBudgetEur: 5000 }, "viikkobudjetti 5 000 euroa")).toEqual({ change: { weeklyBudgetEur: 5000 }, dropped: [] });
    expect(groundedChange({ forbidAdd: ["pähkinä"] }, "ei koskaan pähkinöitä").change).toEqual({ forbidAdd: ["nuts"] });
  });
});

describe("a change is signed only by the kitchen's own person, and recorded", () => {
  it("an account's own session raises its limit: new signed terms, the old mandate replaced, all in the ledger", async () => {
    const { rt, k } = await accountKitchen("aalto");
    const before = (await rt.accounts.kitchenOf("aalto"))!.kitchen.mandate;
    const shown = rulesOf((await turn(k, { via: "tap", action: { type: "rules_propose", change: { perOrderLimitEur: 800 } } })).cards)!;
    expect(shown.proposal).toMatchObject({ kind: "terms", state: "open", canSign: true });
    expect(shown.diff).toContainEqual({ field: "perOrderLimitEur", before: "300", after: "800", widens: true });
    // Proposing signs nothing.
    expect((await rt.accounts.kitchenOf("aalto"))!.kitchen.mandate.mandateId).toBe(before.mandateId);

    // A raise widens what the agent may spend: the signed-in person's confirm sends it to the signer, nothing changes.
    const waiting = rulesOf((await turn(k, { via: "tap", action: { type: "rules_sign", proposalId: shown.proposal!.proposalId } })).cards)!;
    expect(waiting.proposal).toMatchObject({ state: "waiting", approval: { approver: { name: "Aino Virtanen" } } });
    expect((await rt.accounts.kitchenOf("aalto"))!.kitchen.mandate.mandateId).toBe(before.mandateId);
    // The signer's passkey over this exact change signs it.
    await rulesSignOff(k, shown.proposal!.proposalId, { kind: "webauthn", response: (await signerDevice(rt, "aalto")).assert(await rulesSignOffOptions(k, shown.proposal!.proposalId, RP)) });
    const now = (await rt.accounts.kitchenOf("aalto"))!.kitchen.mandate;
    expect(now.mandateId).not.toBe(before.mandateId);
    expect(now.perOrderLimitCents).toBe(80000);
    expect(events(rt, "rules_proposed")).toHaveLength(1);
    expect(events(rt, "rules_signoff_requested")).toHaveLength(1);
    const s = events(rt, "rules_signed");
    expect(s).toHaveLength(1);
    expect(s[0].data).toMatchObject({ by: "Aino Virtanen", mechanism: "account_terms", replaced: before.mandateId, mandateId: now.mandateId, signOff: { method: "passkey", verified: true } });
    expect(rt.dock.ledger.verify().ok).toBe(true);
  });

  it("the widget's confirm proposes and signs a narrowing in one tap, sends a widening to the signer; without a signed-in person it only shows the change", async () => {
    const { rt, k } = await accountKitchen("aaltoone");
    const narrow = rulesOf((await turn(k, { via: "tap", action: { type: "rules_propose", change: { perOrderLimitEur: 200 }, sign: true } })).cards)!;
    expect(narrow.proposal).toMatchObject({ state: "signed" });
    expect((await rt.accounts.kitchenOf("aaltoone"))!.kitchen.mandate.perOrderLimitCents).toBe(20000);
    const two = await accountKitchen("aaltotwo");
    const wide = rulesOf((await turn(two.k, { via: "tap", action: { type: "rules_propose", change: { perOrderLimitEur: 800 }, sign: true } })).cards)!;
    expect(wide.proposal).toMatchObject({ state: "waiting" });
    expect((await rt.accounts.kitchenOf("aaltotwo"))!.kitchen.mandate.perOrderLimitCents).toBe(30000);
    resetRuntime();
    const none = await accountKitchen("aaltonone", "none");
    const shown = rulesOf((await turn(none.k, { via: "tap", action: { type: "rules_propose", change: { perOrderLimitEur: 800 }, sign: true } })).cards)!;
    expect(shown.proposal).toMatchObject({ state: "open", canSign: false });
    expect((await none.rt.accounts.kitchenOf("aaltonone"))!.kitchen.mandate.perOrderLimitCents).not.toBe(80000);
  });

  it("'never mustard' on a built-in demo kitchen: the narrowing reissue, signed by its person", async () => {
    const rt = await getRuntime();
    const base = (await resolveKitchen("kaari"))!;
    const k = { ...base, console: { kitchen: "kaari", session: "s_kaari", person: { channel: "portal_session" as const, name: "Sanna Koskinen", account: "kaari" } } } as Kitchen;
    const shown = rulesOf((await turn(k, { via: "tap", action: { type: "rules_propose", change: { forbidAdd: ["mustard"] } } })).cards)!;
    expect(shown.proposal).toMatchObject({ kind: "narrow", canSign: true });
    expect(shown.editable).toMatchObject({ narrow: true, terms: false, why: "demo_terms_fixed" });
    const signed = rulesOf((await turn(k, { via: "tap", action: { type: "rules_sign", proposalId: shown.proposal!.proposalId } })).cards)!;
    expect(signed.current.forbiddenAllergens).toContain("mustard");
    expect(signed.diff).toEqual([{ field: "forbiddenAllergens", before: "nuts", after: "nuts, mustard", widens: false }]);
    expect((await resolveKitchen("kaari"))!.info.mandate.forbiddenAllergens).toContain("mustard");
    expect(events(rt, "mandate_reissued")).toHaveLength(1);
    expect(events(rt, "rules_signed")[0].data).toMatchObject({ mechanism: "mandate_reissue", by: "Sanna Koskinen" });
  });

  it("a demo kitchen's limit cannot be raised: shown, not signable, refused with the reason", async () => {
    const base = (await resolveKitchen("kaari"))!;
    const k = { ...base, console: { kitchen: "kaari", session: "s_kaari2", person: { channel: "portal_session" as const, name: "Sanna Koskinen", account: "kaari" } } } as Kitchen;
    const shown = rulesOf((await turn(k, { via: "tap", action: { type: "rules_propose", change: { forbidAdd: ["sesame"], perOrderLimitEur: 800 } } })).cards)!;
    expect(shown.proposal).toMatchObject({ kind: "terms", canSign: false, why: "demo_terms_fixed" });
    const r = await turn(k, { via: "tap", action: { type: "rules_sign", proposalId: shown.proposal!.proposalId } });
    expect(noticeOf(r.cards)).toMatchObject({ kind: "refused" });
    expect((await resolveKitchen("kaari"))!.info.mandate.forbiddenAllergens).not.toContain("sesame");
  });

  it("without the kitchen's signed-in person (none, a call-code phone, another account) nothing is signed and the refusal is recorded", async () => {
    for (const who of ["none", "call", "other"] as const) {
      resetRuntime();
      const { rt, k } = await accountKitchen(`kok${who}`, who);
      const before = (await rt.accounts.kitchenOf(`kok${who}`))!.kitchen.mandate.mandateId;
      const shown = rulesOf((await turn(k, { via: "tap", action: { type: "rules_propose", change: { forbidAdd: ["nuts"] } } })).cards)!;
      expect(shown.proposal).toMatchObject({ canSign: false, why: who === "other" ? "not_this_account" : "not_signed_in" });
      const r = await turn(k, { via: "tap", action: { type: "rules_sign", proposalId: shown.proposal!.proposalId } });
      expect(noticeOf(r.cards)).toMatchObject({ kind: "refused" });
      expect((await rt.accounts.kitchenOf(`kok${who}`))!.kitchen.mandate.mandateId).toBe(before);
      expect(events(rt, "rules_refused")).toHaveLength(1);
    }
  });

  it("another account's session cannot change this account's terms", async () => {
    const { rt, k } = await accountKitchen("toinen", "other");
    const shown = rulesOf((await turn(k, { via: "tap", action: { type: "rules_propose", change: { perOrderLimitEur: 800 } } })).cards)!;
    expect(shown.proposal).toMatchObject({ canSign: false, why: "not_this_account" });
    const r = await turn(k, { via: "tap", action: { type: "rules_sign", proposalId: shown.proposal!.proposalId } });
    expect(noticeOf(r.cards)).toMatchObject({ kind: "refused" });
    expect((await rt.accounts.kitchenOf("toinen"))!.kitchen.mandate.perOrderLimitCents).toBe(30000);
  });

  it("a dropped proposal signs nothing and cannot be signed afterwards", async () => {
    const { rt, k } = await accountKitchen("pudotus");
    const shown = rulesOf((await turn(k, { via: "tap", action: { type: "rules_propose", change: { weeklyBudgetEur: 2000 } } })).cards)!;
    const dropped = rulesOf((await turn(k, { via: "tap", action: { type: "rules_cancel", proposalId: shown.proposal!.proposalId } })).cards)!;
    expect(dropped.proposal?.state).toBe("cancelled");
    const r = await turn(k, { via: "tap", action: { type: "rules_sign", proposalId: shown.proposal!.proposalId } });
    expect(noticeOf(r.cards)).toMatchObject({ kind: "refused" });
    expect((await rt.accounts.kitchenOf("pudotus"))!.kitchen.mandate.weeklyBudgetCents).toBe(300000);
    expect(events(rt, "rules_cancelled")).toHaveLength(1);
  });
});

describe("a change that widens what the agent may do needs the named approver's passkey", () => {
  const terms = { ...DEFAULT_TERMS, signer: "Aino", forbid: ["nuts" as const], require: ["lactose_free" as const], substitution: "needs_approval" as const };
  const base = snapshotAfter(snapshotOf({ perOrderLimitCents: 30000, weeklyBudgetCents: 300000, allowedCategories: [], requiredAttributes: ["lactose_free"], forbiddenAllergens: ["nuts"], approvers: [{ name: "Aino", role: "kitchen_signer", maxApprovalCents: 300000 }], delivery: { maxLeadDays: 7 }, substitution: { rule: "needs_approval" } } as never, terms), {}, terms);
  const kinds: [string, Parameters<typeof normaliseChange>[0], boolean][] = [
    ["a product group added", { groupsAdd: ["18"] }, true],
    ["the per-order limit raised", { perOrderLimitEur: 800 }, true],
    ["the weekly budget raised", { weeklyBudgetEur: 5000 }, true],
    ["a forbidden allergen taken away", { forbidRemove: ["nuts"] }, true],
    ["a required claim taken away", { requireRemove: ["lactose_free"] }, true],
    ["more days ahead", { maxLeadDays: 14 }, true],
    ["a looser substitution", { substitution: "within_preferences" }, true],
    ["a new signer", { signer: "Maija Laine" }, true],
    ["a forbidden allergen added", { forbidAdd: ["sesame"] }, false],
    ["the limit lowered", { perOrderLimitEur: 100 }, false],
    ["the budget lowered", { weeklyBudgetEur: 1000 }, false],
  ];
  for (const [name, change, widens] of kinds)
    it(`${name}: ${widens ? "needs the passkey" : "a plain yes"}`, () => {
      expect(needsSignOff(diffOf(base, snapshotAfter(base, normaliseChange(change), terms)))).toBe(widens);
    });

  it("a product group added in the chat waits; only a passkey over that change signs it, a link or a session cannot", async () => {
    const { rt, k } = await accountKitchen("pakaste");
    const before = (await rt.accounts.kitchenOf("pakaste"))!.kitchen;
    const shown = rulesOf((await turn(k, { via: "tap", action: { type: "rules_propose", change: { groupsAdd: ["18"] } } })).cards)!;
    const waiting = rulesOf((await turn(k, { via: "tap", action: { type: "rules_sign", proposalId: shown.proposal!.proposalId } })).cards)!;
    expect(waiting.proposal?.state).toBe("waiting");
    // A second confirm does not sign it either.
    await turn(k, { via: "tap", action: { type: "rules_sign", proposalId: shown.proposal!.proposalId } });
    expect((await rt.accounts.kitchenOf("pakaste"))!.kitchen.terms.groups).toEqual(before.terms.groups);
    await expect(rulesSignOff(k, shown.proposal!.proposalId, { kind: "link_token", token: "x" })).rejects.toMatchObject({ code: "passkey_required" });
    await rulesSignOff(k, shown.proposal!.proposalId, { kind: "webauthn", response: (await signerDevice(rt, "pakaste")).assert(await rulesSignOffOptions(k, shown.proposal!.proposalId, RP)) });
    expect((await rt.accounts.kitchenOf("pakaste"))!.kitchen.terms.groups).toContain("18");
  });
});
