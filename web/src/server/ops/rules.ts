import { RULES } from "@/core/policy";
import { RULE_TITLE } from "@/app/_ui/plain";

/**
 * The rule book as staff read it: every named check the gate and the door run, in plain words, grouped by what it
 * protects. The rule ids come from the code that enforces them (core/policy.ts RULES, and the refusal rules of
 * orders.ts, the MCP guard and the operations layer), so a rule added in code shows up here on its own, under
 * "Other" until someone writes its plain words below.
 */
export type RuleGroup = "money" | "food" | "authority" | "systems" | "other";

export const GROUPS: { id: RuleGroup; title: string; blurb: string }[] = [
  { id: "money", title: "Money", blurb: "What an agent may spend alone, and what no sign-off can lift." },
  { id: "food", title: "Food safety and the kitchen's requirements", blurb: "What may be bought for this kitchen, by when, and what may replace it." },
  { id: "authority", title: "Authority", blurb: "Who is asking, under whose signed mandate, and who may sign off." },
  { id: "systems", title: "The wholesaler's own systems", blurb: "The live price service, signed prices and the order record." },
  { id: "other", title: "Other", blurb: "Checks added in code that have no plain description here yet." },
];

type RuleInfo = { group: RuleGroup; does: string; where: "gate" | "door" | "quote" | "intake" | "operations" };

/** What each rule does, in one sentence. `where`: the gate (policy), the door (before the core), the quote, the intake. */
export const RULE_INFO: Record<string, RuleInfo> = {
  per_order_limit: { group: "money", where: "gate", does: "Above the per-order limit in the kitchen's mandate, the agent cannot buy alone: a named person must sign off." },
  weekly_budget: { group: "money", where: "gate", does: "Committed and waiting orders over seven days may not pass the weekly budget. A hard limit: no sign-off lifts it." },
  approver_authority: { group: "money", where: "gate", does: "When a sign-off is needed, someone named in the mandate must be allowed to sign that amount, or the order is refused." },
  substitute_price: { group: "money", where: "gate", does: "A substitute may cost only the tolerated percentage more per litre or kilo than the product it replaces." },
  order_splitting: { group: "money", where: "gate", does: "Several orders the agent placed alone for one need may not add up to more than it may spend alone." },
  required_attributes: { group: "food", where: "gate", does: "Every product must carry what the mandate requires, for example lactose-free." },
  forbidden_allergens: { group: "food", where: "gate", does: "No product may contain an allergen the mandate forbids. A product with no allergen data counts as unsafe." },
  required_certificates: { group: "food", where: "gate", does: "Every product must carry the certificates the mandate requires." },
  category_allowed: { group: "food", where: "gate", does: "Only product groups the kitchen allows, for example milk and plant drinks." },
  substitution_rule: { group: "food", where: "gate", does: "Swaps follow the kitchen's rule: none, like for like only, or with a person's sign-off." },
  delivery_deadline: { group: "food", where: "gate", does: "Every line must arrive by the date asked for and within the mandate's longest lead time." },
  mandate_signature: { group: "authority", where: "door", does: "The agent must present a mandate signed with a key of a kitchen Dock trusts." },
  mandate_window: { group: "authority", where: "door", does: "The mandate must be in force: not before it starts, not after it ends." },
  mandate_agent: { group: "authority", where: "door", does: "The agent presenting the mandate must be the one it names." },
  quote_binding: { group: "authority", where: "gate", does: "A price quoted to one kitchen and agent cannot be used by another." },
  approver_identity: { group: "authority", where: "gate", does: "Only the named person can sign off, and their proof must cover exactly this order." },
  human_input: { group: "authority", where: "intake", does: "Answers to Dock's questions and to likely mistakes must come from the buyer, not from the agent." },
  intake_sequence: { group: "authority", where: "intake", does: "A request follows its steps: no quote while a likely mistake waits for the buyer, nothing after they cancel." },
  operator_suspension: { group: "authority", where: "operations", does: "Operations staff can stop an agent or a whole organisation; its next call is refused until they resume it." },
  recall_hold: { group: "food", where: "operations", does: "A product an authority's recall notice names (matched on its EAN, or on producer, exact name and pack) is held: no quote or order for it, and a waiting order with it cannot be approved. The notice is the stated reason." },
  live_lookup_limit: { group: "systems", where: "door", does: "The partner's live price service sees short lists only: at most ten products per call, and a cap per agent per hour." },
  quote_availability: { group: "systems", where: "quote", does: "A quote covers only what is in stock and can be delivered." },
  quote_signature: { group: "systems", where: "gate", does: "The order must carry the quote exactly as the wholesaler signed it." },
  quote_expiry: { group: "systems", where: "gate", does: "A fixed price holds for a limited time; after that the agent asks again." },
  quote_replay: { group: "systems", where: "gate", does: "A quote buys once." },
  order_matches_quote: { group: "systems", where: "gate", does: "The order buys exactly what was quoted, at the quoted quantities and prices." },
};

const EXTRA_TITLE: Record<string, string> = {
  order_splitting: "No splitting one need into small orders",
  human_input: "Answers come from the buyer",
  intake_sequence: "Steps in order",
  recall_hold: "Recall hold",
};

export function ruleTitleOf(rule: string): string {
  return RULE_TITLE[rule] ?? EXTRA_TITLE[rule] ?? rule.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

/** Every rule known to the running code: the gate's list first, then the door's and the rest. */
export function allRules(seen: Iterable<string> = []): string[] {
  const out = new Set<string>([...RULES, ...Object.keys(RULE_INFO), ...seen]);
  return [...out];
}

export function ruleInfo(rule: string): RuleInfo {
  return RULE_INFO[rule] ?? { group: "other", where: "gate", does: "A named check in the code." };
}
