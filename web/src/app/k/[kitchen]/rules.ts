import { attrL, roleLabelL } from "../../_i18n/format";
import type { Lang } from "../../_i18n/lang";
import { moneyShort } from "../../_ui/plain";
import { familyL } from "./family.text";
import { RULES_TEXT } from "./rules.text";
import type { KitchenInfo } from "./types";

/**
 * The kitchen's signed mandate in plain words: what the agent may do alone, what needs a person, and what is
 * refused whoever asks. Generated from the mandate itself, so the page cannot drift from what the gate checks.
 */
export function mandateWords(m: KitchenInfo["mandate"], lang: Lang = "en"): { alone: string[]; person: string[]; never: string[] } {
  const tx = RULES_TEXT[lang];
  const attr = (a: string) => attrL(a, lang);
  const limit = moneyShort(m.perOrderLimitCents);
  const alone: string[] = [tx.upTo(limit), tx.buyOnly(m.allowedCategories.map((c) => familyL(c, lang)).join(", ")), tx.lead(m.maxLeadDays)];
  const person: string[] = [tx.above(limit)];
  const never: string[] = [tx.budget(moneyShort(m.weeklyBudgetCents)), tx.split(limit), tx.unsigned, tx.own];
  if (m.requiredAttributes.length) alone.push(tx.every(m.requiredAttributes.map(attr).join(", ")));
  if (m.forbiddenAllergens.length) never.push(tx.allergens(m.forbiddenAllergens.map(attr).join(tx.or)));
  const s = m.substitution;
  const dearer = s.maxPriceIncreasePct !== undefined ? tx.dearer(s.maxPriceIncreasePct) : "";
  if (s.rule === "none") never.push(tx.noSubs);
  else if (s.rule === "same_attributes") {
    alone.push(tx.like(dearer));
    never.push(tx.notLike);
  } else if (s.rule === "within_preferences") {
    alone.push(tx.prefs(dearer));
    person.push(tx.other);
  } else person.push(tx.any(dearer));
  return { alone, person, never };
}

export function approverLine(a: KitchenInfo["mandate"]["approvers"][number], lang: Lang = "en"): string {
  return RULES_TEXT[lang].approver(a.name, roleLabelL(a.role, lang), moneyShort(a.maxApprovalCents));
}
