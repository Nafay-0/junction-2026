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
      return `This order now waits for a human sign-off by ${who}, who has been notified on their own channel. Do not retry and do not place it again. Tell the buyer it awaits sign-off, and call get_order with orderId ${order.orderId} later to see whether it was committed or declined.`;
    }
    case "declined":
      return "A person declined this order. Do not retry it; tell the buyer.";
    default:
      return "The gate refused this order. error.rule names the rule; decision.rules has every rule's result.";
  }
}
