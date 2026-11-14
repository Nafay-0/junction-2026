"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../_client/api";
import { DEMO_NOTE, PRODUCT_NAME } from "../_ui/brand";
import { PilotLight } from "../_ui/wordmark";
import type { KitchenRef, Spend, WeekRun } from "@/server/show/types";
import { css } from "./css";
import { useLiveWeek } from "./use-week";
import { WeekBoard } from "./week-board";

/**
 * Table mode: the visitor is the protagonist. The wall shows the QR code; when someone joins, it greets their
 * kitchen and plays their week, with the sign-off on their own phone. Several visitors at once each get their own
 * kitchen and their own week, side by side. When a week has been up for a while after it ended, the wall goes back
 * to the QR code. The day's spend and caps sit in the corner for the presenter.
 */
type KitchenRow = KitchenRef & { createdAt: string; week?: WeekRun };
type Slot = { sandboxId: string; runId?: string; greetedAt: number; endedAt?: number; error?: string; kitchen: KitchenRow };

const GREET_MS = 2600;
const HOLD_MS = 25_000;
const MAX_SLOTS = 3;

export function Table({ joinUrl, qrSvg }: { joinUrl: string; qrSvg: string }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [spend, setSpend] = useState<Spend>();
  const [problem, setProblem] = useState<string>();
  const [clock, setClock] = useState(() => Date.now());
  const seen = useRef<Set<string> | null>(null);
  const openedAt = useRef<number>(0);

  const start = useCallback(async (k: KitchenRow) => {
    const r = await api<{ run: WeekRun }>("POST", "/ui-api/show/week", { sandboxId: k.sandboxId });
    setSlots((xs) => xs.map((s) => (s.sandboxId === k.sandboxId ? (r.ok ? { ...s, runId: r.data.run.runId } : { ...s, error: r.error.message, endedAt: Date.now() }) : s)));
  }, []);

  const poll = useCallback(async () => {
    const r = await api<{ kitchens: KitchenRow[] }>("GET", "/ui-api/show/kitchens");
    if (!r.ok) return setProblem(r.status === 401 ? "Signed out of the operations desk: reload and enter the passcode." : `The server did not answer (${r.error.message}); trying again.`);
    setProblem(undefined);
    const fresh = r.data.kitchens.filter((k) => k.passkey && !k.house);
    if (!seen.current) {
      // Kitchens made just before the wall opened still get their week; older ones do not.
      openedAt.current = Date.now();
      seen.current = new Set(fresh.filter((k) => Date.parse(k.createdAt) < openedAt.current - 60_000).map((k) => k.sandboxId));
    }
    for (const k of fresh) {
      if (seen.current.has(k.sandboxId)) continue;
      seen.current.add(k.sandboxId);
      setSlots((xs) => [...xs, { sandboxId: k.sandboxId, greetedAt: Date.now(), kitchen: k }]);
      setTimeout(() => void start(k), GREET_MS);
    }
  }, [start]);

  useEffect(() => {
    const first = setTimeout(() => void poll(), 0);
    const t = setInterval(() => void poll(), 2000);
    return () => (clearTimeout(first), clearInterval(t));
  }, [poll]);

  useEffect(() => {
    const load = async () => {
      const r = await api<{ spend: Spend }>("GET", "/ui-api/show/spend");
      if (r.ok) setSpend(r.data.spend);
    };
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 15_000);
    return () => (clearTimeout(first), clearInterval(t));
  }, []);

  // The wall clock that lets an ended week go, so the wall returns to the QR code.
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ended = useCallback((sandboxId: string) => setSlots((xs) => xs.map((s) => (s.sandboxId === sandboxId && !s.endedAt ? { ...s, endedAt: Date.now() } : s))), []);

  const shown = slots.filter((s) => !s.endedAt || clock - s.endedAt < HOLD_MS).slice(-MAX_SLOTS);
  return (
    <div className={`${css.stage} on-dark relative flex h-dvh flex-col overflow-hidden`}>
      {shown.length === 0 ? (
        <Attract joinUrl={joinUrl} qrSvg={qrSvg} />
      ) : (
        <div className={`grid min-h-0 flex-1 gap-px bg-paper/10 ${shown.length === 1 ? "grid-cols-1" : shown.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
          {shown.map((s) => (
            <SlotView key={s.sandboxId} slot={s} compact={shown.length > 1} onEnded={ended} aside={s === shown.at(-1) ? <NextVisitor qrSvg={qrSvg} /> : undefined} />
          ))}
        </div>
      )}
      <p className={`pointer-events-none absolute bottom-1 right-2 text-paper/45 ${css.small} ${shown.length && !problem ? "hidden" : ""}`}>
        {problem ??
          (spend
            ? `Today: ${spend.weeks.used} of ${spend.weeks.cap} weeks; ${spend.partnerCalls.byShow} partner calls${spend.callsPerWeek !== null ? ` (${spend.callsPerWeek} a visitor)` : ""}; model $${spend.modelUsd.used.toFixed(2)} of $${spend.modelUsd.cap.toFixed(2)}`
            : "")}
      </p>
    </div>
  );
}

/** The QR code is an SVG the server drew from the join address (qrcode), never user input. */
function Qr({ svg, className }: { svg: string; className: string }) {
  return <span className={`block ${className} ${css.qr}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** The join code stays on the wall while a week plays, so the next visitor can scan. */
function NextVisitor({ qrSvg }: { qrSvg: string }) {
  return (
    <aside className="flex shrink-0 items-center gap-[0.7em] rounded-[clamp(12px,1vw,20px)] bg-paper p-[0.5em] pr-[0.9em] text-ink">
      <Qr svg={qrSvg} className="w-[clamp(4rem,5.5vw,6.5rem)]" />
      <span className={`max-w-[10ch] font-semibold ${css.small}`}>Next visitor: scan</span>
    </aside>
  );
}

function SlotView({ slot, compact, onEnded, aside }: { slot: Slot; compact: boolean; onEnded: (id: string) => void; aside?: React.ReactNode }) {
  const { run } = useLiveWeek(slot.runId);
  const over = run && (run.state === "finished" || run.state === "cancelled" || run.state === "failed");
  useEffect(() => {
    if (over) onEnded(slot.sandboxId);
  }, [over, onEnded, slot.sandboxId]);
  const first = slot.kitchen.approverName.split(" ")[0];
  if (!run) {
    return (
      <section className={`flex h-full flex-col justify-center px-[5vw] ${css.bayIn}`}>
        <p className={`display ${css.day}`}>Welcome, {first}.</p>
        <p className={`mt-4 max-w-[40ch] text-paper/90 ${css.lead}`}>
          {slot.error ?? `You are the purchasing manager of ${slot.kitchen.name}, ${slot.kitchen.city}. Its agent is about to work through a week. When it needs you, it will be on your phone.`}
        </p>
      </section>
    );
  }
  return <WeekBoard run={run} compact={compact} greeting={`${first}'s week:`} aside={aside} />;
}

function Attract({ joinUrl, qrSvg }: { joinUrl: string; qrSvg: string }) {
  return (
    <div className="grid min-h-0 flex-1 items-center gap-[4vw] px-[5vw] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div>
        <div className="flex items-center gap-[0.9vw]">
          <PilotLight size="clamp(2.2rem,3.4vw,4.4rem)" onDark />
          <span className="display text-[clamp(2.4rem,4vw,5rem)] leading-none" style={{ fontWeight: 700, letterSpacing: "-0.03em" }}>
            {PRODUCT_NAME}
          </span>
        </div>
        <h1 className={`display mt-[2vw] max-w-[15ch] leading-[0.92] ${css.day}`}>Scan, and a hotel kitchen is yours.</h1>
        <p className={`mt-[1.6vw] max-w-[44ch] text-paper/90 ${css.lead}`}>Its AI agent orders a week of food from the wholesaler. It may spend 500 € alone. Anything more lands on your phone, and only your face or finger can sign it.</p>
        <p className={`mt-[1vw] max-w-[50ch] text-paper/70 ${css.body}`}>No name, no email: a passkey on your phone. The kitchen closes by itself after 90 minutes.</p>
        <p className={`mt-[2vw] text-paper/55 ${css.small}`}>{DEMO_NOTE}</p>
      </div>
      <figure className="justify-self-center rounded-[clamp(20px,2vw,40px)] bg-paper p-[1.6vw] text-ink shadow-[0_40px_100px_-40px_rgb(0_0_0/0.7)]">
        <Qr svg={qrSvg} className="w-[min(34vw,56vh)]" />
        <figcaption className={`mt-[0.6em] flex items-center justify-center gap-[0.5em] font-semibold ${css.body}`}>
          <span aria-hidden className="size-[0.55em] rounded-full bg-lime ring-2 ring-lime/30" />
          {joinUrl.replace(/^https?:\/\//, "")}
        </figcaption>
      </figure>
    </div>
  );
}
