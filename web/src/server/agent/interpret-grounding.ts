import { allergensMentioned, claimsIn, dayStated, numbersIn, type Violation } from "@/core/grounding";
import { recordGrounding } from "@/server/grounding";
import type { LlmNeed } from "./interpret";

/**
 * The interpreter's output through the grounding check (core/grounding.ts), before plain code builds the need:
 * the model may only record what the buyer's words say (or an earlier request they refer to, or what the caller
 * passes as evidence, such as the kitchen's remembered rules). A dietary claim, a forbidden allergen, a product
 * id, an amount or a date nobody said is removed, never kept: a missing amount then comes back as need_incomplete
 * and the buyer gives it, and a removed claim is still enforced where it belongs (the mandate, the kitchen's rules).
 */
export type InterpretEvidence = {
  text: string;
  earlier?: unknown[];
  extra?: string[];
  /** Today in Helsinki (YYYY-MM-DD): a delivery day must then be one the words name (core/grounding.ts dayStated). */
  today?: string;
};

export function groundInterpretation<T extends Pick<LlmNeed, "item" | "quantity" | "deliverBy" | "requiredClaims" | "forbiddenAllergens" | "sameAsLastTime">>(raw: T, ev: InterpretEvidence): { raw: T; removed: Violation[] } {
  const words = [ev.text, ...(ev.extra ?? [])].join("\n");
  const earlier = ev.earlier?.length ? JSON.stringify(ev.earlier) : "";
  const all = `${words}\n${earlier}`;
  const removed: Violation[] = [];
  const out = structuredClone(raw);
  const said = new Set(claimsIn(all.replace(/_/g, " ")).filter((c) => !c.negated).map((c) => c.claim));
  const claimBacked = (tag: string) => {
    const c = claimsIn(tag.replace(/_/g, " "));
    return !c.length || c.every((x) => said.has(x.claim));
  };
  const dropClaims = (tags: string[]) =>
    tags.filter((t) => {
      if (claimBacked(t)) return true;
      removed.push({ kind: "claim", said: t });
      return false;
    });
  out.requiredClaims = dropClaims(out.requiredClaims);
  out.item = { ...out.item, attributes: dropClaims(out.item.attributes) };
  // The item's words: a claim in them that the buyer did not make is taken out ("lactose-free milk" for "milk").
  if (out.item.text) {
    let t = out.item.text;
    for (const c of claimsIn(t)) if (!c.negated && !said.has(c.claim)) {
      t = t.replace(c.said, "").replace(/\s{2,}/g, " ").trim();
      removed.push({ kind: "claim", said: c.said });
    }
    out.item.text = t || out.item.text;
  }
  const mentioned = allergensMentioned(all);
  out.forbiddenAllergens = out.forbiddenAllergens.filter((a) => {
    const code = a.toLowerCase().replace(/[\s-]+/g, "_");
    const ok = mentioned.has(code) || mentioned.has(code.replace(/s$/, "")) || mentioned.has(`${code}s`) || [...allergensMentioned(code)].some((x) => mentioned.has(x));
    if (!ok) removed.push({ kind: "allergen", said: a });
    return ok;
  });
  if (out.item.productId && !all.includes(out.item.productId.trim())) {
    removed.push({ kind: "product", said: out.item.productId });
    out.item = { ...out.item, productId: null };
  }
  if (out.quantity) {
    const nums = numbersIn(all).map((n) => n.value);
    const a = out.quantity.amount;
    const near = (x: number) => Math.abs(x - a) < 1e-6 * Math.max(1, a);
    const backed = nums.some((n) => near(n) || near(n / 1000) || near(n / 10) || near(n / 100) || near(n * 1000)) || nums.some((x, i) => nums.some((y, j) => i !== j && near(x * y)));
    if (!backed) {
      removed.push({ kind: "number", said: `${a} ${out.quantity.unit}` });
      out.quantity = null;
    }
  }
  // The day must be one the buyer's own words name ("huomiseksi", "den 19:e", "ensi maanantaiksi"); never one copied
  // from an earlier request or the kitchen's memory.
  if (out.deliverBy && !dayStated(words, out.deliverBy, ev.today)) {
    removed.push({ kind: "date", said: out.deliverBy });
    out.deliverBy = null;
  }
  recordGrounding("interpret", removed, ev.text.slice(0, 80));
  return { raw: out, removed };
}
