import type { Product, ProductQuery } from "./catalog";
import { checkNeed, type Concern, type PendingOrderSummary } from "./concerns";
import { CONFIRMATION_MATTERS } from "./intake";
import { emptyProfile, type KitchenRepository } from "./kitchen";
import { NeedSchema } from "./need";
import type { QuoteLine } from "./quote";

/**
 * The mistake check as the gate runs it, for an order nobody was asked about.
 *
 * A request that comes through the intake is checked there: the buyer sees each likely mistake and confirms or
 * corrects it, and the gate then reads what was confirmed and how (intake.ts, `unverified`). An agent can also
 * open a request, ask for a quote and place the order without the intake, and then nobody was asked anything.
 * So the gate runs the same check itself (the same pure functions on the kitchen's own history and stated
 * rules, core/concerns.ts) on what is actually being ordered: each family of the order as a need that names its
 * main product and its amount. Anything the check finds that matters (the list an unverified confirmation is
 * held to, CONFIRMATION_MATTERS) goes to the policy as an unconfirmed concern, and the rule human_confirmation
 * sends the order to a named person with the check shown. No model, no live call.
 */
export type OrderCheckDeps = { catalog: { searchProducts(query: ProductQuery): Promise<Product[]> }; kitchens: KitchenRepository };

export type OrderConcern = Pick<Concern, "key" | "code" | "message">;

export async function concernsOfOrder(
  deps: OrderCheckDeps,
  input: { orgId: string; orgName: string; lines: QuoteLine[]; neededBy?: string; now: Date; pending?: PendingOrderSummary[] },
): Promise<OrderConcern[]> {
  const profile = (await deps.kitchens.getProfile(input.orgId)) ?? emptyProfile(input.orgId, input.orgName);
  const families = new Map<string, QuoteLine[]>();
  for (const l of input.lines) families.set(l.category, [...(families.get(l.category) ?? []), l]);
  const out: OrderConcern[] = [];
  for (const [family, lines] of families) {
    // The family's main line names the product; the amount is everything of the family sold in that line's unit.
    const main = [...lines].sort((a, b) => b.quantity * b.packSize - a.quantity * a.packSize)[0];
    const amount = Math.round(lines.filter((l) => l.unit === main.unit).reduce((s, l) => s + l.quantity * l.packSize, 0) * 100) / 100;
    const need = NeedSchema.safeParse({
      item: { text: main.name.slice(0, 200) || main.productId, category: family, productId: main.productId },
      quantity: { amount, unit: main.unit },
      ...(input.neededBy ? { deliverBy: input.neededBy } : {}),
    });
    if (!need.success) continue; // an amount the need cannot hold (the quote's own limits refuse it) or an id outside the vocabulary
    const ids = [...new Set(lines.map((l) => l.productId))];
    const known = await deps.catalog.searchProducts({ category: family, limit: 100 });
    const named = ids.some((id) => !known.some((p) => p.id === id)) ? await deps.catalog.searchProducts({ ids, limit: 100 }) : [];
    const candidates = [...known, ...named.filter((p) => !known.some((k) => k.id === p.id))];
    for (const c of checkNeed(need.data, { now: input.now, profile, family, candidates, ...(input.pending ? { pending: input.pending } : {}) })) {
      if (CONFIRMATION_MATTERS.includes(c.code) && !out.some((x) => x.key === c.key)) out.push({ key: c.key, code: c.code, message: c.message });
    }
  }
  return out;
}

/** The line the person signing off reads for a concern nobody was asked about. */
export function unaskedNote(c: OrderConcern): string {
  return `Nobody was asked: this order did not come through the mistake check's questions. Check it before signing: ${c.message}`;
}
