import type { Dock } from "@/core/orders";
import { timeMachineOf } from "./attach";
import { timeMachineView } from "./service";
import { outcomeWord, title } from "./words";

/**
 * The buyer's side of the time machine, in words a kitchen reads: what its order was judged by, what changed since,
 * who changed it, and whether it would pass today. Only the kitchen's own rules and the holds on this order's
 * products; never another kitchen's, never the wholesaler's internal notes.
 */
export type KitchenRulesThen =
  | { attached: false; sentence: string }
  | { attached: true; mirrored: false; sentence: string }
  | {
      attached: true;
      mirrored: true;
      placedAt: string;
      then: { outcome: string; headline: string };
      now: { outcome: string; headline: string };
      sentence: string;
      differences: { rule: string; title: string; then: string; now: string; reason: string }[];
      changes: { when: string; what: string; by: string }[];
      reproduces: boolean;
    };

const RULE_OUTCOME: Record<string, string> = { pass: "passes", escalate: "a person signs", fail: "refused" };

export async function kitchenRulesThen(dock: Dock, orgId: string, orderId: string): Promise<KitchenRulesThen> {
  const h = timeMachineOf(dock);
  if (!h) return { attached: false, sentence: `This deployment keeps no history of the rules yet (it starts with the server), so it cannot show the rules as they stood. The order's own record and the ledger above are complete.` };
  let v;
  try {
    const owner = await h.store.orderOwner(orderId);
    if ((owner ?? "") !== orgId) return { attached: true, mirrored: false, sentence: "This order is not in the history yet: it is added a moment after it is placed." };
    v = await timeMachineView(h.store, { orderId });
  } catch {
    return { attached: true, mirrored: false, sentence: "The history of the rules cannot be read just now. The order's record above is complete; try again in a minute." };
  }
  // Another organisation's order reads exactly like one not mirrored yet: nothing about it is told.
  if (!v.replay || !v.order || v.orgId !== orgId) return { attached: true, mirrored: false, sentence: "This order is not in the history yet: it is added a moment after it is placed." };
  const productIds = new Set(v.order.body.lines.map((l) => l.productId));
  const mine = v.rawChanges
    .map((c, i) => ({ c, d: v.changes[i] }))
    .filter(({ c }) => c.area === "mandate" || c.area === "kitchen_rule" || c.area === "suspension" || (c.area === "hold" && productIds.has(String((c.after ?? c.before)?.value.productId))));
  const r = v.replay;
  return {
    attached: true,
    mirrored: true,
    placedAt: v.order.body.createdAt,
    then: { outcome: outcomeWord(r.then.outcome), headline: r.then.headline },
    now: { outcome: outcomeWord(r.now.outcome), headline: r.now.headline },
    sentence: r.kitchenSentence,
    differences: r.thenVsNow.map((d) => ({ rule: d.rule, title: title(d.rule), then: RULE_OUTCOME[d.then?.outcome ?? ""] ?? "not checked", now: RULE_OUTCOME[d.at?.outcome ?? ""] ?? "not checked", reason: (d.at?.outcome === "pass" ? d.then?.reason : d.at?.reason) ?? "" })),
    changes: mine.map(({ d }) => ({ when: d.when, what: d.what, by: d.by })),
    reproduces: r.reproduces.same,
  };
}
