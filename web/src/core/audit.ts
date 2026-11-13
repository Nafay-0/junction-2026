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
  kind: "asked" | "claimed" | "quoted" | "decided" | "signed" | "committed" | "refused" | "private";
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
