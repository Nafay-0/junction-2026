"use client";

import { useEffect, useState } from "react";
import type { KitchenRulesThen } from "@/server/mariadb/kitchen-view";
import { ArrowRight, History } from "lucide-react";
import { useFormat, useText } from "../../_i18n/provider";
import { Card, Panel } from "../../_ui/kit";
import { clock, helsinkiToday, say } from "../../_ui/plain";
import { RULES_THEN_TEXT } from "./rules-then.text";
import { usePortal } from "./portal";

/**
 * "Would it pass today?" on the kitchen's own order page: the rules the order was judged by as they stood when it was
 * placed, today's rules, what changed in between and who changed it. Read from the wholesaler's MariaDB history
 * (src/server/mariadb); when the deployment has none, one quiet line says so.
 */
export function RulesThen({ orderId }: { orderId: string }) {
  const { ui } = usePortal();
  const tx = useText(RULES_THEN_TEXT);
  const f = useFormat();
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
  // No history kept on this deployment: nothing to show the kitchen (the server's sentence is a note for engineers).
  if (!r.attached) return null;
  if (!r.mirrored)
    return (
      <section aria-labelledby="rules-then" className="text-[0.92rem] text-ink-soft">
        <h2 id="rules-then" className="sr-only">
          {tx.hidden}
        </h2>
        <p>{r.sentence}</p>
      </section>
    );
  const placed = `${f.day(helsinkiToday(new Date(r.placedAt)))} ${clock(r.placedAt)}`;
  const changed = r.differences.length > 0;
  return (
    <section aria-labelledby="rules-then">
    <Card pad className="space-y-5">
      <div>
        <h2 id="rules-then" className="flex items-center gap-2.5">
          <History aria-hidden size={20} className="text-petrol" />
          <span className="display text-[1.35rem]">{tx.title}</span>
        </h2>
        <p className="mt-2 max-w-[68ch] leading-relaxed">{say(r.sentence)}</p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Panel className="p-4">
          <dt className="text-[0.86rem] leading-snug text-ink-soft">{tx.then(placed)}</dt>
          <dd className="mt-1 font-semibold leading-snug">{r.then.outcome}</dd>
        </Panel>
        <Panel tone={changed ? "petrol" : "surface"} className="p-4">
          <dt className="text-[0.86rem] leading-snug text-ink-soft">{tx.now}</dt>
          <dd className="mt-1 font-semibold leading-snug">{r.now.outcome}</dd>
        </Panel>
      </dl>
      {changed && (
        <ul className="space-y-2 text-[0.95rem] leading-snug">
          {r.differences.map((d) => (
            <li key={d.rule} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-1.5">
              <ArrowRight aria-hidden size={15} className="mt-[0.2em] text-petrol" />
              <span>
                <span className="font-semibold">{tx.diff(d.title, d.then, d.now)}</span> <span className="text-ink-soft">{say(d.reason)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {r.changes.length > 0 && (
        <div>
          <h3 className="text-[0.95rem] font-semibold">{tx.changes}</h3>
          <ol className="mt-2 divide-y divide-line text-[0.93rem]">
            {r.changes.map((c, i) => (
              <li key={i} className="grid gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
                <span className="text-ink-soft tabular">{c.when}</span>
                <span>
                  {say(c.what)} <span className="text-ink-soft">({c.by})</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="text-[0.85rem] leading-snug text-ink-soft">{tx.note(r.reproduces)}</p>
    </Card>
    </section>
  );
}
