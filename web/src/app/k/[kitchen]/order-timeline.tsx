"use client";

import type { OrderTimeline } from "@/server/ops/order-timeline";
import { Badge } from "../../_ui/kit";
import { clockSeconds, say, timelineFact } from "../../_ui/plain";

/**
 * The kitchen's view of its own order's timeline: the same steps the wholesaler's operations read
 * (server/ops/order-timeline.ts), from GET /api/v1/orders/{id}/timeline, with the kitchen's own memory in full.
 * The server's sentences are shown in words (ids, codes and money written as the store writes them); the ledger entry
 * and any ids stay on hover.
 */
export function OrderTimelineList({ t, agentName }: { t: OrderTimeline; agentName: string }) {
  return (
    <ol className="divide-y divide-line">
      {t.steps.map((s) => {
        const facts = s.facts.map(timelineFact);
        const ids = facts.filter((f) => f.id);
        return (
          <li key={s.seq} title={[`Ledger entry ${s.seq} (${s.ledger.type})`, ...ids.map((f) => `${f.label}: ${f.value}`)].join("\n")} className="grid grid-cols-[4.6rem_1fr] gap-x-3 py-3 sm:grid-cols-[5.2rem_11rem_1fr]">
            <span className="pt-px text-[0.9rem] text-ink-soft tabular">{clockSeconds(s.at)}</span>
            <span className="col-start-2 flex flex-wrap items-start gap-1 text-[0.9rem] font-semibold sm:col-start-auto sm:pt-px">
              {s.actor.kind === "agent" ? agentName : s.actor.name}
              {s.agentChoice && <Badge tone="agent">its own choice</Badge>}
            </span>
            <div className="col-start-2 min-w-0 sm:col-start-auto">
              <p className="leading-snug">{say(s.title)}</p>
              {s.lines
                .filter((l) => l && l !== s.title)
                .map((l, i) => (
                  <p key={i} className="text-[0.95rem] leading-snug text-ink-soft">
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
      })}
    </ol>
  );
}
