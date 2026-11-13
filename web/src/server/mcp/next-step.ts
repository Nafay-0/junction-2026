import type { DockError } from "@/core/orders";

/**
 * One sentence per refusal telling an agent what to do next, keyed by the rule (or code) that refused.
 * Written for a model reading a tool result: what happened is in `error.message`, this says what to do.
 */
const DO_NOT_RETRY = "Do not retry with the same credentials.";

const BY_CODE: Record<string, string> = {
  request_not_found: "Call open_request first and pass the requestId it returns.",
  invalid_request: "Fix the arguments as error.message describes and call again.",
  quote_insufficient_stock:
    "Lower the quantity to error.details.available packs, and if the buyer needs more, add a second line for a substitute product with substituteFor set to this productId.",
  quote_no_offer: "This product cannot be bought right now. Pick another product from search_products.",
  quote_unknown_product: "Use a productId exactly as search_products returned it.",
  quote_invalid_line: "Each line needs a distinct productId and a whole number of packs above zero; a product cannot substitute for itself.",
  live_lookup_budget_exceeded:
    "This agent has used its live price/availability allowance for now. Work with the offers and quotes you already have, or wait for the window to pass.",
  order_not_found: "Use an orderId returned by place_order for this organisation.",
  intake_not_found: "Use the requestId submit_need returned to this agent, or start with submit_need.",
  intake_needs_confirmation:
    "The buyer has not yet confirmed a likely mistake on this request. Call get_intake_step, relay the concern to the buyer, and call respond_to_concerns with their answer. Do not go around it.",
  intake_cancelled: "The buyer cancelled this request. Do not quote or order it; start a new one with submit_need if the buyer asks.",
  concern_not_open: "Answer only the concerns listed in step.concerns (error.details.open has their keys); call get_intake_step to see them.",
  concern_not_confirmable: "This concern cannot be confirmed as is. Ask the buyer to pick one of its corrections and send that correction id as choice.",
  correction_unknown: "Send \"confirm\" (if the concern is confirmable) or a correction id exactly as listed in the concern's corrections.",
  question_not_open: "Answer only the questions in step.questions (error.details.open has their ids); call get_intake_step to see them.",
  option_unknown: "Send an optionId exactly as listed in the question's options.",
  option_not_found: "Choose an optionId from step.options; call get_intake_step to see them.",
  family_unknown: "Say what kind of product it is: send need.item.category, e.g. \"milk\" (search_products shows the categories).",
  amount_unknown: "Send need.quantity with an amount and a unit (L, kg, pcs or pack).",
  nothing_to_repeat: "There is no earlier order to repeat. Ask the buyer how much they need and send need.quantity.",
  human_answer_required:
    "Ask the human buyer the question in step.concerns or step.questions, in plain words, wait for their answer, and call again with it and their name as by. Never answer for them.",
  connector_rate_limited:
    "This connector address has reached its limit for now (error.details.retryAfterSeconds says when it frees up). Tell the buyer plainly and stop; do not loop or retry before then.",
  form_not_answered:
    "Dock's form was closed without an answer (your client may not be able to show it). Ask the buyer Dock's question in the chat in plain words, wait for their reply, and call the same tool again with their answer and relay: true. Never answer for them.",
  buyer_declined: "The buyer did not answer. Do not answer for them and do not go around the question; tell them the order waits for their answer, and call get_intake_step when they are ready.",
};

const BY_RULE: Record<string, string> = {
  mandate_signature: `Your mandate was not accepted. ${DO_NOT_RETRY} A person at your organisation must issue a valid signed mandate for this agent.`,
  mandate_window: `Your mandate is not in force right now. ${DO_NOT_RETRY} Ask your organisation for a current mandate.`,
  mandate_agent: `The agent id you presented does not match the mandate. ${DO_NOT_RETRY} Send the agent id the mandate names (read_mandate shows it once you connect correctly).`,
  live_lookup_limit:
    "Live price and availability is for a short list only. Narrow the candidates with search_products (master data, no live call) and check at most 10 products per call.",
  quote_availability: "Adjust the quote lines to what is in stock and try request_quote again.",
  quote_signature: "Pass quoteToken exactly as request_quote returned it; it cannot be edited. Ask for a new quote if you need different lines.",
  quote_expiry: "The quote's fixed price has expired. Call request_quote again and order against the new quoteToken.",
  quote_replay: "This quote has already bought an order; a quote buys once. Ask for a new quote only if the buyer needs more.",
  quote_binding: "Order only with quotes issued to you under the mandate you are presenting.",
  order_matches_quote: "Order exactly the quote's lines: the same productIds, quantities and unitPriceCents as quote.lines.",
  category_allowed: "This product is outside the mandate. Call read_mandate and pick products that satisfy it.",
  required_attributes: "This product is outside the mandate. Call read_mandate and pick products that carry every required attribute.",
  forbidden_allergens: "This product contains an allergen the mandate forbids. Pick another product; read_mandate lists the forbidden allergens.",
  required_certificates: "This product lacks a certificate the mandate requires. Pick another product; read_mandate lists the certificates.",
  delivery_deadline: "Pick a product whose deliveryDate meets the need-by date, or tell the buyer the date cannot be met.",
  substitution_rule: "The mandate does not allow this substitute. Order only the original product, or pick a substitute with the same attributes.",
  substitute_price: "The substitute costs too much more per unit than the original. Pick a cheaper substitute or order only what the original covers.",
  weekly_budget: "The weekly budget is a hard limit that no sign-off can lift. Do not retry or split the order; tell the buyer.",
  approver_authority: "No approver named in the mandate may sign off this amount. Reduce the order; do not retry it unchanged.",
  approver_identity: "Only the human approver can decide on an approval. Agents cannot approve orders.",
  intake_sequence: "That step is not open now. Call get_intake_step and make the call its nextStep names.",
  human_input: "This needs the human buyer's own answer. Relay the question to them and pass on exactly what they say; never answer for them.",
};

export function nextStepFor(err: Pick<DockError, "code" | "rule">): string {
  return BY_CODE[err.code] ?? (err.rule && BY_RULE[err.rule]) ?? "The call was refused; read error.message, fix the cause and only then call again.";
}

type OrderLike = { status: string; orderId: string; approval?: { approver: { name: string; role: string } } };

export function nextStepForOrder(order: OrderLike): string {
  switch (order.status) {
    case "committed":
      return "Done: the order is committed at the quoted price. `confirmation` is the wholesaler-signed receipt; anyone can verify it with the keys at /.well-known/jwks.json.";
    case "pending_approval": {
      const who = order.approval ? `${order.approval.approver.name} (${order.approval.approver.role})` : "a person named in the mandate";
      return `This order now waits for a human sign-off by ${who}, who has been asked on their own phone. Tell the buyer exactly that in one plain sentence and stop. Do not retry, place it again, split it or look for another way round. Only if the buyer asks later, call get_order with orderId ${order.orderId} to see whether it was committed or declined.`;
    }
    case "declined":
      return "A person declined this order. Do not retry it; tell the buyer.";
    default:
      return "The gate refused this order. error.rule names the rule; decision.rules has every rule's result.";
  }
}

type StepLike = {
  requestId: string;
  state: string;
  concerns: { key: string; message: string; confirmable: boolean; corrections: { id: string; label: string }[] }[];
  questions: { id: string; text: string; options: { id: string; label: string }[] }[];
  options: { optionId: string; title: string; totalCents: number; signOff: string[] }[];
  preselected?: { optionId: string; reason: string };
  notes: string[];
  quote?: { policyPreview: { outcome: string; approver?: { name: string; role: string }; rules: { rule: string; outcome: string }[] } };
};

/** Who the intake waits for in each state. */
export function waitingFor(state: string): "buyer" | "agent" | "nobody" {
  return state === "needs_confirmation" || state === "needs_input" || state === "options_ready" ? "buyer" : state === "quoted" ? "agent" : "nobody";
}

const RELAY = "This answer must come from the human buyer: relay the question in their words and wait. Do not answer for them, even if you think you know.";

/** Exactly which call comes next for an intake step, written for the agent. */
export function nextStepForIntake(step: StepLike): string {
  const id = `requestId ${step.requestId}`;
  switch (step.state) {
    case "needs_confirmation": {
      const asks = step.concerns.map((c) => `"${c.message}" (choices: ${[...(c.confirmable ? ["confirm"] : []), ...c.corrections.map((x) => `${x.id} = ${x.label}`)].join("; ")})`).join(" and ");
      return `Dock found a likely mistake. Ask the buyer: ${asks}. Then call respond_to_concerns with ${id}, by (the buyer's name) and one response per concern key. ${RELAY} Until the buyer answers, quotes and orders for this request are refused.`;
    }
    case "needs_input": {
      const asks = step.questions.map((q) => `"${q.text}" (options: ${q.options.map((o) => `${o.id} = ${o.label}`).join("; ")})`).join(" and ");
      return `Ask the buyer: ${asks}. Then call answer_questions with ${id}, by (the buyer's name) and one answer per questionId. ${RELAY}`;
    }
    case "options_ready": {
      const pre = step.preselected ? ` Dock pre-selected ${step.preselected.optionId} (${step.preselected.reason}).` : "";
      return `Show the buyer the ${step.options.length} options (step.options: title, total, delivery, pros and cons, and signOff for any that need a person's sign-off).${pre} Call choose_option with ${id} and the optionId the buyer picks; it returns a signed fixed-price quote.`;
    }
    case "quoted": {
      const p = step.quote?.policyPreview;
      const gate =
        p?.outcome === "reject"
          ? ` The gate would refuse it (rule ${p.rules.find((r) => r.outcome === "fail")?.rule}): tell the buyer and do not place it.`
          : p?.outcome === "needs_human_approval"
            ? ` Placing it will ask ${p.approver ? `${p.approver.name} (${p.approver.role})` : "a person named in the mandate"} to sign off on their own device.`
            : " It is within the mandate and commits at once.";
      return `Call place_order with just { "requestId": "${step.requestId}" }: Dock places the quote it signed for this request.${gate}`;
    }
    case "no_options":
      return `Nothing meets the constraints: ${step.notes[0] ?? "see step.notes and step.excluded"}. Tell the buyer why; if they change the need, call submit_need again.`;
    case "cancelled":
      return "The buyer cancelled this request. Do not place an order. Call submit_need only if the buyer asks for something new.";
    default:
      return "Call get_intake_step to see where this request stands.";
  }
}
