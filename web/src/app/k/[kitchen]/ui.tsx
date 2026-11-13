"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Target } from "../../_ui/target";
import { AgentNote, Button as KitButton, Plate, Spinner, type ButtonKind, type ButtonSize } from "../../_ui/kit";

export { ErrorPlate, Field, Missing } from "../../_ui/kit";

/** Where a stage is: done, working on it, waiting for the buyer (active), or the gate stopped it (safety). */
export type StageTone = "done" | "active" | "busy" | "safety";

type ButtonProps = { children: ReactNode; onClick?: () => void; busy?: boolean; disabled?: boolean; pressed?: boolean; kind?: ButtonKind; size?: ButtonSize; type?: "button" | "submit"; className?: string; title?: string };

export function Button(props: ButtonProps) {
  return <KitButton {...props} />;
}

/** A document: white paper with a petrol top rule. Gate documents carry the hazard band instead. */
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
  return (
    <nav aria-label="Where the request is" className="bg-paper">
      <ol className="grid grid-cols-7">
        {STATIONS.map((s, i) => {
          const st = states[s];
          const look =
            st === "current"
              ? "bg-petrol-deep text-paper"
              : st === "stopped"
                ? "bg-safety-ink text-safety"
                : st === "done"
                  ? "bg-petrol-soft text-petrol-deep"
                  : st === "skipped"
                    ? "bg-paper text-ink-soft/70"
                    : "bg-paper text-ink-soft";
          return (
            <li key={s} aria-current={st === "current" || st === "stopped" ? "step" : undefined} className={`relative flex min-h-[3.75rem] flex-col justify-center border-r border-paper px-1.5 py-2 last:border-r-0 sm:px-3 ${look}`}>
              {st === "stopped" && <span aria-hidden className="hazard-thin absolute inset-x-0 top-0 h-1.5" />}
              <span className="flex items-center gap-1.5">
                {st === "stopped" ? (
                  <Target size={18} tone="safety" className="hidden shrink-0 sm:block" />
                ) : (
                  <span aria-hidden className={`hidden size-5 shrink-0 items-center justify-center text-[0.75rem] font-bold tabular sm:flex ${st === "current" ? "bg-lime text-ink" : st === "done" ? "bg-petrol text-paper" : "text-current"}`}>
                    {st === "done" ? "✓" : i + 1}
                  </span>
                )}
                <span className={`display truncate text-[0.95rem] sm:text-[1.25rem] ${st === "skipped" ? "line-through decoration-1" : ""}`}>{s}</span>
              </span>
              <span className="sr-only">
                {", step "}
                {i + 1}
                {": "}
                {st === "current" ? "here now" : st === "stopped" ? "stopped, a person must decide" : st === "done" ? "done" : st === "skipped" ? "not needed" : "not reached yet"}
              </span>
            </li>
          );
        })}
      </ol>
      {label && <p className="sr-only" aria-live="polite">{label}</p>}
    </nav>
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
  const id = `st-${st.key}`;
  const bodyId = `${id}-body`;
  const node =
    st.tone === "safety" ? (
      <span className="flex size-10 items-center justify-center bg-safety-ink">
        <Target size={30} tone="safety" />
      </span>
    ) : st.tone === "busy" ? (
      <span className="flex size-10 items-center justify-center bg-petrol-deep text-paper">
        <Spinner size={18} />
      </span>
    ) : current || st.tone === "active" ? (
      <span className="display flex size-10 items-center justify-center bg-petrol-deep text-[1.35rem] text-paper tabular">{n}</span>
    ) : (
      <span className="display flex size-10 items-center justify-center border-2 border-petrol bg-paper text-[1.2rem] text-petrol tabular">{n}</span>
    );
  return (
    <li id={id} className="lane-enter relative grid scroll-mt-28 grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 pb-5 sm:grid-cols-[3rem_minmax(0,1fr)] sm:gap-x-5">
      <div className="relative flex justify-center">
        {!last && <span aria-hidden className={`absolute bottom-0 top-10 w-[3px] ${st.tone === "safety" ? "hazard-thin" : "bg-petrol/30"}`} />}
        <span className="relative">{node}</span>
      </div>
      <section aria-labelledby={`${id}-h`} className="min-w-0">
        <header className={`flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 ${open ? "mb-3" : ""}`}>
          <h2 id={`${id}-h`} className="display text-[1.55rem] text-ink sm:text-[1.75rem]">
            <span className="sr-only">Step {n}: </span>
            {st.title}
          </h2>
          {!open && st.summary && <p className="min-w-0 flex-1 truncate text-[1rem] text-ink-soft">{st.summary}</p>}
          <span className="ml-auto flex items-center gap-4">
            {st.aside}
            <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={onToggle} className="min-h-10 text-[0.95rem] font-semibold text-petrol underline decoration-2 underline-offset-4 hover:text-petrol-deep">
              {open ? "Fold" : "Open"}
              <span className="sr-only"> {st.title}</span>
            </button>
          </span>
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
