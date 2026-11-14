import { DockError } from "@/core/errors";
import type { Mandate } from "@/core/mandate";
import { allergenOf, claimOf } from "@/core/vocabulary";
import { FORBID_ALLERGENS, PRODUCT_GROUPS, REQUIRE_CLAIMS, SUBSTITUTION_RULES, categoriesOf, parseTerms, type MandateTerms } from "@/server/accounts/terms";
import { currentDemoMandate, type DemoSlug } from "@/server/console-kitchens";
import { reissueKitchenMandate } from "@/server/mandate-reissue";
import type { Approval, SignOff } from "@/core/approval";
import { canonicalJson, sha256Hex } from "@/core/util";
import { cardId } from "./cards";
import { record, step, type TurnRun } from "./pipeline";
import type { RulesCard, RulesChange, RulesSnapshot } from "./types";

/**
 * The kitchen's rules in the thread: its signed mandate and its stated rules, shown from records, and changed from the
 * widget only by the kitchen's own signed-in person, as a new signed mandate (docs/agent-thread.md "Widgets": rules).
 *
 * A change is first a proposal: plain code works out the mandate before and after, and nothing is signed. Signing
 * it uses the mechanisms that already exist, and only those:
 *   narrowing   "never nuts", "always lactose-free": the reissue the security review made (server/mandate-reissue.ts),
 *               for every kind of kitchen (built-in demo, visitor, account), from the kitchen's signed-in person
 *               (the same check as requireKitchenPerson: not a relayed name, not a call-code phone)
 *   other terms the per-order limit, the weekly budget, who signs, lead days, substitution, product groups, and
 *               taking a rule away: only an account's kitchen has terms; they change by signing new terms the way
 *               its account page does (accounts/service.ts signKitchen: the old mandate retired at the gate), and
 *               only from that account's own session. A demo kitchen's terms are fixed for the stage, a visitor's
 *               sandbox has no way to sign wider terms: the card says so instead of offering it.
 * The mechanism writes its own ledger entry (mandate_reissued / mandate_signed); the conversation adds `rules_*`
 * agent entries (proposed, signed, refused, cancelled) with the before and after, so the operations trace shows each.
 */

/** How long a change waits for the approver's passkey before it lapses (nothing changes). */
export const RULES_SIGNOFF_MS = 24 * 3600_000;

export type RulesApproval = {
  approvalId: string;
  digest: string;
  mandateId: string;
  approver: { name: string; role: string };
  requestedAt: string;
  /** After this the change can no longer be signed; nothing changed. */
  expiresAt?: string;
  /** Who asked for it (the kitchen's signed-in person), as the approver's phone says it. */
  requestedBy?: string;
  /** The language of the conversation it was asked in (what is said there when it is decided). */
  lang?: "en" | "fi" | "sv";
  /** Exactly what the approver is shown and signs: the field-by-field change at the time it was asked. */
  shown?: RulesCard["diff"];
  /** The approver's answer. */
  decided?: { decision: "approved" | "declined"; by: string; at: string; method: string; note?: string };
};

export type Proposal = {
  proposalId: string;
  change: RulesChange;
  kind: "narrow" | "terms" | "auto_renew";
  turnId: string;
  state: "open" | "waiting" | "signed" | "cancelled" | "declined" | "expired";
  /** A change that widens what the agent may do waits for the named approver's passkey, bound to this digest. */
  approval?: RulesApproval;
};
type WithProposals = { rulesProposals?: Record<string, Proposal> };
const proposalsOf = (run: Pick<TurnRun, "thread">): Record<string, Proposal> => ((run.thread as unknown as WithProposals).rulesProposals ??= {});

/** The proposal a rules-change sign-off (rch_...) belongs to, in one thread. */
export function proposalByApproval(thread: object, approvalId: string): Proposal | undefined {
  return Object.values((thread as WithProposals).rulesProposals ?? {}).find((p) => p.approval?.approvalId === approvalId);
}

/** Every proposal of a thread that waits for the approver (for the approver's list). */
export function waitingProposals(thread: object, now = Date.now()): Proposal[] {
  return Object.values((thread as WithProposals).rulesProposals ?? {}).filter((p) => p.state === "waiting" && !!p.approval && !lapsed(p, now));
}

/** A waiting change past its time: it can no longer be signed. */
export function lapsed(p: Proposal, now = Date.now()): boolean {
  return p.state === "waiting" && !!p.approval?.expiresAt && Date.parse(p.approval.expiresAt) <= now;
}

const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const eur = (cents: number) => Math.round(cents / 100);
const groupsOf = (ids: string[]) => PRODUCT_GROUPS.filter((g) => ids.includes(g.id)).map((g) => ({ id: g.id, name: g.name }));
const VOCABULARY: RulesCard["vocabulary"] = { forbid: [...FORBID_ALLERGENS], require: [...REQUIRE_CLAIMS], substitution: [...SUBSTITUTION_RULES], groups: groupsOf(PRODUCT_GROUPS.map((g) => g.id)) };
const isIn = (xs: readonly string[]) => (x: string | undefined): x is string => !!x && xs.includes(x);

/** The mandate as the widget shows it: plain values, product groups where the kitchen has terms. */
export function snapshotOf(m: Mandate, terms?: MandateTerms): RulesSnapshot {
  return {
    perOrderLimitCents: m.perOrderLimitCents,
    weeklyBudgetCents: m.weeklyBudgetCents,
    categories: [...m.allowedCategories],
    ...(terms ? { groups: groupsOf(terms.groups) } : {}),
    requiredAttributes: [...m.requiredAttributes],
    forbiddenAllergens: [...m.forbiddenAllergens],
    approvers: m.approvers.map((a) => ({ name: a.name, role: a.role, maxApprovalCents: a.maxApprovalCents })),
    maxLeadDays: m.delivery.maxLeadDays,
    substitution: m.substitution.rule,
  };
}

/** Normalise a change: words to the mandate's vocabulary ("pähkinä" → nuts); nothing it cannot state passes. */
export function normaliseChange(raw: RulesChange): RulesChange {
  const allergens = (xs?: string[]) => uniq((xs ?? []).map((x) => (isIn(FORBID_ALLERGENS)(x) ? x : allergenOf(x))).filter(isIn(FORBID_ALLERGENS)));
  const claims = (xs?: string[]) => uniq((xs ?? []).map((x) => (isIn(REQUIRE_CLAIMS)(x) ? x : claimOf(x))).filter(isIn(REQUIRE_CLAIMS)));
  const groups = (xs?: string[]) => uniq((xs ?? []).filter((x) => PRODUCT_GROUPS.some((g) => g.id === x)));
  const whole = (n?: number) => (n !== undefined && Number.isFinite(n) ? Math.round(n) : undefined);
  const c: RulesChange = {};
  const lists = { forbidAdd: allergens(raw.forbidAdd), forbidRemove: allergens(raw.forbidRemove), requireAdd: claims(raw.requireAdd), requireRemove: claims(raw.requireRemove), groupsAdd: groups(raw.groupsAdd), groupsRemove: groups(raw.groupsRemove) };
  for (const [k, v] of Object.entries(lists)) if (v.length) c[k as keyof typeof lists] = v;
  const nums = { perOrderLimitEur: whole(raw.perOrderLimitEur), weeklyBudgetEur: whole(raw.weeklyBudgetEur), maxLeadDays: whole(raw.maxLeadDays) };
  for (const [k, v] of Object.entries(nums)) if (v !== undefined) c[k as keyof typeof nums] = v;
  if (raw.signer?.trim()) c.signer = raw.signer.trim().slice(0, 60);
  if (raw.substitution && isIn(SUBSTITUTION_RULES)(raw.substitution)) c.substitution = raw.substitution;
  const renew = uniq((raw.autoRenewOn ?? []).filter((x) => /^[a-z0-9_]{2,40}$/.test(x))).slice(0, 4);
  if (renew.length) c.autoRenewOn = renew;
  return c;
}

/**
 * The model maps the buyer's words to a change; code keeps only what their words carry. An amount must be a number
 * they wrote ("raise the limit to 800", "800 €"), a signer a name they wrote; allergens and claims pass through the
 * vocabulary (normaliseChange). Whatever is dropped is said back to the model, never proposed.
 */
export function groundedChange(c: RulesChange, words: string): { change: RulesChange; dropped: string[] } {
  const said = new Set((words.replace(/(\d)[\s .](?=\d{3}\b)/g, "$1").match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(",", "."))));
  const out: RulesChange = { ...c };
  const dropped: string[] = [];
  for (const k of ["perOrderLimitEur", "weeklyBudgetEur", "maxLeadDays"] as const) {
    if (out[k] !== undefined && !said.has(out[k]!)) {
      dropped.push(`${k} ${out[k]}`);
      delete out[k];
    }
  }
  if (out.signer && !words.toLowerCase().includes(out.signer.toLowerCase().split(/\s+/)[0]!)) {
    dropped.push(`signer ${out.signer}`);
    delete out.signer;
  }
  return { change: normaliseChange(out), dropped };
}

/** Only switching auto-renew on for recurring orders: the kitchen's person asks, the approver's passkey signs. */
export function isAutoRenew(c: RulesChange): boolean {
  const keys = Object.keys(c);
  return keys.length > 0 && keys.every((k) => k === "autoRenewOn");
}
const kindOf = (c: RulesChange): Proposal["kind"] => (isNarrowing(c) ? "narrow" : isAutoRenew(c) ? "auto_renew" : "terms");

/** Only adding a forbidden allergen or a required claim: the narrowing reissue every kitchen supports. */
export function isNarrowing(c: RulesChange): boolean {
  const keys = Object.keys(c);
  return keys.length > 0 && keys.every((k) => k === "forbidAdd" || k === "requireAdd");
}

/** The terms after a change, checked exactly as the account page checks them (parseTerms: 400 with the first problem). */
export function termsAfter(t: MandateTerms, c: RulesChange): MandateTerms {
  return parseTerms({
    ...t,
    forbid: uniq([...t.forbid.filter((x) => !(c.forbidRemove ?? []).includes(x)), ...(c.forbidAdd ?? [])]),
    require: uniq([...t.require.filter((x) => !(c.requireRemove ?? []).includes(x)), ...(c.requireAdd ?? [])]),
    groups: uniq([...t.groups.filter((x) => !(c.groupsRemove ?? []).includes(x)), ...(c.groupsAdd ?? [])]),
    ...(c.perOrderLimitEur !== undefined ? { perOrderLimitEur: c.perOrderLimitEur } : {}),
    ...(c.weeklyBudgetEur !== undefined ? { weeklyBudgetEur: c.weeklyBudgetEur } : {}),
    ...(c.maxLeadDays !== undefined ? { maxLeadDays: c.maxLeadDays } : {}),
    ...(c.signer ? { signer: c.signer } : {}),
    ...(c.substitution ? { substitution: c.substitution } : {}),
  });
}

/**
 * The mandate after a change, as the mechanism would sign it: a narrowing moves only the two lists (the reissue keeps
 * everything else); new terms move what the terms move (mandateFromTerms), the signer's own limit following the budget.
 * Without terms (a demo or visitor kitchen) only the narrowing part can be shown: the rest cannot be signed there.
 */
export function snapshotAfter(before: RulesSnapshot, c: RulesChange, terms?: MandateTerms): RulesSnapshot {
  if (isAutoRenew(c)) return { ...before, autoRenew: uniq([...(before.autoRenew ?? []), ...(c.autoRenewOn ?? [])]) };
  if (isNarrowing(c)) {
    return { ...before, forbiddenAllergens: uniq([...before.forbiddenAllergens, ...(c.forbidAdd ?? [])]), requiredAttributes: uniq([...before.requiredAttributes, ...(c.requireAdd ?? [])]) };
  }
  if (!terms) {
    // A kitchen without terms (a demo or a visitor's): the change asked for is shown as asked, so the answer can say
    // exactly what cannot be changed here and why (the proposal's canSign and why), never a bare "not changed".
    return {
      ...before,
      ...(c.perOrderLimitEur !== undefined ? { perOrderLimitCents: Math.round(c.perOrderLimitEur * 100) } : {}),
      ...(c.weeklyBudgetEur !== undefined ? { weeklyBudgetCents: Math.round(c.weeklyBudgetEur * 100) } : {}),
      ...(c.maxLeadDays !== undefined ? { maxLeadDays: c.maxLeadDays } : {}),
      forbiddenAllergens: uniq([...before.forbiddenAllergens.filter((x) => !(c.forbidRemove ?? []).includes(x)), ...(c.forbidAdd ?? [])]),
      requiredAttributes: uniq([...before.requiredAttributes.filter((x) => !(c.requireRemove ?? []).includes(x)), ...(c.requireAdd ?? [])]),
    };
  }
  const t = termsAfter(terms, c);
  return {
    perOrderLimitCents: t.perOrderLimitEur * 100,
    weeklyBudgetCents: t.weeklyBudgetEur * 100,
    categories: categoriesOf(t.groups),
    groups: groupsOf(t.groups),
    requiredAttributes: [...t.require],
    forbiddenAllergens: [...t.forbid],
    approvers: before.approvers.map((a, i) => (i === 0 ? { ...a, name: t.signer, maxApprovalCents: t.weeklyBudgetEur * 100 } : a)),
    maxLeadDays: t.maxLeadDays,
    substitution: t.substitution,
  };
}

/** Before and after, field by field, for the widget: what changes and nothing else; `widens` when the agent may do more. */
export function diffOf(before: RulesSnapshot, after: RulesSnapshot): RulesCard["diff"] {
  const out: RulesCard["diff"] = [];
  const num = (field: string, b: number, a: number) => {
    if (b !== a) out.push({ field, before: String(b), after: String(a), widens: a > b });
  };
  /** A rule list: taking one away widens. A product-group list: adding one widens. */
  const list = (field: string, b: string[], a: string[], widensOnAdd: boolean) => {
    if ([...b].sort().join(",") === [...a].sort().join(",")) return;
    out.push({ field, before: b.join(", "), after: a.join(", "), widens: widensOnAdd ? a.some((x) => !b.includes(x)) : b.some((x) => !a.includes(x)) });
  };
  num("perOrderLimitEur", eur(before.perOrderLimitCents), eur(after.perOrderLimitCents));
  num("weeklyBudgetEur", eur(before.weeklyBudgetCents), eur(after.weeklyBudgetCents));
  num("maxLeadDays", before.maxLeadDays, after.maxLeadDays);
  list("forbiddenAllergens", before.forbiddenAllergens, after.forbiddenAllergens, false);
  list("requiredAttributes", before.requiredAttributes, after.requiredAttributes, false);
  if (before.groups && after.groups) list("groups", before.groups.map((g) => g.name), after.groups.map((g) => g.name), true);
  // Renewing a recurring order by itself: the agent orders without asking each time.
  if (before.autoRenew && after.autoRenew) list("autoRenew", before.autoRenew, after.autoRenew, true);
  const signers = (s: RulesSnapshot) => s.approvers.map((a) => a.name).join(", ");
  if (signers(before) !== signers(after)) out.push({ field: "signer", before: signers(before), after: signers(after), widens: false });
  const looseness = (r: string) => ["none", "needs_approval", "within_preferences"].indexOf(r);
  if (before.substitution !== after.substitution) out.push({ field: "substitution", before: before.substitution, after: after.substitution, widens: looseness(after.substitution) > looseness(before.substitution) });
  return out;
}

/** The kitchen's mandate as it stands now (read fresh, the way the reissue reads it), with its terms where it has them. */
async function current(run: TurnRun): Promise<{ mandate: Mandate; terms?: MandateTerms }> {
  const { kind, slug } = run.k.info;
  if (kind === "account") {
    const k = await run.rt.accounts.kitchenOf(slug);
    if (k) return { mandate: k.kitchen.mandate, terms: k.kitchen.terms };
  }
  if (kind === "demo") return { mandate: await currentDemoMandate(slug as DemoSlug) };
  if (kind === "visitor") {
    const m = await run.rt.sandboxes.mandateOf(slug);
    if (m) return { mandate: m };
  }
  return { mandate: run.session.mandate };
}

/** What this browser can sign for this kitchen, and why not when it cannot (a code the widget words). */
export function editableFor(run: Pick<TurnRun, "k" | "person">): RulesCard["editable"] {
  const kind = run.k.info.kind;
  const signedIn = !!run.person && !run.person.callOnly;
  // An account's session counts for its own kitchen only (a demo kitchen's account is named after it); a visitor's
  // phone is the approver of its sandbox (no account). Stricter than requireKitchenPerson, never looser.
  const person = signedIn && (!run.person!.account || kind === "visitor" || run.person!.account === run.k.info.slug);
  const ownAccount = person && kind === "account";
  const why = !signedIn ? "not_signed_in" : !person ? "not_this_account" : ownAccount ? undefined : kind === "demo" ? "demo_terms_fixed" : "visitor_terms_fixed";
  return { narrow: person, terms: ownAccount, ...(why ? { why } : {}), ...(person ? { as: run.person!.name } : {}) };
}

/** The snapshot with the recurring orders that renew by themselves, when a change is about them (records, no live call). */
async function withRenew(run: TurnRun, snap: RulesSnapshot, c?: RulesChange): Promise<RulesSnapshot> {
  if (!c?.autoRenewOn?.length) return snap;
  const { standingFor } = await import("@/server/watch/service");
  const rows = await standingFor(run.rt, run.k.info.orgId).catch(() => []);
  return { ...snap, autoRenew: rows.filter((r) => r.autoRenew.on).map((r) => r.family) };
}

async function statedOf(run: TurnRun) {
  return ((await run.rt.kitchens.getProfile(run.k.info.orgId))?.stated ?? []).map((p) => ({ id: p.id, text: p.text }));
}

const describe = (diff: RulesCard["diff"]) => diff.map((d) => `${d.field} ${d.before || "none"} → ${d.after || "none"}`).join("; ") || "nothing changes";

function cardFor(run: TurnRun, ref: string, m: Mandate, current: RulesSnapshot, stated: RulesCard["stated"], extra: Pick<RulesCard, "proposal" | "after" | "diff">): RulesCard {
  return { type: "rules", cardId: cardId("rules", ref), kitchenKind: run.k.info.kind as RulesCard["kitchenKind"], mandateId: m.mandateId, validUntil: m.validUntil, current, stated, editable: editableFor(run), vocabulary: VOCABULARY, ...extra };
}

/** The rules card: the mandate as it stands, the stated rules, and (with a change) an open proposal with its before and after. */
export async function showRules(run: TurnRun, raw?: RulesChange): Promise<RulesCard> {
  const st = step(run, "rules", raw ? "Working out the change to your rules" : "Reading your rules");
  const { mandate, terms } = await current(run);
  const before = await withRenew(run, snapshotOf(mandate, terms), raw ? normaliseChange(raw) : undefined);
  const can = editableFor(run);
  let extra: Pick<RulesCard, "proposal" | "after" | "diff"> = { diff: [] };
  if (raw) {
    const change = normaliseChange(raw);
    if (!Object.keys(change).length) {
      st.fail("not a change the mandate can state");
      throw new DockError(400, "rules_change_empty", "That is not a change the mandate can state: allergens and claims it has data for, limits in whole euros, a signer's name.");
    }
    const kind = kindOf(change);
    let after: RulesSnapshot;
    try {
      after = snapshotAfter(before, change, terms);
    } catch (e) {
      st.fail(e instanceof DockError ? e.message : "invalid");
      throw e;
    }
    const diff = diffOf(before, after);
    const proposalId = `rp_${run.turnId.replace(/^[a-z]+_?/i, "")}`;
    proposalsOf(run)[proposalId] = { proposalId, change, kind, turnId: run.turnId, state: "open" };
    const canSign = diff.length > 0 && (kind === "terms" ? can.terms : can.narrow);
    const why = diff.length === 0 ? "nothing_changes" : canSign ? undefined : (can.why ?? "terms_fixed");
    extra = { proposal: { proposalId, change, kind, state: "open", canSign, ...(why ? { why } : {}) }, after, diff };
    record(run, "rules_proposed", `A change to ${run.k.info.name}'s rules was proposed (${kind === "narrow" ? "narrower" : "new terms"}): ${describe(diff)}. Nothing is signed yet.`, { proposalId, change, kind, diff, canSign, ...(why ? { why } : {}) });
    run.store.save(run.thread);
  }
  st.done();
  // This week's spend (committed, and held by orders waiting for an OK): "how much budget is left?" is answered from it.
  const b = await run.rt.dock.budget(run.session).catch(() => undefined);
  const card = { ...cardFor(run, extra.proposal?.proposalId ?? run.turnId, mandate, before, await statedOf(run), extra), ...(b ? { week: { spentCents: b.spentCents, heldCents: b.heldCents, leftCents: Math.max(0, b.leftCents) } } : {}) };
  run.store.card(run.thread, run.turnId, card);
  run.facts.push(card);
  return card;
}

/**
 * Whether a change needs the named approver's passkey before it takes effect: anything that WIDENS what the agent may
 * do (a product group added, a limit or budget or lead time raised, an allergen or required claim taken away, a looser
 * substitution) or changes who signs. A narrowing (a rule added, a limit lowered) takes the signed-in person's yes.
 */
export function needsSignOff(diff: RulesCard["diff"]): boolean {
  return diff.some((d) => d.widens || d.field === "signer");
}

/** What the approver signs: the kitchen, the mandate it changes, the proposal and the exact change. */
export function changeDigest(input: { orgId: string; mandateId: string; proposalId: string; change: RulesChange }): string {
  return sha256Hex(canonicalJson({ purpose: "dock.rules_change.v1", ...input }));
}

/** A proposal's sign-off as the passkey verifier reads it (core/approval.ts Approval), with no link token. */
export function rulesApproval(run: Pick<TurnRun, "thread" | "k">, proposalId: string): { approval: Approval; orgId: string; digest: string } | undefined {
  const p = ((run.thread as unknown as WithProposals).rulesProposals ?? {})[proposalId];
  if (!p?.approval || p.state !== "waiting" || lapsed(p)) return undefined;
  return {
    approval: { approvalId: p.approval.approvalId, approver: { role: p.approval.approver.role, name: p.approval.approver.name, maxApprovalCents: 0 } as Approval["approver"], status: "pending", orderDigest: p.approval.digest, tokenHash: "0".repeat(64), requestedAt: p.approval.requestedAt },
    orgId: run.k.info.orgId,
    digest: p.approval.digest,
  };
}

/** A person's name for a sentence: never a username in brackets ("Hotel Lumo kitchen (hotel-lumo)" says "Hotel Lumo kitchen"). */
const nameOf = (s: string) => s.replace(/\s*\([^)]*\)/g, "").trim();

/**
 * Sign an open proposal: the kitchen's own person, through the mechanism its kind of kitchen has. A change that widens
 * what the agent may do goes to the named approver instead and waits; it is signed later only with their verified
 * passkey over that exact change (`opts.signOff`), on their phone or in this browser. That later signing needs no
 * signed-in person here: the person was checked when it was sent, and the approver's passkey is the authority.
 */
export async function signRules(run: TurnRun, proposalId: string, opts: { signOff?: SignOff } = {}): Promise<RulesCard> {
  const p = proposalsOf(run)[proposalId];
  const approverSigns = !!opts.signOff && p?.state === "waiting";
  if (!p || (p.state !== "open" && !approverSigns)) throw new DockError(409, "turn_card_stale", p?.state === "waiting" ? "That change waits for the approver's passkey." : "That change is no longer open.", "intake_sequence");
  if (approverSigns && lapsed(p)) {
    await expireRules(run, proposalId);
    throw new DockError(409, "rules_change_expired", "This change was not signed in time; nothing changed. Ask the agent again if it is still needed.", "intake_sequence");
  }
  const can = editableFor(run);
  const by = approverSigns && opts.signOff!.method === "passkey" ? opts.signOff!.approverName : run.person?.name;
  if (!approverSigns) {
    if (!by || !can.narrow) {
      record(run, "rules_refused", "Signing a change to the kitchen's rules was refused: no signed-in person of the kitchen.", { proposalId, why: can.why ?? "kitchen_person_required" });
      throw new DockError(401, "kitchen_person_required", "Changing the kitchen's rules needs the kitchen's own signed-in person.", "data_access");
    }
    if (p.kind === "terms" && !can.terms) {
      record(run, "rules_refused", `Signing new terms was refused: ${can.why}.`, { proposalId, why: can.why });
      throw new DockError(
        403,
        can.why === "demo_terms_fixed" ? "demo_mandate_fixed" : "terms_not_yours",
        can.why === "demo_terms_fixed" ? "A built-in demo kitchen's limits are fixed for the stage; its rules can still be narrowed." : can.why === "visitor_terms_fixed" ? "A visitor's kitchen can add rules, but its limits, budget and signer were fixed when it joined." : "Only the kitchen's own account, signed in, can change its limits, budget or signer.",
        "data_access",
      );
    }
  }
  const { mandate, terms } = await current(run);
  if (p.kind === "terms" && !terms) throw new DockError(409, "rules_change_stale", "This kitchen's limits cannot be changed here.", "intake_sequence");
  const before = await withRenew(run, snapshotOf(mandate, terms), p.change);
  const diffNow = diffOf(before, snapshotAfter(before, p.change, terms));
  // A widening takes effect only with the named approver's passkey over this exact change: a typed yes (or a model
  // that reads one) sends it to them instead, through the same sign-off as an order over the limit.
  if (needsSignOff(diffNow)) {
    const digest = changeDigest({ orgId: run.k.info.orgId, mandateId: mandate.mandateId, proposalId, change: p.change });
    const ok = opts.signOff && opts.signOff.verified && opts.signOff.decision === "approve" && opts.signOff.method === "passkey" && opts.signOff.orderDigest === digest && p.approval?.digest === digest;
    // Signed for rules that have moved since (another change was signed in between): not this change any more.
    if (approverSigns && !ok) throw new DockError(409, "rules_change_stale", "The kitchen's rules changed after this was asked, so this signature is for something else. Nothing changed; ask the agent again.", "intake_sequence");
    if (!ok) {
      const approver = { name: mandate.approvers[0]?.name ?? "the kitchen's signer", role: (run.k.info as { approverRole?: string }).approverRole ?? mandate.approvers[0]?.role ?? "kitchen_signer" };
      const at = new Date();
      p.state = "waiting";
      p.approval = {
        approvalId: `rch_${proposalId.replace(/^rp_/, "")}`,
        digest,
        mandateId: mandate.mandateId,
        approver,
        requestedAt: at.toISOString(),
        expiresAt: new Date(at.getTime() + RULES_SIGNOFF_MS).toISOString(),
        requestedBy: nameOf(by ?? run.k.info.name),
        ...(run.lang ? { lang: run.lang } : {}),
        shown: diffNow,
      };
      record(run, "rules_signoff_requested", `A change that widens what the agent may do (${describe(diffNow.filter((d) => d.widens || d.field === "signer"))}) waits for ${approver.name}'s passkey; nothing is changed yet.`, { proposalId, approvalId: p.approval.approvalId, digest, diff: diffNow, approver });
      run.store.save(run.thread);
      const card = cardFor(run, proposalId, mandate, before, await statedOf(run), { proposal: { proposalId, change: p.change, kind: p.kind, state: "waiting", canSign: false, approval: { approvalId: p.approval.approvalId, approver, expiresAt: p.approval.expiresAt } }, after: snapshotAfter(before, p.change, terms), diff: diffNow });
      run.store.card(run.thread, run.turnId, card);
      run.facts.push(card);
      run.rulesWaiting = card;
      return card;
    }
  }
  const st = step(run, "rules", "Saving your new rules");
  try {
    if (p.kind === "auto_renew") {
      const { setAutoRenew } = await import("@/server/watch/service");
      for (const family of p.change.autoRenewOn ?? []) await setAutoRenew(run.rt, run.session, { family, on: true, by: by!, via: opts.signOff?.method === "passkey" ? "passkey sign-off" : "the kitchen's conversation" });
      record(run, "rules_signed", `${by} switched auto-renew on for ${(p.change.autoRenewOn ?? []).join(", ")} at ${run.k.info.name}${opts.signOff?.method === "passkey" ? ", signed with a passkey" : ""}.`, { proposalId, kind: p.kind, families: p.change.autoRenewOn, by, mechanism: "auto_renew", ...(opts.signOff ? { signOff: opts.signOff } : {}) });
    } else if (p.kind === "narrow") {
      const r = await reissueKitchenMandate(run.rt, run.k.info, { forbiddenAllergens: p.change.forbidAdd ?? [], requiredAttributes: p.change.requireAdd ?? [] }, by!);
      record(run, "rules_signed", `${by} signed a narrower mandate for ${run.k.info.name} (${r.mandateId}, replacing ${r.replaced}).`, { proposalId, kind: p.kind, mandateId: r.mandateId, replaced: r.replaced, before: r.before, after: r.after, by, mechanism: "mandate_reissue" });
    } else {
      const signed = await run.rt.accounts.signKitchen(run.k.info.slug, termsAfter(terms!, p.change));
      const m = signed.kitchen!.mandate;
      record(run, "rules_signed", `${opts.signOff?.method === "passkey" ? `${opts.signOff.approverName} signed with a passkey` : by + " signed"} new terms for ${run.k.info.name} (${m.mandateId}, replacing ${mandate.mandateId}).`, { proposalId, kind: p.kind, mandateId: m.mandateId, replaced: mandate.mandateId, before, after: snapshotOf(m, signed.kitchen!.terms), by, mechanism: "account_terms", ...(opts.signOff ? { signOff: opts.signOff } : {}) });
    }
  } catch (e) {
    st.fail(e instanceof DockError ? e.code : "failed");
    throw e;
  }
  p.state = "signed";
  if (p.approval && opts.signOff) p.approval.decided = { decision: "approved", by: by ?? p.approval.approver.name, at: opts.signOff.at, method: opts.signOff.method };
  st.done();
  // The thread's next turns present the new mandate: resolveKitchen reads it fresh every turn.
  const now = await current(run);
  const after = await withRenew(run, snapshotOf(now.mandate, now.terms), p.change);
  const card = cardFor(run, proposalId, now.mandate, after, await statedOf(run), { proposal: { proposalId, change: p.change, kind: p.kind, state: "signed", canSign: false, signedAs: now.mandate.mandateId, ...(p.approval ? { approval: { approvalId: p.approval.approvalId, approver: p.approval.approver, ...(p.approval.decided ? { decided: { by: p.approval.decided.by, at: p.approval.decided.at } } : {}) } } : {}) }, after, diff: diffOf(before, after) });
  run.store.card(run.thread, run.turnId, card);
  run.facts.push(card);
  run.store.save(run.thread);
  return card;
}

/** The approver said no (on their phone, or in this browser): nothing changes, and the conversation shows it. */
export async function declineRules(run: TurnRun, proposalId: string, d: { by: string; at: string; method: string; note?: string }): Promise<RulesCard> {
  const p = proposalsOf(run)[proposalId];
  if (!p || p.state !== "waiting" || !p.approval) throw new DockError(409, "rules_change_not_waiting", "That change is not waiting for a sign-off.", "intake_sequence");
  if (lapsed(p)) {
    await expireRules(run, proposalId);
    throw new DockError(409, "rules_change_expired", "This change was not signed in time; nothing changed.", "intake_sequence");
  }
  p.state = "declined";
  p.approval.decided = { decision: "declined", by: d.by, at: d.at, method: d.method, ...(d.note ? { note: d.note.slice(0, 300) } : {}) };
  record(run, "rules_declined", `${d.by} declined the change to ${run.k.info.name}'s rules (${describe(p.approval.shown ?? [])}); nothing changed.`, { proposalId, approvalId: p.approval.approvalId, by: d.by, method: d.method, ...(d.note ? { note: d.note.slice(0, 300) } : {}) });
  return closedCard(run, p, "declined");
}

/** A change nobody signed in time: it lapses, nothing changes. */
export async function expireRules(run: TurnRun, proposalId: string): Promise<RulesCard | undefined> {
  const p = proposalsOf(run)[proposalId];
  if (!p || p.state !== "waiting" || !p.approval) return undefined;
  p.state = "expired";
  record(run, "rules_expired", `The change to ${run.k.info.name}'s rules was not signed in time (by ${p.approval.expiresAt}); nothing changed.`, { proposalId, approvalId: p.approval.approvalId });
  return closedCard(run, p, "expired");
}

async function closedCard(run: TurnRun, p: Proposal, state: "declined" | "expired"): Promise<RulesCard> {
  const { mandate, terms } = await current(run);
  const now = snapshotOf(mandate, terms);
  const card = cardFor(run, p.proposalId, mandate, now, await statedOf(run), { proposal: { proposalId: p.proposalId, change: p.change, kind: p.kind, state, canSign: false, ...(p.approval ? { approval: { approvalId: p.approval.approvalId, approver: p.approval.approver, ...(p.approval.decided ? { decided: { by: p.approval.decided.by, at: p.approval.decided.at, ...(p.approval.decided.note ? { note: p.approval.decided.note } : {}) } } : {}) } } : {}) }, diff: p.approval?.shown ?? [] });
  run.store.card(run.thread, run.turnId, card);
  run.store.save(run.thread);
  return card;
}

/** Drop an open proposal: nothing was signed; the card shows the rules as they stand. */
export async function cancelRules(run: TurnRun, proposalId: string): Promise<RulesCard> {
  const p = proposalsOf(run)[proposalId];
  if (!p || p.state !== "open") throw new DockError(409, "turn_card_stale", "That change is no longer open.", "intake_sequence");
  p.state = "cancelled";
  record(run, "rules_cancelled", "The proposed change to the kitchen's rules was dropped; nothing was signed.", { proposalId });
  const { mandate, terms } = await current(run);
  const now = snapshotOf(mandate, terms);
  const card = cardFor(run, proposalId, mandate, now, await statedOf(run), { proposal: { proposalId, change: p.change, kind: p.kind, state: "cancelled", canSign: false }, diff: [] });
  run.store.card(run.thread, run.turnId, card);
  run.store.save(run.thread);
  return card;
}
