import { attr, eurShort, roleLabel } from "../../_ui/plain";
import type { KitchenInfo } from "./types";

/**
 * The kitchen's signed mandate in plain words: what the agent may do alone, what needs a person, and what is
 * refused whoever asks. Generated from the mandate itself, so the page cannot drift from what the gate checks.
 */
export function mandateWords(m: KitchenInfo["mandate"]): { alone: string[]; person: string[]; never: string[] } {
  const alone: string[] = [
    `Order up to ${eurShort(m.perOrderLimitCents)} per order without asking anyone.`,
    `Buy only ${m.allowedCategories.map(attr).join(", ")}.`,
    `Ask for delivery at most ${m.maxLeadDays} days ahead.`,
  ];
  const person: string[] = [`Any order above ${eurShort(m.perOrderLimitCents)}: the approver named below, up to their own limit.`];
  const never: string[] = [
    `Spend more than ${eurShort(m.weeklyBudgetCents)} in seven days, even with a sign-off.`,
    `Split one need into several small orders to stay under ${eurShort(m.perOrderLimitCents)}: orders for the same need count together.`,
    "Order at a price that was not fixed and signed by the wholesaler, or after that price expired.",
    "Approve its own order. Only the named person can, on their own phone.",
  ];
  if (m.requiredAttributes.length) alone.push(`Every product must be ${m.requiredAttributes.map(attr).join(", ")}.`);
  if (m.forbiddenAllergens.length) never.push(`Buy anything containing ${m.forbiddenAllergens.map(attr).join(" or ")}, or anything without allergen data to prove it.`);
  const s = m.substitution;
  const dearer = s.maxPriceIncreasePct !== undefined ? `, at most ${s.maxPriceIncreasePct} % dearer` : "";
  if (s.rule === "none") never.push("Substitute a product for another.");
  else if (s.rule === "same_attributes") {
    alone.push(`Substitute a like-for-like product (same kind, same properties)${dearer}.`);
    never.push("Substitute anything that is not like for like.");
  } else if (s.rule === "within_preferences") {
    alone.push(`Substitute a like-for-like product within the kitchen's stated preferences${dearer}.`);
    person.push("Any other substitute.");
  } else person.push(`Any substitute, whatever it is${dearer}.`);
  return { alone, person, never };
}

export function approverLine(a: KitchenInfo["mandate"]["approvers"][number]): string {
  return `${a.name}, ${roleLabel(a.role)}: signs orders up to ${eurShort(a.maxApprovalCents)}`;
}
