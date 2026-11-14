import { explain, type LedgerEntry } from "./ledger";
import { formatEur } from "./util";

/**
 * Two readings of the same hash-chained ledger.
 *
 *   buyer       everything, in plain language (ledger.explain): the request, the kitchen memory Dock used, the
 *               questions and answers, lookups, quotes, the gate's reasons, sign-offs, the commit.
 *   wholesaler  the same chain as the wholesaler needs it: what was asked, what the wholesaler claimed (live
 *               lookups and the signed claims issued), what was committed at which price, and who signed. The
 *               buyer's private memory (order history, stated and learned preferences, mistake checks and the
 *               answers to them) is left out: those entries appear only as "kept with the buyer", with their
 *               sequence number and hash, so the wholesaler can still see the chain has no gaps and match it to the
 *               head printed on every signed order confirmation.
 */

export type AuditView = "buyer" | "wholesaler";

export type WholesalerAuditEntry = {
  seq: number;
  at: string;
  hash: string;
  type: LedgerEntry["type"];
  requestId?: string;
  orderId?: string;
  kind: "asked" | "claimed" | "quoted" | "decided" | "signed" | "committed" | "refused" | "control" | "offered" | "watched" | "notified" | "private";
  summary: string;
  data?: Record<string, unknown>;
};

const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/** Intake steps the wholesaler may see: the structured need (what was asked) and the option chosen. Nothing from memory. */
function intakeForWholesaler(e: LedgerEntry): Omit<WholesalerAuditEntry, "seq" | "at" | "hash" | "type" | "requestId" | "orderId"> {
  const d = e.data as Record<string, unknown>;
  if (d.step === "need") {
    const need = (d.need ?? {}) as Record<string, unknown>;
    return { kind: "asked", summary: "Structured need submitted.", data: { need: pick(need, ["item", "quantity", "deliverBy", "requiredClaims", "requiredLabels", "forbiddenAllergens", "optimise"]) } };
  }
  if (d.step === "choice") return { kind: "asked", summary: `Option ${String(d.optionId)} chosen (${(d.labels as string[] | undefined)?.join(", ") || "no label"}).`, data: pick(d, ["optionId", "labels", "lines"]) };
  if (d.step === "compromise") return { kind: "asked", summary: "The buyer accepted a later delivery date.", data: pick(d, ["optionId", "givesUp"]) };
  // The menu scenarios' decisions: what is in season, what could not arrive and why, the options shown and the one
  // chosen, by whom. On hand: only that a shortfall was bought and how much, never the history behind the estimate.
  if (d.step === "seasonal_anchor") return { kind: "asked", summary: e.summary, data: pick(d, ["anchor", "products", "source"]) };
  if (d.step === "cannot_arrive") return { kind: "asked", summary: e.summary, data: pick(d, ["deliverBy", "lines"]) };
  if (d.step === "substitution_options") return { kind: "asked", summary: "Substitutes by recipe logic offered for what cannot arrive.", data: pick(d, ["options"]) };
  if (d.step === "substitution_chosen") return { kind: "asked", summary: e.summary, data: pick(d, ["lineId", "optionId", "rank", "kind", "by", "signOff"]) };
  if (d.step === "on_hand") return { kind: "asked", summary: "Some lines are bought short: the kitchen has part of them on hand (its own estimate, kept with the buyer).", data: { lines: ((d.lines as Record<string, unknown>[] | undefined) ?? []).map((l) => pick(l, ["lineId", "toBuy", "estimate"])) } };
  if (d.step === "needed_by") return { kind: "asked", summary: `Need-by date changed from ${String(d.from ?? "the earliest possible")} to ${String(d.to ?? "the earliest possible")}.`, data: pick(d, ["from", "to"]) };
  return { kind: "private", summary: "Buyer-side intake step, kept with the buyer." };
}

export function wholesalerEntry(e: LedgerEntry): WholesalerAuditEntry {
  const base = { seq: e.seq, at: e.at, hash: e.hash, type: e.type, requestId: e.requestId, orderId: e.orderId };
  const d = e.data;
  switch (e.type) {
    case "request":
      return { ...base, kind: "asked", summary: `${e.actor} asked: "${String(d.text)}"${d.neededBy ? `, needed by ${String(d.neededBy)}` : ""}.`, data: pick(d, ["text", "neededBy", "mandateId"]) };
    case "intake":
      return { ...base, ...intakeForWholesaler(e) };
    case "lookup":
      if (d.source !== "live") return { ...base, kind: "private", summary: "Master-data search by the buyer's agent (no live call)." };
      if (d.failed) return { ...base, kind: "claimed", summary: "The live price/availability service did not answer.", data: pick(d, ["code", "productIds"]) };
      return { ...base, kind: "claimed", summary: e.summary.replace(/^.*?(for \d+ product)/, "Live lookup $1"), data: pick(d, ["productIds", "deliveryDate", "claimIds", "unavailable"]) };
    case "quote":
      return { ...base, kind: "quoted", summary: `Quote ${String(d.quoteId)} for ${formatEur(Number(d.totalCents))}, fixed until ${String(d.expiresAt)}${d.expiresBecause ? ` (${String(d.expiresBecause)})` : ""}; rests on ${(d.evidence as unknown[] | undefined)?.length ?? 0} signed claims.`, data: pick(d, ["quoteId", "totalCents", "expiresAt", "expiresBecause", "evidence", "lines"]) };
    case "decision":
      return { ...base, kind: "decided", summary: e.summary, data: pick(d, ["outcome", "totalCents", "rules", "reasons", "approver"]) };
    case "approval_requested":
      return { ...base, kind: "signed", summary: e.summary, data: pick(d, ["approvalId", "role", "orderDigest"]) };
    case "approval": {
      const signOff = (d.signOff ?? {}) as Record<string, unknown>;
      return { ...base, kind: "signed", summary: `${e.actor} ${String(d.decision)} the order (${String(signOff.method ?? "?")}${signOff.verified === false ? ", UNVERIFIED" : ""}).`, data: { decision: d.decision, orderDigest: d.orderDigest, signOff: pick(signOff, ["method", "verified", "at", "orderDigest", "credentialId"]) } };
    }
    case "order":
      return { ...base, kind: "committed", summary: e.summary, data: pick(d, ["authorisedBy", "ledgerHead"]) };
    case "refusal":
      return { ...base, kind: "refused", summary: e.summary, data: pick(d, ["code", "rule", "status"]) };
    case "control":
      // The wholesaler's own act (an operator suspended or resumed an agent): theirs to read in full.
      return { ...base, kind: "control", summary: e.summary, data: pick(d, ["action", "scope", "target", "suspensionId", "reason", "by"]) };
    case "offer":
      // The selling agent's offers and the kitchen's answers to them: both sides read them in full (what was offered,
      // why, at what price, and accepted, declined or muted). Nothing of the kitchen's memory is in them.
      return { ...base, kind: "offered", summary: e.summary, data: pick(d, ["step", "offerId", "productId", "reasons", "line", "price", "validUntil", "rule", "reason", "campaignId", "answer", "scope", "by", "requestId"]) };
    case "watch":
      // The kitchen agent's watch (server/watch): what could not come and what it proposed, a recurring order renewed
      // or held and why, a condition staff staged for a demo. Both sides read the step and its products; the figures
      // are the kitchen's own orders and the wholesaler's live answers.
      return { ...base, kind: "watched", summary: e.summary, data: pick(d, ["step", "findingId", "renewalId", "productId", "family", "deliveryDate", "staged", "decision", "choice", "by", "requestId", "orderId", "outcome", "claimId"]) };
    case "mail":
      // An email to the kitchen (server/notify): which event, the outcome, why it was not sent. The entry never holds
      // the address or the mail's body, so both sides read it in full.
      return { ...base, kind: "notified", summary: e.summary, data: pick(d, ["step", "kind", "eventKey", "outcome", "reason", "providerId"]) };
    case "agent":
      // The kitchen's conversation with its own agent: the buyer's words and the agent's work stay with the buyer.
      return { ...base, kind: "private", summary: "Buyer-side conversation step, kept with the buyer." };
  }
}

/** The ledger as one side reads it: plain-language lines and the entries behind them. */
export function auditFor(view: AuditView, entries: readonly LedgerEntry[]): { view: AuditView; explanation: string[]; entries: (LedgerEntry | WholesalerAuditEntry)[] } {
  if (view === "buyer") return { view, explanation: explain(entries), entries: [...entries] };
  const projected = entries.map(wholesalerEntry);
  const lines: string[] = [];
  let hidden = 0;
  const flush = () => {
    if (hidden) lines.push(`          (${hidden} buyer-side step${hidden > 1 ? "s" : ""} kept with the buyer)`);
    hidden = 0;
  };
  for (const e of projected) {
    if (e.kind === "private") {
      hidden += 1;
      continue;
    }
    flush();
    lines.push(`${e.at.slice(11, 19)}  [${e.kind}] ${e.summary}`);
    const reasons = e.kind === "decided" ? (e.data?.reasons as unknown[] | undefined) : undefined;
    if (Array.isArray(reasons)) for (const r of reasons) lines.push(`          - ${String(r)}`);
  }
  flush();
  return { view, explanation: lines, entries: projected };
}
