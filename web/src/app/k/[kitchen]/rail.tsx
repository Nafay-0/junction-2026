"use client";

import { useFormat, useText } from "../../_i18n/provider";
import { moneyShort, shortProduct } from "../../_ui/plain";
import { familyL } from "./family.text";
import { RAIL_TEXT } from "./rail.text";
import type { Entry, KitchenInfo, KitchenMemory } from "./types";
import { useProductName } from "./names";

/** How many times this request touched the partner's live price and availability service, from the ledger. */
export function liveCallsOf(entries: Entry[]): { calls: number; products: number } {
  let calls = 0;
  let products = 0;
  for (const e of entries) {
    if (e.type === "lookup" && e.data.source === "live") {
      calls += 1;
      products += Array.isArray(e.data.productIds) ? e.data.productIds.length : 0;
    } else if (e.type === "quote") {
      calls += 1; // the wholesaler re-reads live prices to fix the quote
      products += Array.isArray(e.data.lines) ? e.data.lines.length : 0;
    }
  }
  return { calls, products };
}

export function LiveCalls({ entries, active }: { entries: Entry[]; active: boolean }) {
  const { calls, products } = liveCallsOf(entries);
  const tx = useText(RAIL_TEXT);
  return (
    <section aria-labelledby="calls" className="bg-paper p-4">
      <h2 id="calls" className="text-[0.95rem] font-semibold">
        {tx.callsTitle}
      </h2>
      <p className="mt-1 flex items-baseline gap-3">
        <span className="display text-[3.6rem] text-petrol-deep tabular">{calls}</span>
        <span className="text-[0.98rem] leading-snug text-ink-soft">
          {!active ? tx.notAsked : calls === 0 ? tx.noCalls : tx.calls(calls, products)}
        </span>
      </p>
    </section>
  );
}

export function MandateBox({ k }: { k: KitchenInfo }) {
  const m = k.mandate;
  const tx = useText(RAIL_TEXT);
  const f = useFormat();
  return (
    <section aria-labelledby="mandate" className="bg-paper p-4">
      <h2 id="mandate" className="text-[0.95rem] font-semibold">
        {tx.mandateTitle}
      </h2>
      <p className="mt-1 display text-[2rem] tabular">{tx.perOrder(moneyShort(m.perOrderLimitCents))}</p>
      <ul className="mt-2 space-y-1 text-[0.98rem] leading-snug">
        <li>{tx.weekly(moneyShort(m.weeklyBudgetCents))}</li>
        <li>{tx.only(m.allowedCategories.map((c) => familyL(c, f.lang)).join(", "))}</li>
        {m.requiredAttributes.length > 0 && <li>{tx.always(m.requiredAttributes.map(f.attr).join(", "))}</li>}
        {m.forbiddenAllergens.length > 0 && <li>{tx.never(m.forbiddenAllergens.map(f.attr).join(tx.or))}</li>}
        <li>
          {m.substitution.rule === "none"
            ? tx.noSubs
            : m.substitution.rule === "needs_approval"
              ? tx.subsPerson(m.substitution.maxPriceIncreasePct)
              : m.substitution.rule === "within_preferences"
                ? tx.subsPrefs
                : tx.subsLike}
        </li>
        <li>{tx.noSplit}</li>
      </ul>
      <h3 className="mt-3 text-[0.95rem] font-semibold">{tx.above}</h3>
      <ul className="mt-1 space-y-1 text-[0.98rem]">
        {m.approvers.map((a) => (
          <li key={a.role}>
            {tx.approver(a.name, f.role(a.role), moneyShort(a.maxApprovalCents))}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Memory({ memory, error, family }: { memory: KitchenMemory | undefined; error?: string; family?: string }) {
  const pn = useProductName();
  // The family this request is about first, then the ones the kitchen orders most.
  const families = [...(memory?.families ?? [])].sort((a, b) => Number(b.family === family) - Number(a.family === family) || b.orders - a.orders);
  const tx = useText(RAIL_TEXT);
  const f = useFormat();
  return (
    <section aria-labelledby="memory" className="bg-lavender p-4">
      <h2 id="memory" className="text-[0.95rem] font-semibold">
        {tx.memoryTitle}
      </h2>
      {!memory && !error && <div className="mt-2 h-24 animate-pulse bg-mist" aria-label={tx.memoryLoading} />}
      {error && !memory && <p className="mt-1 text-ink-soft">{tx.memoryFailed(error)}</p>}
      {memory && memory.families.length === 0 && memory.stated.length === 0 && (
        <p className="mt-1 text-[0.98rem] leading-snug text-ink-soft">
          {tx.memoryNone}
        </p>
      )}
      {memory && memory.stated.length > 0 && (
        <div className="mt-2">
          <h3 className="text-[0.85rem] font-medium text-ink-soft">{tx.stated}</h3>
          <ul className="mt-1 space-y-1">
            {memory.stated.map((p) => (
              <li key={p.id} className="text-[0.98rem] leading-snug">
                <span className="font-semibold">{p.text}</span> <span className="text-ink-soft">({p.statedBy.replace(/\s*\(.*\)$/, "")}, {f.day(p.statedAt.slice(0, 10))})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {families.map((fam) => {
        const last = fam.lastOrder;
        return (
          <div key={fam.family} className="mt-3 border-t border-line pt-2">
            <h3 className="display text-[1.4rem] capitalize">{familyL(fam.family, f.lang)}</h3>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.98rem] leading-snug">
              <dt className="text-ink-soft">{tx.usual}</dt>
              <dd className="font-semibold tabular">
                {tx.about(f.measure(fam.usual.amount, fam.usual.unit))} <span className="font-normal text-ink-soft">{tx.orders(fam.orders)}</span>
              </dd>
              <dt className="text-ink-soft">{tx.lastOrder}</dt>
              <dd>
                {last.lines.map((l) => `${l.packs} × ${shortProduct(pn(l.productId, l.name))}`).join(" + ")}, {f.day(last.placedAt.slice(0, 10))}
              </dd>
              {fam.learned.length > 0 && (
                <>
                  <dt className="text-ink-soft">{tx.learned}</dt>
                  <dd>
                    <ul className="space-y-0.5">
                      {fam.learned.map((l) => (
                        <li key={l.text}>{shortenLearned(l.text)}</li>
                      ))}
                    </ul>
                    <p className="mt-1 text-[0.85rem] text-ink-soft">{tx.learnedNote}</p>
                  </dd>
                </>
              )}
            </dl>
          </div>
        );
      })}
    </section>
  );
}

function shortenLearned(text: string): string {
  return text.replace(/^Usually (.+?): /, (_m, name: string) => `Usually ${shortProduct(name)}: `);
}
