import { beforeEach, describe, expect, it } from "vitest";
import { resolveKitchen } from "@/server/console-kitchens";
import type { Kitchen } from "@/server/kitchen-portal";
import { DEFAULT_TERMS } from "@/server/accounts/terms";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { SoftwareAuthenticator } from "@/core/test-webauthn";
import { submitTurn, threadStore } from "./engine";
import { diffOf, snapshotOf, termsAfter } from "./rules";
import { decideRulesChange, findRulesChange, pendingRulesChanges, rulesChangeOptions, rulesChangeView } from "./rules-signoff";
import type { Card, RulesCard } from "./types";

/**
 * A change to the rules that widens what the agent may do, decided on the approver's phone (/approve/rch_...): the
 * same passkey ceremony as an order over the limit, its own id space, exactly the change shown, a time limit, and a
 * decline that changes nothing. The conversation that asked updates in place.
 */

const ADDR = "198.51.100.10";
const ORIGIN = "http://localhost:3000";
const RP = { id: "localhost", name: "AimoPilot", origins: [ORIGIN] };


async function turn(k: Kitchen, body: Record<string, unknown>): Promise<Card[]> {
  const store = await threadStore();
  let id = "";
  const seen: Card[] = [];
  const done = new Promise<void>((resolve) => {
    const off = store.subscribe(k.info.slug, (e) => {
      if (e.type === "card") seen.push(e.card);
      if (e.type === "status" && e.turnId === id && e.status !== "working") {
        off();
        resolve();
      }
    });
  });
  id = (await submitTurn(k, body)).agentTurnId;
  await done;
  return [...store.agentTurn(store.peek(k.info.slug)!, id)!.cards, ...seen];
}
const rulesOf = (cards: Card[]) => cards.filter((c): c is RulesCard => c.type === "rules").at(-1);

async function kitchenWithPhone(username: string) {
  const rt = await getRuntime();
  await rt.accounts.signUp({ restaurant: `Ravintola ${username}`, username, password: "a-long-password-1" }, ADDR);
  await rt.accounts.signKitchen(username, { ...DEFAULT_TERMS, signer: "Aino Virtanen" });
  const base = (await resolveKitchen(username))!;
  const k = { ...base, console: { kitchen: username, session: `s_${username}`, person: { channel: "portal_session" as const, name: "Chef Ville", account: username } } } as Kitchen;
  // The signer's phone: a passkey for the kitchen's signer, and the phone signed in as that signer.
  const phone = new SoftwareAuthenticator(ORIGIN);
  const a = (await rt.accounts.get(username))!;
  const { sessionToken } = await rt.accounts.completeDevice(phone.register(await rt.accounts.beginDevice(a, RP, "session")), { username });
  const req = (cookie = true) => new Request(`${ORIGIN}/ui-api/rules-changes/x`, { headers: cookie ? { cookie: `dock_approver=${sessionToken}` } : {} });
  return { rt, k, phone, sessionToken, req };
}

/** The buyer asks for frozen products to be allowed and confirms: it goes to the signer's phone. */
async function waitingChange(k: Kitchen, change: Record<string, unknown> = { groupsAdd: ["18"] }) {
  const shown = rulesOf(await turn(k, { via: "tap", action: { type: "rules_propose", change } }))!;
  const waiting = rulesOf(await turn(k, { via: "tap", action: { type: "rules_sign", proposalId: shown.proposal!.proposalId } }))!;
  expect(waiting.proposal?.state).toBe("waiting");
  return { proposalId: shown.proposal!.proposalId, approvalId: waiting.proposal!.approval!.approvalId };
}

/** What the conversation said beneath the reply that said the change waits (every agent line, newest last). */
const lineOf = async (k: Kitchen) => {
  const t = (await threadStore()).peek(k.info.slug)!;
  return t.turns.flatMap((x) => (x.role === "agent" && x.line ? [x.line] : [])).join("\n");
};

beforeEach(() => {
  resetRuntime();
  process.env.DOCK_MEMORY = "off";
  process.env.DOCK_RATE_LIMITS = "off";
  process.env.DOCK_CATALOG = "seed";
  const g = globalThis as { __dockConsoleTokens?: unknown; __dockMenuTokens?: unknown };
  g.__dockConsoleTokens = g.__dockMenuTokens = undefined;
});

describe("a rules change on the approver's phone", () => {
  it("shows exactly what would change, who asked and when; the passkey on the phone signs exactly that change", async () => {
    const { rt, k, phone, req } = await kitchenWithPhone("puhelin");
    const before = (await rt.accounts.kitchenOf("puhelin"))!.kitchen;
    const { approvalId } = await waitingChange(k);
    expect(approvalId).toMatch(/^rch_/);

    const view = await rulesChangeView(rt, req(), await findRulesChange(approvalId));
    expect(view).toMatchObject({ state: "pending", requestedBy: "Chef Ville", approverName: "Aino Virtanen", signIn: "passkey", viewerIsApprover: true });
    expect(Date.parse(view.expiresAt!) - Date.parse(view.requestedAt)).toBe(24 * 3600_000);
    expect(view.changes.filter((c) => c.widens)).toEqual([expect.objectContaining({ field: "groups", widens: true })]);
    // The approver's list shows it beside the orders.
    expect((await pendingRulesChanges(before.orgId)).map((x) => x.approvalId)).toEqual([approvalId]);

    const options = await rulesChangeOptions(rt, req(), approvalId, "approve", RP);
    const signed = await decideRulesChange(rt, req(), approvalId, { decision: "approve", proof: { kind: "webauthn", response: phone.assert(options) } });
    expect(signed).toMatchObject({ state: "signed", outcome: { decision: "approved", by: "Aino Virtanen", method: "passkey" } });

    // Applied: exactly the change shown, nothing else.
    const after = (await rt.accounts.kitchenOf("puhelin"))!.kitchen;
    expect(after.terms).toEqual(termsAfter(before.terms, { groupsAdd: ["18"] }));
    expect(diffOf(snapshotOf(before.mandate, before.terms), snapshotOf(after.mandate, after.terms))).toEqual(view.changes);
    // The conversation says it where it waited; the approver's list is empty again.
    expect(await lineOf(k)).toMatch(/Aino Virtanen signed the change with their passkey at \d\d\.\d\d: I may now buy meat and fish\./);
    expect(await pendingRulesChanges(before.orgId)).toEqual([]);
    // Signed once: it cannot be signed again.
    await expect(rulesChangeOptions(rt, req(), approvalId, "approve", RP)).rejects.toMatchObject({ code: "approval_not_pending" });
  });

  it("its scope: a rules-change signature cannot approve an order, an order's cannot sign a rules change, and neither id opens the other", async () => {
    const { rt, k, phone, req } = await kitchenWithPhone("rajat");
    const { approvalId } = await waitingChange(k);
    const orgId = k.info.orgId;
    const role = (await findRulesChange(approvalId)).proposal.approval!.approver.role;

    // An assertion made for the rules change, offered to an order's sign-off: refused by the verifier.
    const forRules = phone.assert(await rulesChangeOptions(rt, req(), approvalId, "approve", RP));
    const orderApproval = { approvalId: "apr_order0001", approver: { role, name: "Aino Virtanen", maxApprovalCents: 300000 }, status: "pending" as const, orderDigest: "a".repeat(64), tokenHash: "0".repeat(64), requestedAt: new Date().toISOString() };
    const v = await rt.passkeys.verifier.verify({ approval: orderApproval as never, orgId, orderDigest: orderApproval.orderDigest, decision: "approve", now: new Date() }, { kind: "webauthn", response: forRules });
    expect(v).toMatchObject({ ok: false, reason: "challenge_other_approval" });

    // An assertion made for an order, offered to the rules change: refused, nothing changes.
    const terms = (await rt.accounts.kitchenOf("rajat"))!.kitchen.terms;
    const forOrder = phone.assert(await rt.passkeys.approvalOptions(RP, { approvalId: "apr_order0001", orgId, role, orderDigest: "a".repeat(64), decision: "approve" }));
    await expect(decideRulesChange(rt, req(), approvalId, { decision: "approve", proof: { kind: "webauthn", response: forOrder } })).rejects.toMatchObject({ code: "challenge_other_approval" });
    expect((await rt.accounts.kitchenOf("rajat"))!.kitchen.terms).toEqual(terms);

    // A link token or a signed-in phone alone never approves a widening.
    await expect(decideRulesChange(rt, req(), approvalId, { decision: "approve", proof: { kind: "session" } })).rejects.toMatchObject({ code: "passkey_required" });
    // The ids do not cross: an order's id is no rules change, a rules change's id is no order.
    await expect(findRulesChange("apr_order0001")).rejects.toMatchObject({ status: 404 });
    await expect(rt.dock.approvalContext(approvalId)).rejects.toMatchObject({ status: 404 });
    // A stranger (no approver phone, no account session) cannot even see it.
    await expect(rulesChangeView(rt, req(false), await findRulesChange(approvalId)).then(() => decideRulesChange(rt, req(false), approvalId, { decision: "decline", proof: { kind: "session" } }))).rejects.toMatchObject({ status: 404 });
    expect((await rt.accounts.kitchenOf("rajat"))!.kitchen.terms).toEqual(terms);
  });

  it("declined on the phone: nothing changes, the card and the conversation say so", async () => {
    const { rt, k, req } = await kitchenWithPhone("hylkays");
    const before = (await rt.accounts.kitchenOf("hylkays"))!.kitchen;
    const { approvalId, proposalId } = await waitingChange(k, { perOrderLimitEur: 800 });
    const v = await decideRulesChange(rt, req(), approvalId, { decision: "decline", proof: { kind: "session" }, note: "Not this month" });
    expect(v).toMatchObject({ state: "declined", outcome: { decision: "declined", by: "Aino Virtanen", note: "Not this month" } });
    const after = (await rt.accounts.kitchenOf("hylkays"))!.kitchen;
    expect(after.mandate.mandateId).toBe(before.mandate.mandateId);
    expect(after.terms).toEqual(before.terms);
    const card = rulesOf((await threadStore()).cards((await threadStore()).peek("hylkays")!).map((x) => x.card))!;
    expect(card.proposal).toMatchObject({ state: "declined", approval: { decided: { by: "Aino Virtanen", note: "Not this month" } } });
    expect(await lineOf(k)).toMatch(/Aino Virtanen declined the change at \d\d\.\d\d, so your rules stay as they were\./);
    expect(rt.dock.ledger.entries().some((e) => [(e.data as { event?: string }).event, (e.data as { step?: string }).step].includes("rules_declined"))).toBe(true);
    // Declined is final: the passkey can no longer sign it.
    await expect(rulesChangeOptions(rt, req(), approvalId, "approve", RP)).rejects.toMatchObject({ code: "approval_not_pending" });
  });

  it("lapses after its time: it can no longer be signed, nothing changes, the conversation says so once", async () => {
    const { rt, k, phone, req } = await kitchenWithPhone("vanhentunut");
    const before = (await rt.accounts.kitchenOf("vanhentunut"))!.kitchen;
    const { approvalId, proposalId } = await waitingChange(k);
    const options = await rulesChangeOptions(rt, req(), approvalId, "approve", RP);
    // A day later.
    (await findRulesChange(approvalId)).proposal.approval!.expiresAt = new Date(Date.now() - 1000).toISOString();
    await expect(decideRulesChange(rt, req(), approvalId, { decision: "approve", proof: { kind: "webauthn", response: phone.assert(options) } })).rejects.toMatchObject({ code: "rules_change_expired" });
    expect((await rt.accounts.kitchenOf("vanhentunut"))!.kitchen.terms).toEqual(before.terms);
    expect((await rulesChangeView(rt, req(), await findRulesChange(approvalId))).state).toBe("expired");
    expect(await pendingRulesChanges(before.orgId)).toEqual([]);
    expect(await lineOf(k)).toMatch(/Nobody signed the change in time, so your rules stay as they were\./);
  });

  it("a signature over rules that have since changed is refused: only the change shown can be signed", async () => {
    const { rt, k, phone, req } = await kitchenWithPhone("muuttui");
    const first = await waitingChange(k, { groupsAdd: ["18"] });
    const second = await waitingChange(k, { weeklyBudgetEur: 4000 });
    // The second is signed first: the mandate the first was asked against is gone.
    await decideRulesChange(rt, req(), second.approvalId, { decision: "approve", proof: { kind: "webauthn", response: phone.assert(await rulesChangeOptions(rt, req(), second.approvalId, "approve", RP)) } });
    const terms = (await rt.accounts.kitchenOf("muuttui"))!.kitchen.terms;
    await expect(decideRulesChange(rt, req(), first.approvalId, { decision: "approve", proof: { kind: "webauthn", response: phone.assert(await rulesChangeOptions(rt, req(), first.approvalId, "approve", RP)) } })).rejects.toMatchObject({ code: "rules_change_stale" });
    expect((await rt.accounts.kitchenOf("muuttui"))!.kitchen.terms).toEqual(terms);
  });
});

describe("auto-renew: on needs the approver's passkey, off is free", () => {
  async function lumo() {
    const rt = await getRuntime();
    const base = (await resolveKitchen("hotel-lumo"))!;
    const k = { ...base, console: { kitchen: "hotel-lumo", session: "s_lumo", person: { channel: "portal_session" as const, name: "Hotel Lumo kitchen (hotel-lumo)", account: "hotel-lumo" } } } as Kitchen;
    const { standingFor } = await import("@/server/watch/service");
    const family = (await standingFor(rt, k.info.orgId))[0]!.family;
    const phone = new SoftwareAuthenticator(ORIGIN);
    const { sessionToken } = await rt.accounts.completeDevice(phone.register(await rt.accounts.beginDevice((await rt.accounts.get("hotel-lumo"))!, RP, "session")), { username: "hotel-lumo" });
    const req = () => new Request(`${ORIGIN}/ui-api/rules-changes/x`, { headers: { cookie: `dock_approver=${sessionToken}` } });
    const on = async () => (await standingFor(rt, k.info.orgId)).find((r) => r.family === family)!.autoRenew.on;
    return { rt, k, family, phone, req, on };
  }

  it("asked on in the conversation or the store: it waits for the approver, and only their passkey switches it on", async () => {
    const { rt, k, family, phone, req, on } = await lumo();
    const { approvalId } = await waitingChange(k, { autoRenewOn: [family] });
    const f = await findRulesChange(approvalId);
    expect(f.proposal.kind).toBe("auto_renew");
    expect(await on()).toBe(false);
    const view = await rulesChangeView(rt, req(), f);
    expect(view.changes).toEqual([{ field: "autoRenew", before: "", after: family, widens: true }]);
    await decideRulesChange(rt, req(), approvalId, { decision: "approve", proof: { kind: "webauthn", response: phone.assert(await rulesChangeOptions(rt, req(), approvalId, "approve", RP)) } });
    expect(await on()).toBe(true);
  });

  it("off is done at once, no sign-off", async () => {
    const { rt, k, family, on } = await lumo();
    const { setAutoRenew } = await import("@/server/watch/service");
    const session = await rt.dock.authenticate(k.mandateToken, k.agentId, { via: "onsite", path: "/test", method: "POST" } as never);
    await setAutoRenew(rt, session, { family, on: true, by: "Tester", via: "test", renewNow: false });
    const { autoRenewFromWords } = await import("./watch");
    const store = await threadStore();
    const thread = store.get("hotel-lumo", k.info.orgId);
    const said = await autoRenewFromWords({ rt, store, thread, turnId: "trn_x", buyer: { turnId: "b", role: "buyer", at: "", door: "typed", via: "typed" }, k, session, person: k.console!.person, door: "typed", t0: 0, facts: [], requests: new Set(), orders: new Map(), readings: new Map() } as never, `switch auto-renew off for the ${family.replaceAll("_", " ")}`);
    expect(said).toBeTruthy();
    expect(await on()).toBe(false);
  });
});
