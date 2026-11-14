import { memoryItemIdOf, type KitchenProfile } from "@/core/kitchen";
import type { InteractionEvent, Segment } from "./model";

/**
 * What one intake taught, as writer input: the buyer's words, the option chosen, and each answered mistake check
 * with the remembered items it cited (found again from the check's key, since the intake keeps only the key).
 */
type IntakeRecord = {
  family: string;
  need: { text?: string; requiredClaims?: string[]; item?: { attributes?: string[] } };
  options: { optionId: string; labels: string[]; lines: { productId: string; name: string; packSize: number; unit: "L" | "kg" | "pcs" }[] }[];
  chosen?: { optionId: string; labels: string[] };
  acknowledgements: { key: string; code: string; action: "confirmed" | "corrected" | "cancelled" }[];
  answers?: { questionId: string; optionId: string; remember?: boolean }[];
  quote?: { quote: { lines: { productId: string; name: string; packSize: number; unit: "L" | "kg" | "pcs" }[] } };
};

const ASKED_DIMENSIONS: Record<string, string[]> = { lactose: ["lactose_free"], fat: ["fat_free", "fat_1_5", "fat_3_5"], organic: ["organic"] };

export function interactionFromIntake(profile: KitchenProfile, i: IntakeRecord): { segments: Segment[]; events: InteractionEvent[] } {
  const segments: Segment[] = i.need.text ? [{ id: "s1", source: "buyer", text: i.need.text }] : [];
  const events: InteractionEvent[] = [];
  const line = i.quote?.quote.lines[0] ?? i.options.find((o) => o.optionId === i.chosen?.optionId)?.lines[0];
  if (i.chosen && line) events.push({ type: "option_chosen", family: i.family, productId: line.productId, name: line.name, packSize: line.packSize, unit: line.unit, labels: i.chosen.labels });
  for (const a of i.answers ?? []) events.push({ type: "answer", family: i.family, questionId: a.questionId, optionId: a.optionId, remember: a.remember });
  // What the buyer ASKED for and ordered ("lactose-free milk"): one data point for that kind of product, as if the
  // question had been answered, so asking for it again and again is learned, and put to the person as a rule
  // (memory/decide.ts proposeRule). Only when an option was chosen, and never twice for one answer already given.
  if (i.chosen) {
    const asked = new Set([...(i.need.requiredClaims ?? []), ...(i.need.item?.attributes ?? [])]);
    for (const [dim, values] of Object.entries(ASKED_DIMENSIONS)) {
      const v = values.find((x) => asked.has(x));
      if (v && !(i.answers ?? []).some((a) => a.questionId === `dim:${dim}`)) events.push({ type: "answer", family: i.family, questionId: `dim:${dim}`, optionId: v });
    }
  }
  const items = profile.memory?.items ?? [];
  for (const a of i.acknowledgements) {
    const [, rest] = [a.key.slice(0, a.key.indexOf(":")), a.key.slice(a.key.indexOf(":") + 1)];
    let ids: string[] = [];
    if (a.code === "contradicts_preference") ids = [memoryItemIdOf(rest)].filter((x): x is string => !!x);
    else if (a.code === "declined_before" || a.code === "breaks_remembered_rule") ids = items.filter((m) => "productId" in m.fact && m.fact.productId === rest).map((m) => m.id);
    else if (a.code === "standing_order_range") ids = items.filter((m) => m.fact.kind === "standing_order" && m.family === i.family && m.status === "active").map((m) => m.id);
    else if (a.code === "delivery_unusual_day" || a.code === "delivery_not_delivery_day") ids = items.filter((m) => m.fact.kind === "delivery_days" && m.origin !== "learned" && m.status === "active").map((m) => m.id);
    if (ids.length) events.push({ type: "concern_response", code: a.code, memoryItemIds: ids, action: a.action });
  }
  return { segments, events };
}
