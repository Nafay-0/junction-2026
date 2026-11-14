"use client";

import { useEffect, useRef, useState } from "react";
import { DEMO_NOTE, PRODUCT_NAME } from "../_ui/brand";
import { day as dayText, money, moneyShort } from "../_ui/plain";
import { Check, CircleAlert, Quote, Sparkles } from "lucide-react";
import { Target } from "../_ui/target";
import { PilotLight } from "../_ui/wordmark";
import type { OptionView, WeekRun, WeekStep } from "@/server/show/types";
import { GatePanel, Lane } from "./gate-moment";
import { css } from "./css";
import { SHORT_DAY, outcomeLine, titleOf } from "./words";

/**
 * The week on the big screen. A row of six bay doors (Monday to Saturday) across the top, the current day open
 * below: on the left what the kitchen asked and what its agent did and why; on the right the request on its way to
 * the gate and what the gate decided. The running tally in plain words at the foot. When the week ends, the six
 * days and the tally stay up as the summary.
 */
export function WeekBoard({ run, compact = false, greeting, aside }: { run: WeekRun; compact?: boolean; greeting?: string; aside?: React.ReactNode }) {
  const current = run.steps[run.current];
  const finished = run.state === "finished" || run.state === "cancelled" || run.state === "failed";
  return (
    <section className={`${css.stage} ${compact ? css.compact : ""} flex h-full min-h-0 flex-col`} aria-label={`A week in ${run.kitchen.name}`}>
      <Header run={run} greeting={greeting} compact={compact} />
      <Doors run={run} />
      <div className="min-h-0 flex-1 overflow-hidden px-[clamp(0.9rem,2vw,2.6rem)] py-[clamp(0.6rem,1.4vw,1.8rem)]">
        {run.state === "preparing" && <Preparing run={run} />}
        {!finished && current && <Bay key={current.kind} step={current} compact={compact} />}
        {finished && <Summary run={run} compact={compact} />}
      </div>
      <Footer run={run} aside={aside} />
    </section>
  );
}

function Header({ run, greeting, compact }: { run: WeekRun; greeting?: string; compact: boolean }) {
  const k = run.kitchen;
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-[clamp(0.9rem,2vw,2.6rem)] pt-[clamp(0.6rem,1.2vw,1.6rem)]">
      <div className="flex min-w-0 items-center gap-3">
        <PilotLight size={compact ? "1.6rem" : "clamp(1.8rem,2.4vw,3rem)"} onDark />
        <p className={`display truncate ${css.title}`}>
          {greeting ?? "A week in"} {k.name}, {k.city}
        </p>
      </div>
      <div className={`flex flex-wrap items-center gap-x-5 gap-y-1 text-paper/85 ${css.small}`}>
        <span>
          The agent may spend <strong className="text-paper">{moneyShort(k.perOrderLimitCents)}</strong> alone
        </span>
        <span>
          {k.house ? "No phone joined: nobody can sign" : <>Signs: <strong className="text-paper">{k.approverName}</strong>{k.passkey ? ", passkey on the phone" : ""}</>}
        </span>
        {run.source === "recording" && <span className="rounded-full bg-paper/[0.12] px-[0.8em] py-[0.15em] font-medium text-paper">Recording of a real run{run.recordedAt ? `, ${dayText(run.recordedAt.slice(0, 10))}` : ""}</span>}
      </div>
    </header>
  );
}

function Doors({ run }: { run: WeekRun }) {
  return (
    <ol className="mt-[clamp(0.5rem,1vw,1.3rem)] grid grid-cols-6 gap-[clamp(0.3rem,0.5vw,0.7rem)] px-[clamp(0.9rem,2vw,2.6rem)]" aria-label="The week">
      {run.steps.map((s, i) => {
        const now = i === run.current && run.state !== "finished";
        const gate = s.gate && (s.gate.outcome !== "auto_approve");
        return (
          <li
            key={s.kind}
            aria-current={now ? "step" : undefined}
            className={`relative min-w-0 overflow-hidden rounded-[clamp(10px,0.9vw,18px)] px-[clamp(0.5rem,0.9vw,1.1rem)] py-[clamp(0.4rem,0.65vw,0.85rem)] transition-colors duration-300 ${now ? "bg-paper text-ink shadow-[0_10px_30px_-12px_rgb(0_0_0/0.5)]" : s.status === "ahead" ? "bg-paper/[0.05] text-paper/50" : "bg-paper/[0.11] text-paper"}`}
          >
            <p className={`display ${css.lead}`}>{SHORT_DAY[s.day] ?? s.day}</p>
            <p className={`truncate ${css.small}`}>{s.status === "ahead" || now ? s.title : outcomeLine(s, moneyShort)}</p>
            {gate && s.status !== "ahead" && <Target size={20} tone="safety" className="absolute right-[0.6vw] top-[0.6vw] size-[clamp(1rem,1.2vw,1.6rem)]" title="Decided at the gate" />}
            {!gate && s.status === "done" && !now && (
              <span aria-hidden className="absolute right-[0.6vw] top-[0.6vw] flex size-[clamp(1rem,1.2vw,1.6rem)] items-center justify-center rounded-full bg-lime text-ink">
                <Check className="size-[65%]" strokeWidth={3} />
              </span>
            )}
            {now && <span aria-hidden className="absolute inset-x-[clamp(0.5rem,0.9vw,1.1rem)] bottom-[0.35vw] h-[4px] rounded-full bg-lime" />}
          </li>
        );
      })}
    </ol>
  );
}

function Preparing({ run }: { run: WeekRun }) {
  return (
    <div className={`flex h-full flex-col justify-center ${css.bayIn}`}>
      <p className={`display ${css.day}`}>Setting up the week</p>
      <p className={`mt-4 max-w-[60ch] text-paper/85 ${css.lead}`}>
        {run.kitchen.name}&apos;s agent reads the kitchen&apos;s last six weeks of orders (made up for the demo, like every visitor kitchen) and checks live which products can be delivered on the days ahead.
      </p>
    </div>
  );
}

function Bay({ step, compact }: { step: WeekStep; compact: boolean }) {
  return (
    <div className={`grid h-full min-h-0 gap-[clamp(0.8rem,2vw,2.6rem)] ${compact ? "grid-rows-[auto_1fr]" : "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]"} ${css.bayIn}`}>
      <div className="min-h-0 overflow-hidden">
        <div className="flex flex-wrap items-baseline gap-x-5">
          <h2 className={`display leading-[0.9] ${css.day}`}>{step.day}</h2>
          <p className={`display text-paper/85 ${css.title}`}>{step.title}</p>
        </div>
        {step.delivery && <p className={`mt-1 text-paper/70 ${css.small}`}>For delivery {dayText(step.delivery)} (a real date: the week is compressed, the orders are not)</p>}
        {step.asked && (
          <figure className="mt-[clamp(0.6rem,1.2vw,1.4rem)] rounded-[clamp(14px,1.2vw,24px)] bg-paper/[0.07] px-[clamp(0.8rem,1.3vw,1.6rem)] py-[clamp(0.6rem,1vw,1.3rem)]">
            <figcaption className={`flex items-center gap-[0.4em] text-paper/65 ${css.small}`}>
              <Quote aria-hidden className="size-[1em] text-paper/70" fill="currentColor" strokeWidth={0} />
              The kitchen
            </figcaption>
            <blockquote className={`mt-[0.2em] text-paper ${css.lead}`}>&ldquo;{step.asked}&rdquo;</blockquote>
          </figure>
        )}
        {step.did.length > 0 && (
          <div className="mt-[clamp(0.6rem,1.2vw,1.4rem)] px-[clamp(0.8rem,1.3vw,1.6rem)]">
            <p className={`flex items-center gap-[0.4em] text-lavender-mid ${css.small}`}>
              <Sparkles aria-hidden className="size-[1em]" />
              Its agent
            </p>
            <ol className="mt-[0.3em] space-y-[0.35em]">
              {step.did.map((d, i) => (
                <li key={i} className={`grid grid-cols-[1.1em_minmax(0,1fr)] gap-x-[0.5em] text-paper ${css.body} ${css.lineIn}`}>
                  <span aria-hidden className="mt-[0.5em] size-[0.45em] rounded-full bg-lavender-mid" />
                  <span>{d}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {step.memory.length > 0 && !compact && (
          <ul className="mt-[clamp(0.5rem,1vw,1.2rem)] flex flex-wrap gap-2">
            {step.memory.slice(0, 3).map((m) => (
              <li key={m} className={`inline-flex items-center gap-[0.4em] rounded-full bg-lavender px-[0.8em] py-[0.2em] text-lavender-deep ${css.small}`}>
                <Sparkles aria-hidden className="size-[0.95em] shrink-0" />
                From memory: {m}
              </li>
            ))}
          </ul>
        )}
        {step.note && <p className={`mt-3 text-paper/80 ${css.body}`}>{step.note}</p>}
      </div>
      <div className="min-h-0 space-y-[clamp(0.6rem,1.2vw,1.4rem)] overflow-hidden">
        <Lane step={step} />
        {step.concern && <ConcernCard step={step} />}
        {step.options.length > 0 && !(step.gate && step.gate.outcome !== "auto_approve") && <Options options={step.options} compact={compact} />}
        {shownExcluded(step).length > 0 && !(step.gate && step.gate.outcome !== "auto_approve") && (
          <ul className={`space-y-1 text-paper/80 ${css.small}`}>
            {shownExcluded(step).slice(0, compact ? 1 : 3).map((e) => (
              <li key={e.name + e.reason}>
                {e.simulated && <strong className="mr-2 rounded-full bg-paper px-[0.6em] font-semibold text-petrol-deep">Simulated</strong>}
                Left out: {e.name}: {e.reason}
              </li>
            ))}
          </ul>
        )}
        <GatePanel step={step} />
      </div>
    </div>
  );
}

/** What availability took away, where it is the story: the simulated stock-out on Wednesday, passed cut-offs on Thursday. */
function shownExcluded(step: WeekStep) {
  if (step.kind === "stockout") return step.excluded.filter((e) => e.simulated || e.code === "out_of_stock");
  if (step.kind === "lastminute") return step.excluded.filter((e) => e.code === "cutoff_passed" || e.code === "too_late");
  return [];
}

function ConcernCard({ step }: { step: WeekStep }) {
  const c = step.concern!;
  return (
    <div className={`rounded-[clamp(18px,1.6vw,32px)] bg-notice-soft text-ink ${css.slabIn}`}>
      <div className="p-[clamp(0.9rem,1.4vw,1.8rem)]">
        <p className={`display flex items-center gap-[0.4em] text-notice ${css.title}`}>
          <CircleAlert aria-hidden className="size-[0.9em] shrink-0" strokeWidth={2.4} />
          {step.kind === "drift" ? "Asked before renewing" : "Stopped before any price lookup"}
        </p>
        <p className={`mt-1 ${css.body}`}>{c.message}</p>
        <p className={`mt-2 ${css.body}`}>
          <strong>Answer: {c.answer}.</strong> <span className="text-ink-soft">Scripted for the demo, as {c.answeredBy} would; the ledger records it as relayed by the agent.</span>
        </p>
      </div>
    </div>
  );
}

const RANK: Record<string, string> = { best: "Best", better: "Better", good: "Good" };
const LABEL: Record<string, string> = { best_price: "best price", lowest_carbon: "lowest carbon", most_reliable: "most reliable", same_as_last_time: "same as last time" };

function Options({ options, compact }: { options: OptionView[]; compact: boolean }) {
  return (
    <ol className={`grid gap-[clamp(0.3rem,0.5vw,0.7rem)] ${compact ? "grid-cols-1" : "grid-cols-3"}`} aria-label="Options, good, better, best">
      {options.slice(0, compact ? 1 : 3).map((o) => (
        <li key={o.title + o.rank} className={`relative rounded-[clamp(12px,1.1vw,22px)] p-[clamp(0.6rem,1vw,1.2rem)] ${o.chosen ? "bg-paper text-ink" : "bg-paper/[0.08] text-paper"}`}>
          <p className={`display ${css.lead}`}>{RANK[o.rank] ?? o.rank}</p>
          <p className={`mt-0.5 line-clamp-2 ${css.small}`}>{o.title}</p>
          <p className={`display tabular mt-1 ${css.lead}`}>{money(o.totalCents)}</p>
          <p className={`${o.chosen ? "text-ink-soft" : "text-paper/75"} ${css.small}`}>{o.labels.map((l) => LABEL[l] ?? l).join(", ") || (o.match === "compromise" ? "gives something up" : "a full match")}</p>
          {o.chosen && <span className={`absolute right-[0.7vw] top-[0.7vw] inline-flex items-center gap-[0.3em] rounded-full bg-lime px-[0.6em] font-semibold text-ink ${css.small}`}><Check aria-hidden className="size-[0.9em]" strokeWidth={3} />Chosen</span>}
        </li>
      ))}
    </ol>
  );
}

function Summary({ run, compact }: { run: WeekRun; compact: boolean }) {
  return (
    <div className={`flex h-full min-h-0 flex-col ${css.bayIn}`}>
      <h2 className={`display ${css.day}`}>{run.state === "finished" ? "The week, done" : run.state === "cancelled" ? "The week was stopped" : "The week stopped early"}</h2>
      {run.error && <p className={`mt-2 text-paper/85 ${css.body}`}>{run.error}</p>}
      <ol className={`mt-[clamp(0.6rem,1.2vw,1.4rem)] grid gap-[clamp(0.4rem,0.6vw,0.8rem)] ${compact ? "grid-cols-1" : "grid-cols-2 xl:grid-cols-3"}`}>
        {run.steps.map((s) => (
          <li key={s.kind} className="flex items-start gap-[0.8em] rounded-[clamp(14px,1.2vw,24px)] bg-paper/[0.08] p-[clamp(0.7rem,1.1vw,1.4rem)]">
            {s.gate && s.gate.outcome !== "auto_approve" ? (
              <Target size={28} tone="safety" className="mt-[0.15em] size-[clamp(1.6rem,2vw,2.6rem)] shrink-0" />
            ) : (
              <span aria-hidden className="mt-[0.15em] flex size-[clamp(1.6rem,2vw,2.6rem)] shrink-0 items-center justify-center rounded-full bg-lime text-ink">
                <Check className="size-[60%]" strokeWidth={3} />
              </span>
            )}
            <div className="min-w-0">
              <p className={`display ${css.lead}`}>
                {s.day}: {s.title}
              </p>
              <p className={`text-paper/85 ${css.small}`}>{outcomeLine(s, moneyShort) || titleOf(s.gate?.rule)}</p>
            </div>
          </li>
        ))}
      </ol>
      {run.cleanup && !compact && <p className={`mt-3 text-paper/70 ${css.small}`}>Afterwards: {run.cleanup.join(" ")}</p>}
    </div>
  );
}

function Count({ n, label }: { n: number; label: string }) {
  const [bumped, setBumped] = useState(false);
  const prev = useRef(n);
  useEffect(() => {
    if (n === prev.current) return;
    prev.current = n;
    setBumped(true);
    const t = setTimeout(() => setBumped(false), 650);
    return () => clearTimeout(t);
  }, [n]);
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className={`display tabular text-lime ${css.tally} ${bumped ? css.bump : ""}`}>{n}</span>
      <span className={`text-paper ${css.lead}`}>{label}</span>
    </span>
  );
}

function Footer({ run, aside }: { run: WeekRun; aside?: React.ReactNode }) {
  const t = run.tally;
  return (
    <footer className="flex items-end gap-4 border-t border-paper/15 px-[clamp(0.9rem,2vw,2.6rem)] pb-[clamp(0.5rem,1vw,1.2rem)] pt-[clamp(0.4rem,0.8vw,1rem)]">
      <div className="min-w-0 flex-1">
      <p className="flex flex-wrap items-baseline gap-x-[clamp(1rem,2.4vw,3rem)] gap-y-1" aria-live="polite">
        <Count n={t.decisions} label={t.decisions === 1 ? "decision" : "decisions"} />
        <Count n={t.askedPerson} label="asked a person" />
        <Count n={t.refused} label="refused" />
        <Count n={t.wrongOrders} label={t.wrongOrders === 1 ? "wrong order" : "wrong orders"} />
      </p>
      <p className={`mt-1 text-paper/65 ${css.small}`}>
        Every step is a real request through {PRODUCT_NAME}&apos;s gate, {run.catalogue === "partner" ? "on the partner's real catalogue and live prices" : "on the 12-product sample catalogue"}; {run.liveCalls} live price calls so far. Answers to questions are scripted; the sign-off is a real person.
        {run.simulated.length > 0 && <> {run.simulated.join(". ")}.</>} {DEMO_NOTE}
      </p>
      </div>
      {aside}
    </footer>
  );
}
