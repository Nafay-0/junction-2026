import { activeMemory, isoWeekday, memoryItemIdOf, type KitchenProfile, type MemoryItem } from "@/core/kitchen";
import type { StructuredNeed } from "@/core/need";
import { factLabel, type MemoryItemView } from "./model";
import { cosine, LexicalEmbedder } from "./vectors";

/**
 * Recall: given a new request, the remembered items that matter for it, in a compact form for the interpreter and
 * the intake, and one line per use for the card ("Lactose-free applied: stated by Sanna Koskinen on 3 Nov").
 *
 * What gets in, and why (scores add up; an item needs RECALL_MIN_SCORE, except safety rules, which always do):
 *   +3  same product family as the request; +1 an item for every family
 *   +3  about a product the request names
 *   +2  a delivery-day or standing-order item for the requested weekday
 *   +4 x similarity of wording (embeddings: lexical in process, or the vector index)
 *   +1  a rule; + weight for a habit
 */
export const RECALL_MIN_SCORE = 2.5;
export const RECALL_LIMIT = 10;

export type RecallQuery = { text?: string; family?: string; dish?: string; productIds?: string[]; deliverBy?: string; site?: string; person?: string };
export type RecallUse = "constrains" | "pre-selects" | "checks" | "context";
export type Recalled = { itemId: string; text: string; label: string; use: RecallUse; provenance: string; score: number; why: string[] };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDay = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/** Who stands behind an item, in a few words: "stated by Sanna Koskinen on 3 Nov", "learned from 6 orders". */
export function provenance(m: MemoryItem | MemoryItemView): string {
  if (m.confirmedBy) return `${m.origin === "inferred" ? "confirmed" : "stated"} by ${m.confirmedBy.by} on ${shortDay(m.confirmedBy.at)}`;
  const orders = new Set(m.sources.flatMap((s) => (s.orderId ? [s.orderId] : []))).size;
  if (m.origin === "learned") return orders ? `learned from ${orders} order${orders > 1 ? "s" : ""}` : `learned from ${m.confirmations} choice${m.confirmations > 1 ? "s" : ""}`;
  const s = [...m.sources].reverse().find((x) => x.by);
  return s ? `said by ${s.by} on ${shortDay(s.at)}` : "remembered";
}

export function recallUse(m: MemoryItem): RecallUse {
  const f = m.fact;
  if (m.strength === "one_off") return "context";
  if (m.strength === "rule") return f.kind === "allergen" || f.kind === "diet" || f.kind === "spec" || f.kind === "goal" || f.kind === "delivery_days" ? "constrains" : "checks";
  if (f.kind === "spec" || f.kind === "goal" || ((f.kind === "product" || f.kind === "brand" || f.kind === "pack") && f.stance === "prefer")) return "pre-selects";
  if (f.kind === "note" || f.kind === "seasonal" || f.kind === "budget" || f.kind === "receiving_hours") return "context";
  return "checks";
}

const lexical = new LexicalEmbedder();

export function recall(profile: KitchenProfile, q: RecallQuery, opts: { now: Date; similarity?: Map<string, number>; limit?: number } ): { items: Recalled[]; forInterpreter: string } {
  const items = activeMemory(profile, { site: q.site, person: q.person, now: opts.now }).filter((m) => m.status === "active");
  const text = [q.text, q.dish, q.family].filter(Boolean).join(" ");
  const qv = text ? lexical.vector(text) : undefined;
  const day = q.deliverBy ? isoWeekday(q.deliverBy) : undefined;
  const scored: Recalled[] = [];
  for (const m of items) {
    const why: string[] = [];
    let score = 0;
    const bump = (n: number, reason: string) => {
      score += n;
      why.push(reason);
    };
    if (q.family && m.family === q.family) bump(3, "same family");
    else if (!m.family) bump(1, "every family");
    else if (q.family) score -= 1;
    const f = m.fact;
    if (q.productIds?.length && "productId" in f && f.productId && q.productIds.includes(f.productId)) bump(3, "the product asked for");
    if (day && (f.kind === "delivery_days" || f.kind === "standing_order")) bump(2, "delivery day");
    const sim = opts.similarity?.get(m.id) ?? (qv ? cosine(qv, lexical.vector(`${m.text} ${m.family ?? ""}`)) : 0);
    if (sim > 0.15) bump(4 * sim, `wording ${sim.toFixed(2)}`);
    score += m.strength === "rule" ? 1 : m.strength === "habit" ? m.weight : 0;
    const always = m.safety && m.strength === "rule";
    if (always) why.unshift("safety rule: always");
    if (!always && score < RECALL_MIN_SCORE) continue;
    scored.push({ itemId: m.id, text: m.text, label: factLabel(m.fact), use: recallUse(m), provenance: provenance(m), score: Math.round((always ? 100 + score : score) * 100) / 100, why });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, opts.limit ?? RECALL_LIMIT);
  const tag: Record<RecallUse, string> = { constrains: "RULE", "pre-selects": "HABIT", checks: "CHECK", context: "NOTE" };
  const forInterpreter = top.length
    ? [
        "What this kitchen's memory says. RULE: apply it, do not ask. HABIT: use it when the request is silent. CHECK: mention it if the request goes against it. NOTE: context only.",
        ...top.map((r) => `${tag[r.use]} ${r.text} (${r.provenance})`),
      ].join("\n")
    : "";
  return { items: top, forInterpreter };
}

/**
 * Rules for one site or person, applied to a request from that site. Kitchen-wide rules need nothing here: they
 * are stated preferences already, which the intake enforces.
 */
export function applyScopedRules(need: StructuredNeed, profile: KitchenProfile, scope: { site?: string; person?: string }, now: Date): { need: StructuredNeed; applied: { itemId: string; text: string }[] } {
  const next = structuredClone(need);
  const applied: { itemId: string; text: string }[] = [];
  if (!scope.site && !scope.person) return { need: next, applied };
  for (const m of activeMemory(profile, { ...scope, now })) {
    if (!m.scope || m.strength !== "rule" || (m.family && need.item.category && m.family !== need.item.category)) continue;
    if (m.fact.kind === "allergen" && !next.forbiddenAllergens.includes(m.fact.allergen)) next.forbiddenAllergens.push(m.fact.allergen);
    else if (m.fact.kind === "diet" && !next.requiredClaims.includes(m.fact.claim)) next.requiredClaims.push(m.fact.claim);
    else continue;
    applied.push({ itemId: m.id, text: `${factLabel(m.fact)} applied for ${m.scope.site ?? m.scope.person}: ${provenance(m)}` });
  }
  return { need: next, applied };
}

type IntakeLike = {
  rules: { text: string; source: string; preferenceId?: string }[];
  fromMemory: { label: string; source: string; text: string; preferenceId?: string; memoryItemId?: string; optionId?: string; question: { text: string; dimension?: string } }[];
  concerns: { code: string; memoryItemIds?: string[] }[];
};

/** What the screen needs to say a remembered fact in the buyer's language: its kind and the codes it rests on. */
function factParams(f: MemoryItem["fact"]): Record<string, string | number> {
  switch (f.kind) {
    case "diet":
      return { kind: f.kind, claim: f.claim };
    case "allergen":
      return { kind: f.kind, allergen: f.allergen };
    case "spec":
      return { kind: f.kind, dimension: f.dimension, choice: f.choice };
    case "product":
      return { kind: f.kind, name: f.name, stance: f.stance };
    case "brand":
      return { kind: f.kind, brand: f.brand, stance: f.stance };
    case "goal":
      return { kind: f.kind, goal: f.goal };
    case "standing_order":
      return { kind: f.kind, weekdays: f.weekdays.join(","), amount: f.amount, unit: f.unit, low: f.low, high: f.high };
    case "delivery_days":
      return { kind: f.kind, weekdays: f.weekdays.join(",") };
    default:
      return { kind: f.kind };
  }
}

/** Where a remembered item came from, as data: who stated or confirmed it and when, or how many orders taught it. */
function provenanceParams(m: MemoryItem): Record<string, string | number> {
  if (m.confirmedBy) return { how: m.origin === "inferred" ? "confirmed" : "stated", by: m.confirmedBy.by, at: m.confirmedBy.at.slice(0, 10) };
  const orders = new Set(m.sources.flatMap((s) => (s.orderId ? [s.orderId] : []))).size;
  if (m.origin === "learned") return orders ? { how: "learned_orders", n: orders } : { how: "learned_choices", n: m.confirmations };
  const s = [...m.sources].reverse().find((x) => x.by);
  return s ? { how: "said", by: s.by!, at: s.at.slice(0, 10) } : { how: "remembered" };
}

/** One line per remembered thing the intake used, for the card. Also the item ids, so their last use is recorded. */
export type UsageLine = { itemId?: string; text: string; code?: "applied" | "preselected" | "checked"; params?: Record<string, string | number> };

export function usageLines(profile: KitchenProfile, intake: IntakeLike): { lines: UsageLine[]; itemIds: string[] } {
  const items = new Map((profile.memory?.items ?? []).map((m) => [m.id, m]));
  const byPref = new Map((profile.memory?.items ?? []).flatMap((m) => (m.derived?.preferenceId ? [[m.derived.preferenceId, m] as const] : [])));
  const itemFor = (prefId?: string, itemId?: string) => (itemId && items.get(itemId)) || (prefId && (byPref.get(prefId) ?? items.get(memoryItemIdOf(prefId) ?? ""))) || undefined;
  const lines: UsageLine[] = [];
  const seen = new Set<string>();
  // The text stays as it was (ledger, voice, MCP); code and params let a screen say the same in another language.
  const add = (m: MemoryItem | undefined, text: string, code?: UsageLine["code"], params?: Record<string, string | number>) => {
    if (m && seen.has(m.id)) return;
    if (m) seen.add(m.id);
    lines.push({ ...(m ? { itemId: m.id } : {}), text, ...(code ? { code } : {}), ...(params ? { params } : {}) });
  };
  for (const r of intake.rules) {
    if (r.source !== "stated") continue;
    const m = itemFor(r.preferenceId);
    if (m) add(m, `${factLabel(m.fact)} applied: ${provenance(m)}`, "applied", { ...factParams(m.fact), label: factLabel(m.fact), ...provenanceParams(m) });
    else {
      // A rule a person stated before typed memory existed (or on the portal's rules page): still one line.
      const pref = profile.stated.find((p) => p.id === r.preferenceId);
      const text = `${pref?.text ?? r.text} applied${pref ? `: stated by ${pref.statedBy} on ${shortDay(pref.statedAt)}` : ""}`;
      if (!lines.some((l) => l.text === text)) lines.push({ text, code: "applied", params: { kind: "rule", label: pref?.text ?? r.text, ...(pref ? { how: "stated", by: pref.statedBy, at: pref.statedAt.slice(0, 10) } : {}) } });
    }
  }
  for (const n of intake.fromMemory) {
    const m = itemFor(n.preferenceId, n.memoryItemId);
    const code = n.source === "stated" ? "applied" : "preselected";
    if (m) add(m, `${factLabel(m.fact)} ${n.source === "stated" ? "applied" : "pre-selected"}: ${provenance(m)}`, code, { ...factParams(m.fact), label: factLabel(m.fact), ...provenanceParams(m) });
    else if (n.source === "learned") add(undefined, `${n.label} pre-selected: ${n.text.replace(/^Pre-selected from history: /, "")}`, "preselected", { kind: "learned", label: n.label, ...(n.question?.dimension ? { dimension: n.question.dimension, choice: n.optionId } : {}) });
  }
  for (const c of intake.concerns) for (const id of c.memoryItemIds ?? []) {
    const m = items.get(id);
    if (m) add(m, `Checked against memory: ${m.text} (${provenance(m)})`, "checked", { ...factParams(m.fact), label: m.text, ...provenanceParams(m) });
  }
  return { lines, itemIds: [...seen] };
}
