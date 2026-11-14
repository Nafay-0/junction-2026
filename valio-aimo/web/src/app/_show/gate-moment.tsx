"use client";

import { Check, X } from "lucide-react";
import { clockSeconds, money, say } from "../_ui/plain";
import { Target } from "../_ui/target";
import type { SignOffView, WeekStep } from "@/server/show/types";
import { useArrival, useShowNow } from "./clock";
import { css } from "./css";
import { titleOf } from "./words";

/**
 * The gate's three moments on the big screen, in the gate's own language (DESIGN.md: the shop is calm, the gate is
 * loud): the request travelling along the lane and stopping at the barrier; the sign-off landing from the phone
 * with the person's name; and a refusal with its rule named. Yellow and black appear only here.
 */

const STATIONS = ["Asked", "Checked", "Priced", "Gate", "Done"] as const;

/** How far along the lane this day is, from what actually happened (0..4). */
export function stationOf(s: WeekStep): number {
  if (s.order && ["committed", "rejected", "withdrawn", "declined"].includes(s.order.status)) return 4;
  if (s.gate) return 3;
  if (s.did.some((d) => /fixed price/.test(d))) return 2;
  if (s.concern || s.options.length || s.memory.length || s.did.length) return 1;
  return 0;
}

export function Lane({ step }: { step: WeekStep }) {
  const at = stationOf(step);
  const held = step.status === "waiting" || (step.gate?.outcome === "reject") || step.signOff?.state === "timed_out" || step.signOff?.state === "declined";
  // The puck stops at the gate when it is held there; otherwise it travels on.
  const pos = held ? 3 : at;
  return (
    <div className={css.lane} aria-label={`The request is at: ${STATIONS[pos]}`}>
      {STATIONS.map((name, i) => (
        <span key={name} className={`${css.station} ${i <= pos ? css.stationOn : ""} ${i === 3 ? css.stationGate : ""}`}>
          {name}
        </span>
      ))}
      <span aria-hidden className={css.puck} style={{ transform: `translateX(${pos * 100}%)` }}>
        <span className={`${css.puckDot} ${held ? css.puckHeld : ""}`} />
      </span>
    </div>
  );
}

/**
 * The gate's slab: dark, rounded, one hazard band along its top that is the barrier itself: its two striped arms
 * close across the band while the order is held, and lift once a person signs. Everything about the stop sits inside
 * it: the rule, the figure, and who must sign (or who did), so the moment reads as one thing from three metres.
 */
function Slab({ title, sub, open = false, figure, children }: { title: string; sub: string; open?: boolean; figure?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div role="group" aria-label={title} className={`relative overflow-hidden rounded-[clamp(18px,1.6vw,32px)] bg-safety-ink shadow-[inset_0_0_0_1px_rgb(255_194_14/0.28),0_30px_80px_-30px_rgb(0_0_0/0.6)] on-dark ${css.slabIn}`}>
      <div aria-hidden className="relative h-[clamp(0.6rem,0.9vw,1.1rem)] overflow-hidden">
        <span className={`hazard absolute inset-y-0 left-0 w-1/2 ${open ? css.armLeftOpen : css.armLeft}`} />
        <span className={`hazard absolute inset-y-0 right-0 w-1/2 ${open ? css.armRightOpen : css.armRight}`} />
      </div>
      <div className="p-[clamp(0.9rem,1.5vw,2rem)]">
        <p className={`display flex items-center gap-[0.22em] leading-[0.95] text-safety ${css.gate}`}>
          <Target size={72} tone="safety" className="size-[0.82em] shrink-0" />
          {title}
        </p>
        <div className="mt-[clamp(0.5rem,0.9vw,1.1rem)] flex flex-wrap items-end justify-between gap-x-[clamp(1rem,2vw,2.6rem)] gap-y-2">
          <p className={`min-w-[18ch] max-w-[52ch] flex-1 text-paper/90 ${css.body}`}>{sub}</p>
          {figure}
        </div>
        {children}
      </div>
    </div>
  );
}

export function GatePanel({ step, names = {} }: { step: WeekStep; names?: Record<string, string> }) {
  const g = step.gate;
  if (!g) return null;
  if (g.outcome === "reject") {
    const failed = g.checks.filter((c) => c.outcome === "fail").map((c) => c.rule);
    return (
      <Slab title="Refused at the gate" sub={titleOf(g.rule)}>
        <p className={`mt-[clamp(0.7rem,1.1vw,1.4rem)] rounded-[clamp(10px,0.9vw,18px)] bg-paper/[0.07] px-[1.1em] py-[0.8em] text-paper ${css.body}`}>{say(g.reasons.find((r) => /allergen|contains/i.test(r)) ?? g.reasons[0] ?? "", names)}</p>
        {failed.length > 1 && <p className={`mt-2 text-paper/75 ${css.small}`}>Also failed: {failed.slice(1).map(titleOf).join(", ")}.</p>}
        <p className={`mt-3 text-paper/70 ${css.small}`}>Nothing was ordered. The refusal and its reason are in the ledger. The gate is plain code: no model decided this.</p>
      </Slab>
    );
  }
  if (g.outcome === "needs_human_approval") {
    const so = step.signOff;
    const signed = so?.state === "approved";
    return (
      <Slab
        title={signed ? "The gate opens" : "Stopped at the gate"}
        sub={gateSub(step)}
        open={signed}
        figure={
          <p className="shrink-0 text-right">
            <span className={`display block tabular leading-none text-paper ${css.money}`}>{money(g.totalCents)}</span>
            <span className={`mt-[0.3em] block text-paper/70 ${css.small}`}>The agent may spend {money(g.limitCents)} alone.</span>
          </p>
        }
      >
        {so && <SignOffCard so={so} />}
      </Slab>
    );
  }
  return (
    <div className={`flex items-center gap-[clamp(0.8rem,1.2vw,1.6rem)] rounded-[clamp(18px,1.6vw,32px)] bg-paper p-[clamp(0.9rem,1.4vw,1.8rem)] text-ink ${css.slabIn}`}>
      <span aria-hidden className="flex size-[clamp(2.6rem,3.6vw,4.4rem)] shrink-0 items-center justify-center rounded-full bg-good text-paper">
        <Check className="size-[55%]" strokeWidth={3} />
      </span>
      <div className="min-w-0">
        <p className={`display ${css.title}`}>Passed: the agent may place it alone</p>
        <p className={`mt-1 text-ink-soft ${css.body}`}>
          All {g.checks.length} checks passed. {money(g.totalCents)} of the {money(g.limitCents)} it may spend alone.
        </p>
      </div>
    </div>
  );
}

function gateSub(step: WeekStep): string {
  const so = step.signOff;
  const who = so ? so.approverName : "the named person";
  const why = step.gate?.rule === "per_order_limit" ? "Over the agent's own spending limit." : `${titleOf(step.gate?.rule)}.`;
  if (so?.state === "approved") return `${why} ${who} signed it with a passkey on their own phone.`;
  if (so?.state === "declined") return `${why} ${who} declined it. Nothing was ordered.`;
  if (so?.state === "timed_out" || so?.state === "withdrawn") return `${why} Nobody signed, so the agent withdrew it.`;
  return `${why} Only ${who} can sign it, on their own phone. The agent cannot approve its own order.`;
}

/** The phone side of the gate, inside the slab: waiting with the time left, then the sign-off landing with the name. */
export function SignOffCard({ so }: { so: SignOffView }) {
  const now = useShowNow(so.state === "waiting");
  // When the decision reached this screen: the screen's own clock at first sight, against the server's decision time.
  const arrived = useArrival(so.state === "approved" || so.state === "declined");
  const box = "mt-[clamp(0.8rem,1.3vw,1.6rem)] flex items-center gap-[clamp(0.8rem,1.4vw,1.8rem)] rounded-[clamp(12px,1.1vw,22px)] p-[clamp(0.7rem,1.1vw,1.4rem)]";
  if (so.state === "approved" || so.state === "declined") {
    const d = so.decidedAt && arrived ? (arrived - Date.parse(so.decidedAt)) / 1000 : undefined;
    const delay = d !== undefined && d >= 0 && d < 30 ? d : undefined;
    const ok = so.state === "approved";
    return (
      <div className={`${box} bg-paper text-ink`}>
        <span className={`display inline-flex shrink-0 items-center gap-[0.25em] rounded-full py-[0.12em] pl-[0.22em] pr-[0.5em] leading-none ${ok ? "bg-good text-paper" : "bg-surface text-ink"} ${css.money} ${css.land}`}>
          <span aria-hidden className={`flex size-[0.95em] items-center justify-center rounded-full ${ok ? "bg-paper text-good" : "bg-paper text-ink"}`}>
            {ok ? <Check className="size-[0.62em]" strokeWidth={3.2} /> : <X className="size-[0.62em]" strokeWidth={3.2} />}
          </span>
          {ok ? "Signed" : "Declined"}
        </span>
        <div className="min-w-0">
          <p className={`display ${css.title}`}>{so.approverName}</p>
          <p className={`text-ink-soft ${css.body}`}>
            {so.roleLabel}, {so.method === "passkey" ? "with a passkey (Face ID or fingerprint)" : so.verified === false ? "with an unverified demo tap" : "on their phone"}, at {clockSeconds(so.decidedAt ?? so.seenAt ?? new Date())}.
          </p>
          {delay !== undefined && <p className={`text-ink-soft ${css.small}`}>On this screen {delay.toFixed(1).replace(".", ",")} s after the passkey.</p>}
        </div>
      </div>
    );
  }
  if (so.state !== "waiting") {
    return (
      <div className={`${box} bg-paper/[0.07]`}>
        <div className="min-w-0">
          <p className={`text-paper ${css.lead}`}>{so.state === "rejected" ? "Approved, but the re-check at sign-off refused it." : `Nobody signed in time, so the agent withdrew the order.`}</p>
          <p className={`mt-1 text-paper/75 ${css.body}`}>Nothing was bought without a person.</p>
        </div>
      </div>
    );
  }
  const total = Math.max(1, Date.parse(so.deadline) - Date.parse(so.askedAt));
  const left = Math.max(0, Date.parse(so.deadline) - now);
  const frac = left / total;
  return (
    <div className={`${box} bg-paper/[0.07] ring-1 ring-inset ring-safety/40`}>
      <PhoneGlyph frac={frac} seconds={Math.ceil(left / 1000)} />
      <div className="min-w-0">
        <p className={`display flex items-center gap-[0.4em] text-safety ${css.title}`}>
          <span aria-hidden className={`inline-block size-[0.42em] shrink-0 rounded-full bg-safety ${css.breathe}`} />
          Waiting for {so.approverName}
        </p>
        <p className={`mt-[0.2em] text-paper/90 ${css.body}`}>
          {so.phone ? "It is on their phone now: what, how much, and why they are asked. They approve with Face ID or a fingerprint." : "No phone has joined this kitchen, so nobody can sign it: the agent will withdraw it when the time runs out."}
        </p>
      </div>
    </div>
  );
}

/** A drawn phone with a ring that empties as the time runs out. */
function PhoneGlyph({ frac, seconds }: { frac: number; seconds: number }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 80 120" className="h-[clamp(4.2rem,6.4vw,8rem)] w-auto shrink-0" aria-label={`${seconds} seconds left`} role="img">
      <rect x="5" y="4" width="70" height="112" rx="16" fill="rgb(255 255 255 / 0.06)" stroke="var(--color-paper)" strokeWidth="3.5" />
      <rect x="31" y="11" width="18" height="4" rx="2" fill="var(--color-paper)" opacity="0.7" />
      <circle cx="40" cy="62" r={r} fill="none" stroke="rgb(255 255 255 / 0.16)" strokeWidth="6" />
      <circle cx="40" cy="62" r={r} fill="none" stroke="var(--color-safety)" strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 40 62)" className={css.ring} />
      <text x="40" y="70" textAnchor="middle" fontSize="21" fontWeight="650" fill="var(--color-paper)" style={{ fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-display)" }}>
        {seconds}
      </text>
    </svg>
  );
}
