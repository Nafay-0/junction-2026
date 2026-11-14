"use client";

import { attr, day, measure, moneyShort, roleLabel, shortProduct } from "../../_ui/plain";
import type { Entry, KitchenInfo, KitchenMemory } from "./types";

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
  return (
    <section aria-labelledby="calls" className="bg-paper p-4">
      <h2 id="calls" className="text-[0.95rem] font-semibold">
        Live price checks for this request
      </h2>
      <p className="mt-1 flex items-baseline gap-3">
        <span className="display text-[3.6rem] text-petrol-deep tabular">{calls}</span>
        <span className="text-[0.98rem] leading-snug text-ink-soft">
          {!active
            ? "Nothing asked yet."
            : calls === 0
              ? "None so far: mistakes and questions are settled from local data first."
              : `call${calls === 1 ? "" : "s"} to the wholesaler's live service, covering ${products} product price${products === 1 ? "" : "s"}. The rest came from master data.`}
        </span>
      </p>
    </section>
  );
}

export function MandateBox({ k }: { k: KitchenInfo }) {
  const m = k.mandate;
  return (
    <section aria-labelledby="mandate" className="bg-paper p-4">
      <h2 id="mandate" className="text-[0.95rem] font-semibold">
        What the agent may do alone
      </h2>
      <p className="mt-1 display text-[2rem] tabular">{moneyShort(m.perOrderLimitCents)} per order</p>
      <ul className="mt-2 space-y-1 text-[0.98rem] leading-snug">
        <li>Weekly budget {moneyShort(m.weeklyBudgetCents)}, never more.</li>
        <li>Only {m.allowedCategories.map(attr).join(", ")}.</li>
        {m.requiredAttributes.length > 0 && <li>Always {m.requiredAttributes.map(attr).join(", ")}.</li>}
        {m.forbiddenAllergens.length > 0 && <li>Never {m.forbiddenAllergens.map(attr).join(" or ")}.</li>}
        <li>
          {m.substitution.rule === "none"
            ? "No substitutes."
            : m.substitution.rule === "needs_approval"
              ? `Substitutes need a person, and at most ${m.substitution.maxPriceIncreasePct} % dearer.`
              : m.substitution.rule === "within_preferences"
                ? `Like-for-like substitutes within the kitchen's preferences alone; others need a person.`
                : "Only like-for-like substitutes."}
        </li>
        <li>No splitting one need into smaller orders.</li>
      </ul>
      <h3 className="mt-3 text-[0.95rem] font-semibold">Above that, a person signs off</h3>
      <ul className="mt-1 space-y-1 text-[0.98rem]">
        {m.approvers.map((a) => (
          <li key={a.role}>
            {a.name}, {roleLabel(a.role)}: up to {moneyShort(a.maxApprovalCents)}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Memory({ memory, error, family }: { memory: KitchenMemory | undefined; error?: string; family?: string }) {
  // The family this request is about first, then the ones the kitchen orders most.
  const families = [...(memory?.families ?? [])].sort((a, b) => Number(b.family === family) - Number(a.family === family) || b.orders - a.orders);
  return (
    <section aria-labelledby="memory" className="bg-lavender p-4">
      <h2 id="memory" className="text-[0.95rem] font-semibold">
        What AimoPilot remembers about this kitchen
      </h2>
      {!memory && !error && <div className="mt-2 h-24 animate-pulse bg-mist" aria-label="Loading the kitchen's memory" />}
      {error && !memory && <p className="mt-1 text-ink-soft">Could not load the kitchen&apos;s memory: {error}</p>}
      {memory && memory.families.length === 0 && memory.stated.length === 0 && (
        <p className="mt-1 text-[0.98rem] leading-snug text-ink-soft">
          Nothing yet. AimoPilot learns usual amounts and habits from the orders this kitchen places, and keeps any rule a person states.
        </p>
      )}
      {memory && memory.stated.length > 0 && (
        <div className="mt-2">
          <h3 className="text-[0.85rem] font-medium text-ink-soft">Rules a person stated (always applied)</h3>
          <ul className="mt-1 space-y-1">
            {memory.stated.map((p) => (
              <li key={p.id} className="text-[0.98rem] leading-snug">
                <span className="font-semibold">{p.text}</span> <span className="text-ink-soft">({p.statedBy.replace(/\s*\(.*\)$/, "")}, {day(p.statedAt.slice(0, 10))})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {families.map((f) => {
        const last = f.lastOrder;
        return (
          <div key={f.family} className="mt-3 border-t border-line pt-2">
            <h3 className="display text-[1.4rem] capitalize">{attr(f.family)}</h3>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.98rem] leading-snug">
              <dt className="text-ink-soft">Usual</dt>
              <dd className="font-semibold tabular">
                about {measure(f.usual.amount, f.usual.unit)} <span className="font-normal text-ink-soft">({f.orders} orders)</span>
              </dd>
              <dt className="text-ink-soft">Last order</dt>
              <dd>
                {last.lines.map((l) => `${l.packs} × ${shortProduct(l.name)}`).join(" + ")}, {day(last.placedAt.slice(0, 10))}
              </dd>
              {f.learned.length > 0 && (
                <>
                  <dt className="text-ink-soft">Learned</dt>
                  <dd>
                    <ul className="space-y-0.5">
                      {f.learned.map((l) => (
                        <li key={l.text}>{shortenLearned(l.text)}</li>
                      ))}
                    </ul>
                    <p className="mt-1 text-[0.85rem] text-ink-soft">Learned habits only pre-select an answer; the buyer can change it.</p>
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
