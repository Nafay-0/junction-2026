import { attr, clock, day, eurShort, helsinkiToday, roleLabel, ruleTitle } from "@/app/_ui/plain";
import { DOOR_TEXT, type Door } from "@/core/orders";
import type { Change, RuleRow } from "./history";
import type { Difference, Verdict } from "./replay";

/**
 * The time machine's answers in plain words, for the wholesaler's staff and for the kitchen alike. Money as the API
 * writes it (€1,000), Helsinki time (Mon 9.11. 08.00), no rule ids on the surface.
 */

export const when = (iso: string) => `${day(helsinkiToday(new Date(iso)))} ${clock(iso)}`;

const list = (xs: unknown) => ((xs as string[] | undefined) ?? []).map(attr).join(", ");

export const FIELD_LABEL: Record<string, string> = {
  perOrderLimitCents: "Limit per order the agent may spend alone",
  weeklyBudgetCents: "Weekly budget",
  allowedCategories: "Product groups allowed",
  requiredAttributes: "Every product must be",
  forbiddenAllergens: "Never these allergens",
  requiredCertificates: "Certificates required",
  maxLeadDays: "Latest delivery, days after ordering",
  substitutionRule: "Swaps",
  maxPriceIncreasePct: "A swap may cost at most",
  approvers: "Who signs off",
  orgName: "Kitchen",
  text: "Rule",
  strength: "Kind",
  committedCents: "Committed this week",
  heldCents: "Waiting for sign-off",
  weekOrders: "Orders in the week",
  ordersInWeek: "Orders in the week",
};

const SUBSTITUTION: Record<string, string> = {
  none: "no swaps at all",
  same_attributes: "like for like only",
  within_preferences: "like for like alone, anything else to a person",
  needs_approval: "every swap to a person",
};

export function fieldValue(field: string, v: unknown): string {
  if (v === null || v === undefined) return "none";
  if (field.endsWith("Cents")) return eurShort(Number(v));
  if (field === "maxPriceIncreasePct") return `+${v} % per unit`;
  if (field === "substitutionRule") return SUBSTITUTION[String(v)] ?? String(v);
  if (field === "approvers") return (v as { name: string; role: string; maxApprovalCents: number }[]).map((a) => `${a.name} (${roleLabel(a.role)}) up to ${eurShort(a.maxApprovalCents)}`).join("; ") || "nobody";
  if (field === "weekOrders") return `${(v as unknown[]).length}`;
  if (Array.isArray(v)) return v.length ? list(v) : "none";
  if (field === "strength") return v === "rule" ? "a rule a person stated" : "a habit (pre-selects only)";
  return String(v);
}

/** One rule in force, as one line a person reads. */
export function describeRule(r: RuleRow): { title: string; lines: string[]; by: string; since: string } {
  const v = r.value;
  const since = r.since;
  switch (r.area) {
    case "mandate":
      return {
        title: `Mandate of ${String(v.orgName)}`,
        lines: [
          `Spends up to ${eurShort(Number(v.perOrderLimitCents))} per order alone; above that a person signs.`,
          `Weekly budget ${eurShort(Number(v.weeklyBudgetCents))}, a hard limit.`,
          `Product groups: ${list(v.allowedCategories) || "none"}.`,
          ...((v.requiredAttributes as string[]).length ? [`Every product ${list(v.requiredAttributes)}.`] : []),
          (v.forbiddenAllergens as string[]).length ? `Never: ${list(v.forbiddenAllergens)}.` : "No allergen forbidden.",
          ...((v.requiredCertificates as string[]).length ? [`Certificates: ${list(v.requiredCertificates)}.`] : []),
          `Delivery within ${String(v.maxLeadDays)} days. Swaps: ${fieldValue("substitutionRule", v.substitutionRule)}, at most +${String(v.maxPriceIncreasePct)} % per unit.`,
          `Sign-off: ${fieldValue("approvers", v.approvers)}.`,
        ],
        by: r.changedBy,
        since,
      };
    case "kitchen_rule":
      return { title: v.strength === "rule" ? "Kitchen rule" : "Kitchen habit", lines: [`${String(v.text)}${v.strength === "rule" ? "" : " (pre-selects only; the buyer can change it)"}`], by: r.changedBy, since };
    case "hold":
      return { title: `${v.drill ? "Recall drill" : "Recall hold"}: ${String(v.productName)}`, lines: [String(v.reason)], by: r.changedBy, since };
    case "suspension":
      return { title: `Suspended: ${String(v.label)}`, lines: [`“${String(v.reason)}”`], by: r.changedBy, since };
    case "budget":
      return {
        title: "Spend this week",
        lines: [`${eurShort(Number(v.committedCents))} committed${Number(v.heldCents) ? `, ${eurShort(Number(v.heldCents))} waiting for sign-off` : ""}, over ${String(v.ordersInWeek)} order${Number(v.ordersInWeek) === 1 ? "" : "s"} in the last 7 days.`],
        by: r.changedBy,
        since,
      };
  }
}

const AREA_WORD: Record<string, string> = { mandate: "Mandate", kitchen_rule: "Kitchen rule", hold: "Recall hold", suspension: "Suspension", budget: "Weekly spend" };

/** One change, as one line: what, from what to what, who, when. */
export function describeChange(c: Change): { at: string; when: string; what: string; by: string; area: string } {
  const v = (c.after ?? c.before)!.value;
  let what: string;
  if (c.area === "hold") what = c.kind === "added" ? `${String(v.productName)} put on ${v.drill ? "a recall drill" : "recall hold"}: ${String(v.reason)}` : `Hold on ${String(v.productName)} lifted${c.after?.value.note ? `: ${String(c.after.value.note)}` : ""}`;
  else if (c.area === "suspension") what = c.kind === "added" ? `${String(v.label)} suspended: “${String(v.reason)}”` : `${String(v.label)} resumed${c.after?.value.note ? `: “${String(c.after.value.note)}”` : ""}`;
  else if (c.area === "kitchen_rule") what = c.kind === "added" ? `Rule added: “${String(v.text)}”` : c.kind === "ended" ? `Rule removed: “${String(v.text)}”` : `Rule changed: “${String(c.before?.value.text)}” to “${String(v.text)}”`;
  else if (c.area === "budget" && c.kind === "added") what = `Weekly spend: ${eurShort(Number(v.committedCents))} committed${Number(v.heldCents) ? `, ${eurShort(Number(v.heldCents))} waiting for sign-off` : ""}`;
  else if (c.area === "budget") what = `Weekly spend ${c.fields.filter((f) => f.field.endsWith("Cents")).map((f) => `${FIELD_LABEL[f.field].toLowerCase()} ${fieldValue(f.field, f.before)} to ${fieldValue(f.field, f.after)}`).join(", ") || "changed"}`;
  else if (c.kind === "added") what = `Mandate in force for ${String(v.orgName)}: up to ${eurShort(Number(v.perOrderLimitCents))} per order alone, ${eurShort(Number(v.weeklyBudgetCents))} a week`;
  else if (c.kind === "ended") what = `Mandate of ${String(v.orgName)} no longer in force`;
  else what = `Mandate reissued: ${c.fields.map((f) => `${FIELD_LABEL[f.field] ?? f.field} ${fieldValue(f.field, f.before)} to ${fieldValue(f.field, f.after)}`).join("; ")}`;
  return { at: c.at, when: when(c.at), what, by: c.by, area: AREA_WORD[c.area] ?? c.area };
}

const RULE_EXTRA: Record<string, string> = { recall_hold: "No product on a recall hold", operator_suspension: "Not suspended by the wholesaler's staff" };
export const title = (rule: string) => RULE_EXTRA[rule] ?? ruleTitle(rule);

const OUTCOME_WORD: Record<Verdict["outcome"], string> = {
  auto_approve: "Placed by the agent alone",
  needs_human_approval: "Needs a person's sign-off",
  reject: "Refused",
  refused_at_door: "Refused at the door",
  no_mandate: "No mandate in force",
};
export const outcomeWord = (o: Verdict["outcome"]) => OUTCOME_WORD[o];

/** "Would it pass today?" in one sentence a kitchen can read. */
export function kitchenSentence(then: Verdict, now: Verdict, diffs: Difference[]): string {
  const a = OUTCOME_WORD[then.outcome].toLowerCase();
  const b = OUTCOME_WORD[now.outcome].toLowerCase();
  if (!diffs.length) return `Under today's rules this order would get the same answer as when it was placed: ${b}.`;
  const why = diffs
    .map((d) => {
      const t = title(d.rule);
      if (d.rule === "per_order_limit") return `the agent's own limit is ${eurShort(now.read.perOrderLimitCents ?? 0)} now (it was ${eurShort(then.read.perOrderLimitCents ?? 0)})`;
      if (d.rule === "weekly_budget") return `this week's spend is ${eurShort(now.read.spentCents)} of ${eurShort(now.read.weeklyBudgetCents ?? 0)}`;
      if (d.rule === "forbidden_allergens") return `your mandate now forbids ${(now.read.forbiddenAllergens ?? []).map(attr).join(", ") || "no allergen"}`;
      if (d.rule === "recall_hold") return now.read.holds.length ? `${now.read.holds.join(", ")} is on a recall hold now` : `the recall hold that stopped it then has been lifted`;
      if (d.rule === "operator_suspension") return now.door.open ? "your agent is no longer suspended" : "your agent is suspended now";
      return `${t.toLowerCase()}: ${(d.at?.outcome ?? "not checked").replace("escalate", "a person signs").replace("fail", "refused").replace("pass", "passes")}`;
    })
    .join("; ");
  return `When it was placed: ${a}. Today: ${b}, because ${why}.`;
}

/** "an outside agent over MCP": which door a request came through, in words. Undefined when it was not recorded. */
export function doorText(door: string | undefined): string | undefined {
  return door && door in DOOR_TEXT ? DOOR_TEXT[door as Door] : undefined;
}
