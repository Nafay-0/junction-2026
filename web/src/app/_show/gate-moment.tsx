"use client";

import { clockSeconds, money, say } from "../_ui/plain";
import { Target } from "../_ui/target";
import type { SignOffView, WeekStep } from "@/server/show/types";
import { useShowNow } from "./clock";
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

/** The black slab in a hazard frame, with the barrier across its top: closed while held, lifting once signed. */
function Slab({ title, sub, open = false, children }: { title: string; sub: string; open?: boolean; children?: React.ReactNode }) {
  return (
    <div role="group" aria-label={title} className={`hazard-frame on-dark relative overflow-hidden ${css.slabIn}`}>
      <div aria-hidden className="relative h-5 overflow-hidden">
        <span className={`hazard-thin absolute inset-y-0 left-0 w-1/2 ${open ? css.armLeftOpen : css.armLeft}`} />
        <span className={`hazard-thin absolute inset-y-0 right-0 w-1/2 ${open ? css.armRightOpen : css.armRight}`} />
      </div>
      <div className="p-[clamp(0.9rem,1.6vw,2.2rem)]">
        <div className="flex items-start gap-[clamp(0.8rem,1.4vw,1.8rem)]">
          <Target size={72} tone="safety" className="shrink-0" />
          <div className="min-w-0">
            <p className={`display leading-[0.92] text-safety ${css.gate}`}>{title}</p>
            <p className={`mt-2 text-paper ${css.lead}`}>{sub}</p>
          </div>
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
        <p className={`mt-4 text-paper ${css.body}`}>{say(g.reasons.find((r) => /allergen|contains/i.test(r)) ?? g.reasons[0] ?? "", names)}</p>
        {failed.length > 1 && <p className={`mt-2 text-paper/75 ${css.small}`}>Also failed: {failed.slice(1).map(titleOf).join(", ")}.</p>}
        <p className={`mt-3 text-paper/75 ${css.small}`}>Nothing was ordered. The refusal and its reason are in the ledger. The gate is plain code: no model decided this.</p>
      </Slab>
    );
  }
  if (g.outcome === "needs_human_approval") {
    const so = step.signOff;
    const signed = so?.state === "approved";
    return (
      <div className="space-y-[clamp(0.6rem,1vw,1.2rem)]">
        <Slab title={signed ? "Signed. The gate opens." : "Stopped at the gate"} sub={gateSub(step)} open={signed}>
          <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className={`display tabular text-paper ${css.money}`}>{money(g.totalCents)}</span>
            <span className={`text-paper/80 ${css.body}`}>The agent may spend {money(g.limitCents)} alone.</span>
          </div>
        </Slab>
        {so && <SignOffCard so={so} />}
      </div>
    );
  }
  return (
    <div className={`bg-paper text-ink ${css.slabIn}`}>
      <div aria-hidden className="h-[4px] bg-petrol" />
      <div className="flex items-start gap-[clamp(0.8rem,1.2vw,1.6rem)] p-[clamp(0.9rem,1.4vw,1.8rem)]">
        <span aria-hidden className="flex size-[clamp(2.6rem,3.6vw,4.4rem)] shrink-0 items-center justify-center bg-petrol text-[clamp(1.4rem,2vw,2.4rem)] font-bold text-paper">
          ✓
        </span>
        <div className="min-w-0">
          <p className={`display ${css.title}`}>Passed: the agent may place it alone</p>
          <p className={`mt-1 text-ink-soft ${css.body}`}>
            All {g.checks.length} checks passed. {money(g.totalCents)} of the {money(g.limitCents)} it may spend alone.
          </p>
        </div>
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

/** The phone side of the gate: waiting with the time left, then the sign-off landing with the name. */
export function SignOffCard({ so }: { so: SignOffView }) {
  const now = useShowNow(so.state === "waiting");
  if (so.state === "approved" || so.state === "declined") {
    const delay = so.decidedAt && so.seenAt ? Math.max(0, (Date.parse(so.seenAt) - Date.parse(so.decidedAt)) / 1000) : undefined;
    return (
      <div className="flex items-center gap-[clamp(0.8rem,1.4vw,1.8rem)] bg-paper p-[clamp(0.9rem,1.4vw,1.8rem)] text-ink">
        <div className={`border-[5px] border-petrol px-[0.6em] py-[0.25em] ${css.land}`}>
          <p className={`display text-petrol ${css.gate}`}>{so.state === "approved" ? "Signed" : "Declined"}</p>
        </div>
        <div className="min-w-0">
          <p className={`display ${css.title}`}>{so.approverName}</p>
          <p className={`text-ink-soft ${css.body}`}>
            {so.roleLabel}, {so.method === "passkey" ? "with a passkey (Face ID or fingerprint)" : so.verified === false ? "with an unverified demo tap" : "on their phone"}, at {clockSeconds(so.decidedAt ?? so.seenAt ?? new Date())}.
          </p>
          {delay !== undefined && <p className={`text-ink-soft ${css.small}`}>On this screen {delay.toFixed(1).replace(".", ",")} s after the phone.</p>}
        </div>
      </div>
    );
  }
  if (so.state !== "waiting") {
    return (
      <div className="border-2 border-paper/40 p-[clamp(0.8rem,1.2vw,1.6rem)]">
        <p className={`text-paper ${css.lead}`}>{so.state === "rejected" ? "Approved, but the re-check at sign-off refused it." : `Nobody signed in time, so the agent withdrew the order.`}</p>
        <p className={`mt-1 text-paper/75 ${css.body}`}>Nothing was bought without a person.</p>
      </div>
    );
  }
  const total = Math.max(1, Date.parse(so.deadline) - Date.parse(so.askedAt));
  const left = Math.max(0, Date.parse(so.deadline) - now);
  const frac = left / total;
  return (
    <div className="flex items-center gap-[clamp(0.8rem,1.4vw,1.8rem)] border-2 border-safety p-[clamp(0.8rem,1.2vw,1.6rem)]">
      <PhoneGlyph frac={frac} seconds={Math.ceil(left / 1000)} />
      <div className="min-w-0">
        <p className={`display text-safety ${css.title}`}>
          <span className={css.breathe} aria-hidden>
            ●
          </span>{" "}
          Waiting for {so.approverName}
        </p>
        <p className={`text-paper ${css.body}`}>
          {so.phone ? "It is on their phone now: what, how much, and why they are asked. They approve with Face ID or a fingerprint." : "No phone has joined this kitchen, so nobody can sign it: the agent will withdraw it when the time runs out."}
        </p>
      </div>
    </div>
  );
}

/** A drawn phone (the one rounded shape: it depicts a phone) with a ring that empties as the time runs out. */
function PhoneGlyph({ frac, seconds }: { frac: number; seconds: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 80 120" className="h-[clamp(4.5rem,7vw,8.5rem)] w-auto shrink-0" aria-label={`${seconds} seconds left`} role="img">
      <rect x="4" y="4" width="72" height="112" rx="12" fill="none" stroke="var(--color-paper)" strokeWidth="4" />
      <rect x="30" y="10" width="20" height="4" rx="2" fill="var(--color-paper)" />
      <circle cx="40" cy="60" r={r} fill="none" stroke="rgb(255 255 255 / 0.2)" strokeWidth="6" />
      <circle cx="40" cy="60" r={r} fill="none" stroke="var(--color-safety)" strokeWidth="6" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 40 60)" className={css.ring} />
      <text x="40" y="68" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--color-paper)" style={{ fontVariantNumeric: "tabular-nums" }}>
        {seconds}
      </text>
    </svg>
  );
}
