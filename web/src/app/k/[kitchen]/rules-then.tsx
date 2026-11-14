"use client";

import { useEffect, useState } from "react";
import type { KitchenRulesThen } from "@/server/mariadb/kitchen-view";
import { clock, day, helsinkiToday, say } from "../../_ui/plain";
import { usePortal } from "./portal";

/**
 * "Would it pass today?" on the kitchen's own order page: the rules the order was judged by as they stood when it was
 * placed, today's rules, what changed in between and who changed it. Read from the wholesaler's MariaDB history
 * (src/server/mariadb); when the deployment has none, one quiet line says so.
 */
export function RulesThen({ orderId }: { orderId: string }) {
  const { ui } = usePortal();
  const [r, setR] = useState<KitchenRulesThen>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    void ui<KitchenRulesThen>("GET", `rules-then?order=${encodeURIComponent(orderId)}`).then((x) => {
      if (!live) return;
      if (x.ok) setR(x.data);
      else setError(x.error.message);
    });
    return () => {
      live = false;
    };
  }, [ui, orderId]);

  if (error) return null;
  if (!r) return null;
  if (!r.attached || !r.mirrored)
    return (
      <section aria-labelledby="rules-then" className="text-[0.92rem] text-ink-soft">
        <h2 id="rules-then" className="sr-only">
          The rules it was judged by
        </h2>
        <p>{r.sentence}</p>
      </section>
    );
  const placed = `${day(helsinkiToday(new Date(r.placedAt)))} ${clock(r.placedAt)}`;
  return (
    <section aria-labelledby="rules-then" className="bg-paper">
      <div aria-hidden className="h-[3px] bg-petrol" />
      <div className="p-4">
        <h2 id="rules-then" className="display text-[1.5rem]">
          Would it pass today?
        </h2>
        <p className="mt-1 max-w-[70ch] text-[1.05rem] leading-snug">{say(r.sentence)}</p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="border-l-4 border-line pl-3">
            <dt className="text-[0.85rem] text-ink-soft">With the rules of {placed}, when it was placed</dt>
            <dd className="font-semibold">{r.then.outcome}</dd>
          </div>
          <div className={`border-l-4 pl-3 ${r.differences.length ? "border-petrol" : "border-line"}`}>
            <dt className="text-[0.85rem] text-ink-soft">With today&apos;s rules</dt>
            <dd className="font-semibold">{r.now.outcome}</dd>
          </div>
        </dl>
        {r.differences.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-[0.95rem] leading-snug">
            {r.differences.map((d) => (
              <li key={d.rule}>
                <b>{d.title}:</b> {d.then} then, {d.now} today. <span className="text-ink-soft">{say(d.reason)}</span>
              </li>
            ))}
          </ul>
        )}
        {r.changes.length > 0 && (
          <>
            <h3 className="mt-4 font-semibold">What changed since, and who changed it</h3>
            <ol className="mt-1 divide-y divide-line text-[0.93rem]">
              {r.changes.map((c, i) => (
                <li key={i} className="grid gap-x-3 py-1.5 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
                  <span className="text-ink-soft tabular">{c.when}</span>
                  <span>
                    {say(c.what)} <span className="text-ink-soft">({c.by})</span>
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
        <p className="mt-3 text-[0.85rem] text-ink-soft">
          The same check the order went through, run again on the rules as they stood{r.reproduces ? "; against the rules of that moment it gives exactly the answer your order got" : ""}. Kept by the wholesaler in a database that records every earlier version of each rule by itself.
        </p>
      </div>
    </section>
  );
}
