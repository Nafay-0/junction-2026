"use client";

import { Check, Clock, ShieldAlert, TrendingUp, Truck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useText } from "../_i18n/provider";
import { buttonClass } from "./kit";
import { Target } from "./target";
import { WIDGET_TEXT } from "./widgets.text";

/**
 * The agent as the kitchen's home (web/docs/DESIGN.md, "The agent is home"): what a signed-in kitchen sees before
 * anything is typed. It opens with what needs the kitchen today, each a small widget that can be acted on in place,
 * then the composer, then a few starting points. It is the thread's empty state, so the first thing typed or tapped
 * carries straight on as the conversation.
 *
 * Presentational: the page passes the items, already worded for the buyer's language.
 */

export type TodayKind = "signoff" | "cutoff" | "drift" | "recall" | "delivery";

export type TodayItem = {
  id: string;
  kind: TodayKind;
  /** "Aino must sign 1 010,00 € of milk", "Order by 17.00 for Monday's milk". */
  title: string;
  detail?: string;
  /** A short figure or time on the right: "17.00", "+40 %", "Mon 16.11.". */
  figure?: string;
  primary?: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
};

export type Starter = { id: string; label: string; icon?: ReactNode; onClick: () => void };

const LOOK: Record<TodayKind, { ground: string; mark: string }> = {
  // The gate's yellow belongs to a human decision only: the sign-off is the one item that wears it.
  signoff: { ground: "border-safety/60 bg-safety-soft", mark: "bg-safety-ink text-safety" },
  cutoff: { ground: "border-line bg-paper", mark: "bg-notice-soft text-notice" },
  drift: { ground: "border-line bg-paper", mark: "bg-notice-soft text-notice" },
  recall: { ground: "border-bad/25 bg-bad-soft", mark: "bg-paper text-bad" },
  delivery: { ground: "border-line bg-paper", mark: "bg-petrol-soft text-petrol" },
};

function Mark({ kind }: { kind: TodayKind }) {
  if (kind === "signoff") return <Target size={18} tone="safety" />;
  if (kind === "cutoff") return <Clock aria-hidden size={18} />;
  if (kind === "drift") return <TrendingUp aria-hidden size={18} />;
  if (kind === "recall") return <ShieldAlert aria-hidden size={18} />;
  return <Truck aria-hidden size={18} />;
}

/** One thing that needs the kitchen, with the action that settles it. */
export function TodayRow({ item }: { item: TodayItem }) {
  const look = LOOK[item.kind];
  return (
    <li className={`lane-enter rounded-xl border p-3.5 ${look.ground}`}>
      <div className="flex items-start gap-3">
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${look.mark}`}>
          <Mark kind={item.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug [overflow-wrap:anywhere]">{item.title}</p>
          {item.detail && <p className="mt-0.5 text-[0.88rem] leading-snug text-ink-soft">{item.detail}</p>}
        </div>
        {item.figure && <p className="display shrink-0 text-[1.05rem] leading-tight tabular">{item.figure}</p>}
      </div>
      {(item.primary || item.secondary) && (
        <div className="mt-3 flex flex-wrap gap-2 pl-[3.25rem]">
          {item.primary && (
            <button type="button" onClick={item.primary.onClick} className={buttonClass(item.kind === "signoff" ? "safety" : "primary", "sm")}>
              {item.primary.label}
            </button>
          )}
          {item.secondary && (
            <button type="button" onClick={item.secondary.onClick} className={buttonClass("secondary", "sm")}>
              {item.secondary.label}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function AgentHome({ greeting, lead, today, quiet, starters, composer, max = 3 }: {
  /** "Good morning, Hotel Lumo." */
  greeting: string;
  /** "Two things need you today." */
  lead?: string;
  today: TodayItem[];
  /** What to say when nothing needs them: "Nothing needs you today. Next delivery Mon 16.11." */
  quiet?: string;
  starters: Starter[];
  /** The composer, when the page does not keep it in the dock's footer (keep it there on a phone: under the thumb). */
  composer?: ReactNode;
  /** How many of today's items show before "show more": the most pressing few, never a wall. */
  max?: number;
}) {
  const tx = useText(WIDGET_TEXT);
  const [all, setAll] = useState(false);
  const shown = all ? today : today.slice(0, max);
  const hidden = today.length - Math.min(today.length, max);
  return (
    <div className="flex flex-col gap-5">
      <header className="px-1">
        <h2 className="display text-[1.7rem] leading-[1.1] [overflow-wrap:anywhere] sm:text-[2rem]">{greeting}</h2>
        {lead && <p className="mt-1.5 text-[1rem] leading-snug text-ink-soft">{lead}</p>}
      </header>

      {today.length > 0 ? (
        <section aria-label={tx.home.today}>
          <ul className="grid gap-2.5">
            {shown.map((t) => (
              <TodayRow key={t.id} item={t} />
            ))}
          </ul>
          {hidden > 0 && (
            <button type="button" aria-expanded={all} onClick={() => setAll(!all)} className="mt-1.5 flex min-h-11 w-full items-center justify-center rounded-full text-[0.9rem] font-medium text-petrol transition-colors duration-150 hover:bg-petrol-soft">
              {all ? tx.home.fewer : tx.home.more(hidden)}
            </button>
          )}
        </section>
      ) : (
        quiet && (
          <p className="flex items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 py-3.5 text-[0.95rem] leading-snug">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-good-soft text-good">
              <Check aria-hidden size={18} strokeWidth={2.6} />
            </span>
            <span>
              <span className="sr-only">{tx.home.quietMark}: </span>
              {quiet}
            </span>
          </p>
        )
      )}

      {composer}

      {starters.length > 0 && (
        <section aria-label={tx.home.start}>
          <p className="px-1 text-[0.82rem] font-medium text-ink-soft">{tx.home.start}</p>
          <ul className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-3">
            {starters.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={s.onClick} className="flex h-full min-h-[3.25rem] w-full items-center gap-2.5 rounded-xl border border-line-strong/70 bg-paper px-3 py-2 text-left text-[0.9rem] font-medium leading-snug transition-[border-color,background-color] duration-150 hover:border-petrol hover:bg-petrol-soft">
                  {s.icon && <span className="shrink-0 text-petrol">{s.icon}</span>}
                  <span className="[overflow-wrap:anywhere]">{s.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
