"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Target } from "../../_ui/target";
import { AgentNote, Button as KitButton, Plate, Spinner, type ButtonKind, type ButtonSize } from "../../_ui/kit";
import { useText } from "../../_i18n/provider";
import { UI_TEXT } from "./ui.text";

export { ErrorPlate, Field, Missing } from "../../_ui/kit";

/** Where a stage is: done, working on it, waiting for the buyer (active), or the gate stopped it (safety). */
export type StageTone = "done" | "active" | "busy" | "safety";

type ButtonProps = { children: ReactNode; onClick?: () => void; busy?: boolean; disabled?: boolean; pressed?: boolean; kind?: ButtonKind; size?: ButtonSize; type?: "button" | "submit"; className?: string; title?: string };

export function Button(props: ButtonProps) {
  return <KitButton {...props} />;
}

/** A document: a card. Gate documents carry the hazard band along their top edge. */
export function Paper({ children, className = "", safety = false, agent = false }: { children: ReactNode; className?: string; safety?: boolean; agent?: boolean }) {
  return (
    <Plate className={className} tone={safety ? "gate" : agent ? "agent" : "paper"}>
      {children}
    </Plate>
  );
}

/** A note that a value came from the kitchen's memory, not from a question. */
export function MemoryNote({ children }: { children: ReactNode }) {
  return <AgentNote>{children}</AgentNote>;
}

// ---------- the order lane ----------

/** The stations a request travels through, in order. Every stage of the order page belongs to one. */
export const STATIONS = ["Request", "Lookup", "Options", "Price", "Gate", "Sign-off", "Order"] as const;
export type Station = (typeof STATIONS)[number];

export type LaneStage = {
  key: string;
  station: Station;
  title: string;
  tone: StageTone;
  /** One line that stands for the stage when it is collapsed. */
  summary?: ReactNode;
  aside?: ReactNode;
  body: ReactNode;
  /** Keep this stage open even when it is not the current one (a sign-off just arrived, say). */
  keepOpen?: boolean;
  /** Not part of the request's journey (the ledger): never counted as the current station. */
  extra?: boolean;
};

export type StationState = "done" | "current" | "stopped" | "pending" | "skipped";

/**
 * The strip across the top of the order page: seven stations, readable from across a table. The current one is
 * filled; when the gate stops the request, the gate and sign-off stations carry the hazard and the mark.
 */
export function StationStrip({ states, label }: { states: Record<Station, StationState>; label?: string }) {
  const tx = useText(UI_TEXT);
  return (
    <nav aria-label={tx.whereLabel} className="rounded-xl border border-line bg-paper px-4 py-3 sm:px-5 sm:py-4">
      <CompactStrip states={states} />
      <ol className="hidden items-center sm:flex">
        {STATIONS.map((s, i) => {
          const st = states[s];
          const word = tx.stations[s];
          const here = st === "current" || st === "stopped";
          return (
            <li key={s} aria-current={here ? "step" : undefined} className="flex min-w-0 flex-1 items-center last:flex-none">
              <span className={`flex min-w-0 items-center gap-2 rounded-full py-1 pl-1 pr-3 ${st === "stopped" ? "bg-safety-ink text-safety" : st === "current" ? "bg-petrol-soft" : ""}`}>
                {st === "stopped" ? (
                  <span className="flex size-7 shrink-0 items-center justify-center">
                    <Target size={20} tone="safety" />
                  </span>
                ) : (
                  <span
                    aria-hidden
                    className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[0.8rem] font-semibold tabular ${
                      st === "current" ? "bg-petrol text-paper" : st === "done" ? "bg-petrol-soft text-petrol" : "border border-line-strong text-ink-soft"
                    }`}
                  >
                    {st === "done" ? <Check size={15} strokeWidth={2.6} /> : i + 1}
                  </span>
                )}
                <span title={word.length > 9 ? word : undefined} className={`truncate text-[0.9rem] ${here ? "font-semibold" : st === "skipped" ? "text-ink-faint line-through decoration-1" : st === "done" ? "text-ink" : "text-ink-soft"} ${st === "current" ? "text-petrol-deep" : ""}`}>
                  {word}
                </span>
              </span>
              {i < STATIONS.length - 1 && <span aria-hidden className={`mx-1.5 h-px min-w-2 flex-1 ${st === "done" ? "bg-petrol/40" : "bg-line"}`} />}
              <span className="sr-only">{tx.srStep(i + 1, st)}</span>
            </li>
          );
        })}
      </ol>
      {label && <p className="sr-only" aria-live="polite">{label}</p>}
    </nav>
  );
}

/** On a phone: seven segments and the station the request is at, in words. */
function CompactStrip({ states }: { states: Record<Station, StationState> }) {
  const tx = useText(UI_TEXT);
  const i = STATIONS.findIndex((s) => states[s] === "current" || states[s] === "stopped");
  const here = i >= 0 ? STATIONS[i] : undefined;
  const stopped = here ? states[here] === "stopped" : false;
  return (
    <div className="sm:hidden" aria-hidden>
      <div className="flex gap-1">
        {STATIONS.map((s) => (
          <span key={s} className={`h-1.5 flex-1 rounded-full ${states[s] === "stopped" ? "bg-safety" : states[s] === "current" ? "bg-petrol" : states[s] === "done" ? "bg-petrol/45" : "bg-line"}`} />
        ))}
      </div>
      <p className="mt-2.5 flex flex-wrap items-center gap-x-2">
        {stopped && <Target size={18} tone="safety" />}
        <span className="display text-[1.2rem]">{here ? tx.stations[here] : tx.stations.Request}</span>
        <span className="text-[0.875rem] text-ink-soft">{here ? tx.compactStep(i + 1, stopped) : tx.nothingYet}</span>
      </p>
    </div>
  );
}

/**
 * The lane: the request's stages in order. The current stage is open; earlier ones collapse to one line each and
 * can be reopened. A new stage slides in from the lane's side; nothing above it moves.
 */
export function Lane({ stages, runKey }: { stages: LaneStage[]; runKey: string | number }) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [forRun, setForRun] = useState(runKey);
  if (forRun !== runKey) {
    setForRun(runKey);
    setToggled({});
  }
  const journey = stages.filter((s) => !s.extra);
  const lastKey = journey.at(-1)?.key;
  return (
    <ol className="relative">
      {stages.map((st, i) => {
        const auto = st.key === lastKey || st.keepOpen || st.tone === "active" || st.tone === "safety" || st.tone === "busy";
        const open = toggled[st.key] ?? auto;
        const last = i === stages.length - 1;
        return (
          <LaneRow
            key={`${runKey}-${st.key}`}
            n={i + 1}
            st={st}
            open={open}
            last={last}
            current={st.key === lastKey}
            onToggle={() => setToggled((t) => ({ ...t, [st.key]: !open }))}
          />
        );
      })}
    </ol>
  );
}

function LaneRow({ n, st, open, last, current, onToggle }: { n: number; st: LaneStage; open: boolean; last: boolean; current: boolean; onToggle: () => void }) {
  const tx = useText(UI_TEXT);
  const id = `st-${st.key}`;
  const bodyId = `${id}-body`;
  const dot = "flex size-9 items-center justify-center rounded-full text-[0.95rem] font-semibold tabular";
  const node =
    st.tone === "safety" ? (
      <span className={`${dot} bg-safety-ink`}>
        <Target size={22} tone="safety" />
      </span>
    ) : st.tone === "busy" ? (
      <span className={`${dot} bg-petrol-soft text-petrol`}>
        <Spinner size={16} />
      </span>
    ) : current || st.tone === "active" ? (
      <span className={`${dot} bg-petrol text-paper shadow-sm`}>{n}</span>
    ) : (
      <span className={`${dot} border border-line-strong bg-paper text-ink-soft`}>{n}</span>
    );
  return (
    <li id={id} className="lane-enter relative grid scroll-mt-28 grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 pb-6 sm:grid-cols-[2.25rem_minmax(0,1fr)] sm:gap-x-5">
      <div className="relative flex justify-center">
        {!last && <span aria-hidden className={`absolute bottom-0 top-10 w-0.5 rounded-full ${st.tone === "safety" ? "hazard-thin w-[3px]" : "bg-line"}`} />}
        <span className="relative">{node}</span>
      </div>
      <section aria-labelledby={`${id}-h`} className="min-w-0">
        <header className={`flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 ${open ? "mb-3" : ""}`}>
          <h2 id={`${id}-h`} className="display text-[1.3rem] text-ink sm:text-[1.45rem]">
            <span className="sr-only">{tx.srLaneStep(n)}</span>
            {st.title}
          </h2>
          <span className="ml-auto flex items-center gap-3 sm:order-last">
            {st.aside}
            <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={onToggle} className="inline-flex min-h-9 items-center gap-1 rounded-full px-2.5 text-[0.875rem] font-medium text-petrol transition-colors hover:bg-petrol-soft pointer-coarse:min-h-11">
              {open ? tx.fold : tx.open}
              <ChevronDown aria-hidden size={16} className={`transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
              <span className="sr-only"> {st.title}</span>
            </button>
          </span>
          {!open && st.summary && <p className="basis-full truncate text-[0.95rem] text-ink-soft sm:min-w-0 sm:flex-1 sm:basis-auto">{st.summary}</p>}
        </header>
        <div id={bodyId} hidden={!open}>
          {st.body}
        </div>
      </section>
    </li>
  );
}

/** Scroll a stage into view when it arrives, unless it is already on screen. */
export function useFollowLane(count: number, lastKey: string | undefined) {
  const prev = useRef(0);
  useEffect(() => {
    if (count > prev.current && count > 1 && lastKey) {
      const el = document.getElementById(`st-${lastKey}`);
      if (el && el.getBoundingClientRect().top > window.innerHeight - 160) {
        el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      }
    }
    prev.current = count;
  }, [count, lastKey]);
}
