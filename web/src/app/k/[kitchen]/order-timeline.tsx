"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { OrderTimeline } from "@/server/ops/order-timeline";
import { Badge } from "../../_ui/kit";
import { useFormat, useText } from "../../_i18n/provider";
import { clockSeconds, say as sayRaw, timelineFact } from "../../_ui/plain";
import { lookupCounts, shownSteps } from "../../_ui/timeline-steps";
import { categoryCodesL } from "./groups";
import { ORDER_TIMELINE_TEXT } from "./order-timeline.text";

type Step = OrderTimeline["steps"][number];

/**
 * The kitchen's view of its own order's timeline: the same steps the wholesaler's operations read
 * (server/ops/order-timeline.ts), from GET /api/v1/orders/{id}/timeline, with the kitchen's own memory in full.
 * By default the steps a buyer cares about (asked, what was found, the fixed price, the check, who decided, placed,
 * what happened after), the live price checks folded into one line that opens; "Show every step" opens the rest.
 * The server's sentences are shown in words; the ledger entry and any ids stay on hover.
 */
export function OrderTimelineList({ t, agentName }: { t: OrderTimeline; agentName: string }) {
  const { lang } = useFormat();
  const tx = useText(ORDER_TIMELINE_TEXT);
  const [all, setAll] = useState(false);
  const say = (text: string) => categoryCodesL(sayRaw(text), lang);
  const shown = shownSteps(t.steps);
  const visible = all ? shown : shown.filter((x) => x.key);
  const hidden = shown.length - shown.filter((x) => x.key).length;

  const row = (s: Step, nested = false) => {
    const facts = s.facts.map(timelineFact);
    const ids = facts.filter((f) => f.id);
    return (
      <li
        key={s.seq}
        title={[`Ledger entry ${s.seq} (${s.ledger.type})`, ...ids.map((f) => `${f.label}: ${f.value}`)].join("\n")}
        className={`grid grid-cols-[4.6rem_1fr] gap-x-3 py-3 sm:grid-cols-[5.2rem_11rem_1fr] ${nested ? "first:pt-1" : ""}`}
      >
        <span className="pt-px text-[0.9rem] text-ink-soft tabular">{clockSeconds(s.at)}</span>
        <span className="col-start-2 flex flex-wrap items-start gap-1 text-[0.9rem] font-semibold sm:col-start-auto sm:pt-px">
          {s.actor.kind === "agent" ? agentName : s.actor.name}
          {s.agentChoice && <Badge tone="agent">{tx.ownChoice}</Badge>}
        </span>
        <div className="col-start-2 min-w-0 sm:col-start-auto">
          <p className="leading-snug">{say(s.title)}</p>
          {s.lines
            .filter((l) => l && l !== s.title)
            .map((l, i) => (
              <p key={i} className="line-clamp-3 text-[0.95rem] leading-snug text-ink-soft">
                {say(l)}
              </p>
            ))}
          {s.checks && s.checks.some((c) => c.outcome !== "pass") && (
            <ul className="mt-1 text-[0.92rem] leading-snug text-ink-soft">
              {s.checks
                .filter((c) => c.outcome !== "pass")
                .map((c) => (
                  <li key={c.rule}>
                    – {c.title}
                    {c.reason ? `: ${say(c.reason)}` : ""}
                  </li>
                ))}
            </ul>
          )}
          {facts.some((f) => !f.id) && (
            <p className="text-[0.88rem] text-ink-soft">
              {facts
                .filter((f) => !f.id)
                .map((f) => `${f.label}: ${say(f.value)}`)
                .join(" · ")}
            </p>
          )}
        </div>
      </li>
    );
  };

  return (
    <>
      <ol className="divide-y divide-line">
        {visible.map((x) =>
          x.kind === "step" ? (
            row(x.step)
          ) : (
            <li key={`lookups-${x.seq}`} className="py-1">
              <details className="group">
                <summary className="grid cursor-pointer list-none grid-cols-[4.6rem_1fr] gap-x-3 py-2 sm:grid-cols-[5.2rem_11rem_1fr] [&::-webkit-details-marker]:hidden">
                  <span className="pt-px text-[0.9rem] text-ink-soft tabular">{clockSeconds(x.steps[0].at)}</span>
                  <span className="col-start-2 text-[0.9rem] font-semibold sm:col-start-auto sm:pt-px">{agentName}</span>
                  <span className="col-start-2 flex items-start gap-1.5 leading-snug sm:col-start-auto">
                    {tx.lookups(lookupCounts(x.steps).join(tx.then))}
                    <ChevronDown aria-hidden size={17} className="mt-0.5 shrink-0 text-petrol transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
                  </span>
                </summary>
                <ol className="divide-y divide-line border-l-2 border-line pl-3">{x.steps.map((s) => row(s, true))}</ol>
              </details>
            </li>
          ),
        )}
      </ol>
      {hidden > 0 && (
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 text-[0.95rem] font-semibold text-petrol hover:underline">
          <ChevronDown aria-hidden size={17} className={`transition-transform duration-150 motion-reduce:transition-none ${all ? "rotate-180" : ""}`} />
          {all ? tx.fewer : tx.every(t.steps.length)}
        </button>
      )}
    </>
  );
}
