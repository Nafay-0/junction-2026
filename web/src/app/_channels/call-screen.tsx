"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { IntakeView } from "@/core/intake";
import type { PublicOrder } from "@/core/orders";
import { Target } from "../_ui/target";
import { OrderCard, ReadBack, StepCards, type Act } from "./cards";
import { useCall, type Mode } from "./use-call";

/**
 * "Call your agent": a phone call with the kitchen's purchasing agent, by voice, through the same flow as typing.
 *
 *   <CallAgent kitchen="kaari" />                         a button; the call screen opens over the page
 *   <CallScreen kitchen="sbx_..." signOffHref={...} />   the call screen itself (the /call page uses this)
 *
 * Push-to-talk is the default (a loud hall, a phone's speaker next to its microphone); hands-free uses the voice
 * service's speech detection and goes half-duplex, so the agent never hears itself. Without a microphone, or when
 * the connection fails, the same call continues by typing.
 */

export type CallProps = {
  kitchen: string;
  /** The page a visitor opens to sign off an order on this same phone (their passkey). */
  signOffHref?: (order: PublicOrder) => string | undefined;
  /** What to show under "waiting for sign-off" instead, e.g. a QR code for the approver's phone. */
  renderSignOff?: (order: PublicOrder) => ReactNode;
  onStep?: (step: IntakeView) => void;
  onOrder?: (order: PublicOrder) => void;
  onClose?: () => void;
  defaultMode?: Mode;
};

function mmss(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function CallAgent(props: Omit<CallProps, "onClose"> & { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-12 items-center gap-2 bg-petrol px-5 py-2 text-[1.05rem] font-semibold text-paper hover:bg-petrol-deep">
        <PhoneIcon /> {props.label ?? "Call your agent"}
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 overflow-y-auto bg-mist" role="dialog" aria-modal="true" aria-label="Call with your agent">
            <CallScreen {...props} onClose={() => setOpen(false)} />
          </div>,
          document.body,
        )}
    </>
  );
}

export function CallScreen({ kitchen, signOffHref, renderSignOff, onStep, onOrder, onClose, defaultMode = "push_to_talk" }: CallProps) {
  const c = useCall(kitchen, { onStep, onOrder });
  const v = c.view;
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [draft, setDraft] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (v.phase !== "connected") return;
    started.current = Date.now();
    const t = window.setInterval(() => setElapsed(Math.round((Date.now() - started.current) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [v.phase]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [v.lines]);

  const live = v.phase === "connected";
  const typing = v.phase === "typed";
  const act: Act = (name, args, label) => void c.tap(name, args, label);
  const signOffLink = v.order && v.order.status === "pending_approval" && v.order.approval ? signOffHref?.(v.order) : undefined;
  const agentName = v.start?.kitchen.agentName ?? "your agent";

  const cards = (
    <div className="space-y-3">
      {v.pending && <ReadBack pending={v.pending} act={act} busy={v.busy} />}
      {v.order ? (
        <OrderCard
          order={v.order}
          signOff={
            signOffLink ? (
              <a href={signOffLink} className="flex min-h-16 items-center justify-center gap-3 bg-lime px-4 text-[1.25rem] font-bold text-ink">
                <Target size={28} tone="safety" />
                Sign off on this phone
              </a>
            ) : (
              renderSignOff?.(v.order)
            )
          }
        />
      ) : (
        v.step && <StepCards step={v.step} act={act} busy={v.busy} />
      )}
      {v.problem && v.problem.code !== "no_words" && (
        <p className="rounded-lg border-2 border-ink bg-paper p-3 text-[1rem]" role="status">
          {v.problem.message}
        </p>
      )}
    </div>
  );

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 pb-6 pt-4 text-ink">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[0.95rem] text-ink-soft">{v.start?.kitchen.name ?? "Your kitchen"}</p>
          <h1 className="display truncate text-[2rem] text-ink">{live || v.phase === "ringing" ? agentName : "Call your agent"}</h1>
        </div>
        {live && (
          <div className="text-right tabular" aria-live="off">
            <p className="text-[1.3rem] font-bold">{mmss(elapsed)}</p>
            <p className="text-xs text-ink-soft">{v.secondsLeft !== undefined ? `${mmss(v.secondsLeft)} left` : ""}</p>
          </div>
        )}
        {onClose && (v.phase === "idle" || v.phase === "ended" || v.phase === "lost") && (
          <button type="button" onClick={onClose} className="min-h-11 border-2 border-ink px-3 font-semibold">
            Close
          </button>
        )}
      </header>

      {v.phase === "idle" && (
        <div className="mt-8 flex flex-1 flex-col items-center gap-6">
          <p className="max-w-sm text-center text-[1.15rem]">Say what the kitchen needs. The agent reads unusual amounts back, tells you the options, and the order goes through the same checks and sign-off as typing.</p>
          <fieldset className="flex w-full max-w-sm border-2 border-petrol bg-paper p-1" aria-label="How to talk">
            {(["push_to_talk", "hands_free"] as const).map((m) => (
              <label key={m} className={`flex-1 cursor-pointer px-3 py-2 text-center font-semibold ${mode === m ? "bg-petrol text-paper" : "text-petrol"}`}>
                <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="sr-only" />
                {m === "push_to_talk" ? "Push to talk" : "Hands-free"}
              </label>
            ))}
          </fieldset>
          <p className="max-w-sm text-center text-sm text-ink-soft">{mode === "push_to_talk" ? "Hold the button while you speak, or tap once to start and once to stop. Best in a loud room." : "Just talk. The agent listens when it is not speaking. For a quiet room."}</p>
          <button type="button" onClick={() => void c.call(mode)} className="flex h-40 w-full max-w-sm flex-col items-center justify-center gap-2 bg-lime text-ink active:translate-y-px" aria-label="Call">
            <PhoneIcon size={56} />
            <span className="display text-[2rem]">Call</span>
          </button>
        </div>
      )}

      {v.phase === "ringing" && (
        <div className="mt-16 flex flex-1 flex-col items-center gap-8">
          <div className="breathe flex h-40 w-full max-w-sm items-center justify-center bg-petrol-deep text-paper">
            <PhoneIcon size={52} />
          </div>
          <p className="text-[1.3rem] font-semibold">Calling…</p>
          <HangUp onClick={() => c.hangUp("cancelled")} />
        </div>
      )}

      {(live || typing || v.phase === "lost" || v.phase === "ended") && (
        <div className="mt-3 grid flex-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col">
            <div ref={scroller} className="max-h-[46dvh] min-h-40 flex-1 space-y-2 overflow-y-auto bg-paper p-2.5 md:max-h-[60dvh]" aria-live="polite" aria-label="Live transcript">
              {v.lines.length === 0 && <p className="text-[1.1rem] text-ink-soft">{live ? "Connected. The agent is saying hello…" : "Type what the kitchen needs."}</p>}
              {v.lines.map((l) => (
                <div key={l.id} className={`px-3 py-2 ${l.who === "you" ? "ml-6 bg-mist" : l.who === "agent" ? "mr-6 bg-lavender" : "bg-paper outline-1 outline-line"} ${l.final ? "" : "opacity-75"}`}>
                  <p className={`text-[0.85rem] font-semibold ${l.who === "agent" ? "text-lavender-deep" : "text-ink-soft"}`}>{l.who === "you" ? "You" : l.who === "agent" ? agentName : "AimoPilot"}</p>
                  <p className={`text-[1.35rem] leading-snug ${l.who === "you" ? "font-semibold" : ""}`}>
                    {l.dropped?.length ? (
                      <>
                        <span className="line-through decoration-2">{l.text}</span>
                        <span className="mt-1 block bg-safety px-2 py-1 text-[0.95rem] font-semibold text-safety-ink">Cut off: {l.dropped.join(", ")} did not come from AimoPilot.</span>
                      </>
                    ) : (
                      l.text
                    )}
                  </p>
                </div>
              ))}
            </div>
            {v.notice && <p className="mt-2 text-[1rem] text-ink-soft">{v.notice}</p>}
          </div>
          <div>{cards}</div>
        </div>
      )}

      {live && (
        <div className="sticky bottom-0 mt-4 flex items-stretch gap-3 bg-mist pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
          {v.mode === "push_to_talk" ? (
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                c.pressTalk();
              }}
              onPointerUp={() => c.releaseTalk()}
              onPointerCancel={() => c.releaseTalk()}
              onContextMenu={(e) => e.preventDefault()}
              onKeyDown={(e) => {
                if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                  e.preventDefault();
                  c.pressTalk();
                }
              }}
              onKeyUp={(e) => {
                if (e.key === " " || e.key === "Enter") c.releaseTalk();
              }}
              aria-pressed={v.talking}
              className={`flex h-32 min-w-0 flex-1 touch-none select-none flex-col items-center justify-center text-center font-bold [-webkit-touch-callout:none] ${v.talking ? "bg-lime text-ink outline-[4px] outline-offset-2 outline-petrol" : "bg-petrol text-paper"}`}
            >
              <MicIcon />
              <span className="display mt-1 text-[1.6rem]">{v.talking ? (v.latched ? "Tap to stop" : "Listening") : v.agentSpeaking ? "Hold to interrupt" : "Hold to talk"}</span>
            </button>
          ) : (
            <div className={`flex h-32 min-w-0 flex-1 flex-col items-center justify-center font-bold ${v.agentSpeaking ? "bg-lavender text-lavender-deep" : "bg-lime text-ink"}`} aria-live="polite">
              <MicIcon />
              <span className="display mt-1 text-[1.6rem]">{v.agentSpeaking ? "Agent speaking" : v.busy ? "Checking…" : "Listening"}</span>
            </div>
          )}
          <HangUp onClick={() => c.hangUp()} />
        </div>
      )}

      {typing && (
        <form
          className="sticky bottom-0 mt-4 flex gap-2 bg-mist pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            const t = draft.trim();
            if (!t) return;
            setDraft("");
            void c.typed("submit_request", { request: t }, t);
          }}
        >
          <label className="sr-only" htmlFor="call-typed">
            What the kitchen needs
          </label>
          <input id="call-typed" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. 100 litres of milk by Thursday" className="min-h-12 min-w-0 flex-1 border-2 border-ink bg-paper px-3 text-[1.1rem]" enterKeyHint="send" />
          <button type="submit" disabled={v.busy} className="min-h-12 bg-lime px-4 font-semibold text-ink disabled:opacity-50">
            Send
          </button>
        </form>
      )}

      {(v.phase === "lost" || v.phase === "ended") && (
        <div className="mt-4 space-y-3 text-center">
          <p className="text-[1.15rem] font-semibold">{v.phase === "lost" ? "The call dropped." : "Call ended."} {v.endReason && v.endReason !== "hung up" ? v.endReason : ""}</p>
          {v.micProblem && <p className="text-[1rem]">Microphone: {v.micProblem === "denied" ? "blocked. Allow it in the browser's site settings to call." : v.micProblem.replace("_", " ")}.</p>}
          <p className="text-sm text-ink-soft tabular">
            {v.grounding.checked > 0 ? `${v.grounding.checked} agent turn${v.grounding.checked > 1 ? "s" : ""} checked against AimoPilot, ${v.grounding.dropped} cut off. ` : ""}About ${v.costUsd.toFixed(3)} of voice.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button type="button" onClick={() => void c.call(mode, c.callId() ?? undefined)} className="min-h-12 bg-lime text-ink px-6 font-semibold text-paper">
              {v.phase === "lost" ? "Call back" : "Call again"}
            </button>
            <button type="button" onClick={() => void c.typeInstead()} className="min-h-12 border-2 border-ink bg-paper px-6 font-semibold">
              Type instead
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function HangUp({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-20 w-24 shrink-0 flex-col items-center justify-center gap-1 bg-ink text-paper" aria-label="Hang up">
      <PhoneIcon size={30} className="rotate-[135deg]" />
      <span className="text-[0.9rem] font-semibold">End call</span>
    </button>
  );
}

function PhoneIcon({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width={36} height={36} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11z" />
    </svg>
  );
}
