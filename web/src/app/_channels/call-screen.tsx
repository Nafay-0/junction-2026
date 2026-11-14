"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Mic, Phone, PhoneOff } from "lucide-react";
import type { IntakeView } from "@/core/intake";
import type { PublicOrder } from "@/core/orders";
import { LangSwitch, useLang, useText } from "../_i18n/provider";
import { Button, Tabs } from "../_ui/kit";
import { Target } from "../_ui/target";
import { AgentTurn, BuyerTurn, Composer, Thread, VoiceStatus, type VoiceState } from "../_ui/thread";
import { CALL_TEXT } from "./call-screen.text";
import { OrderCard, ReadBack, StepCards, type Act } from "./cards";
import { useCall, type Mode, type Status } from "./use-call";
import { agentNameL } from "../_i18n/kitchen-words";

/**
 * "Call your agent": a phone call with the kitchen's purchasing agent, by voice, through the same flow as typing.
 *
 *   <CallAgent kitchen="kaari" />                         a button; the call screen opens over the page
 *   <CallScreen kitchen="sbx_..." signOffHref={...} />   the call screen itself (the /call page uses this)
 *
 * Built from the design kit (`_ui/thread.tsx`): the call's state is the kit's VoiceStatus at the centre, what was
 * said and answered is the thread (the caller's turns, the agent's one line, AimoPilot's cards), and typing uses
 * the kit's Composer. Push-to-talk is the default (a loud hall, a phone's speaker next to its microphone): one large
 * button to hold, or tap once to start and once to stop. Hands-free uses the voice service's speech detection and
 * goes half-duplex, so the agent never hears itself. Without a microphone, or when the connection fails, the same
 * call continues by typing.
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
  /** Show the language switch in the header: on the /call page, which has no store header around it. */
  langSwitch?: boolean;
};

function mmss(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

const VOICE: Record<Status, VoiceState> = { listening: "listening", thinking: "thinking", speaking: "speaking", waiting: "waiting", ready: "idle", paused: "idle" };

export function CallAgent(props: Omit<CallProps, "onClose"> & { label?: string }) {
  const tx = useText(CALL_TEXT);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button kind="primary" onClick={() => setOpen(true)}>
        <Phone aria-hidden size={18} /> {props.label ?? tx.callYourAgent}
      </Button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 overflow-y-auto bg-mist" role="dialog" aria-modal="true" aria-label={tx.dialog}>
            <CallScreen {...props} onClose={() => setOpen(false)} />
          </div>,
          document.body,
        )}
    </>
  );
}

export function CallScreen({ kitchen, signOffHref, renderSignOff, onStep, onOrder, onClose, defaultMode = "push_to_talk", langSwitch = false }: CallProps) {
  const tx = useText(CALL_TEXT);
  const { lang } = useLang();
  const c = useCall(kitchen, { onStep, onOrder });
  const v = c.view;
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [draft, setDraft] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [ios, setIos] = useState(false);
  const started = useRef(0);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (v.phase !== "connected") return;
    started.current = Date.now();
    const t = window.setInterval(() => setElapsed(Math.round((Date.now() - started.current) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [v.phase]);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [v.lines, v.pending, v.step, v.order]);
  useEffect(() => setIos(/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)), []);

  const live = v.phase === "connected";
  const recovering = v.phase === "recovering";
  const typing = v.phase === "typed";
  const over = v.phase === "lost" || v.phase === "ended";
  const approver = v.order?.status === "pending_approval" ? v.order.approval?.approver?.name : undefined;
  const statusText = recovering ? tx.status.recovering : c.status === "waiting" && approver ? tx.waitingFor(approver) : tx.status[c.status];
  const act: Act = (name, args, label) => void c.tap(name, args, label);
  const signOffLink = v.order && v.order.status === "pending_approval" && v.order.approval ? signOffHref?.(v.order) : undefined;
  const agentName = v.start?.kitchen.agentName ? agentNameL(v.start.kitchen.agentName, lang) : tx.yourAgent;

  const cards = (
    <>
      {v.pending && <ReadBack pending={v.pending} act={act} busy={v.busy} />}
      {v.order ? (
        <OrderCard
          order={v.order}
          signOff={
            signOffLink ? (
              <a href={signOffLink} className="flex min-h-14 items-center justify-center gap-3 rounded-full bg-lime px-5 text-[1.1rem] font-bold text-ink">
                <Target size={24} tone="safety" />
                {tx.signOffHere}
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
        <p className="rounded-xl border border-line bg-paper p-3 text-[1rem]" role="status">
          {v.problem.message}
        </p>
      )}
    </>
  );

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pb-4 pt-4 text-ink">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[0.9rem] text-ink-soft">{v.start?.kitchen.name ?? tx.yourKitchen}</p>
          <h1 className="display text-[1.7rem] leading-[1.05] [overflow-wrap:break-word]">{live || recovering || v.phase === "ringing" ? agentName : tx.callYourAgent}</h1>
        </div>
        {live && (
          <div className="text-right tabular" aria-live="off">
            <p className="text-[1.2rem] font-bold">{mmss(elapsed)}</p>
            <p className="text-xs text-ink-soft">{v.secondsLeft !== undefined ? tx.left(mmss(v.secondsLeft)) : ""}</p>
          </div>
        )}
        {langSwitch && !live && !recovering && <LangSwitch />}
        {onClose && (v.phase === "idle" || over) && <Button onClick={onClose}>{tx.close}</Button>}
      </header>

      {v.phase === "idle" && (
        <div className="mt-8 flex flex-1 flex-col items-center gap-5">
          <p className="max-w-sm text-center text-[1.1rem]">{tx.intro}</p>
          <Tabs label={tx.howToTalk} value={mode} onChange={setMode} options={[{ id: "push_to_talk", label: tx.pushToTalk }, { id: "hands_free", label: tx.handsFree }]} />
          <p className="max-w-sm text-center text-sm text-ink-soft">{mode === "push_to_talk" ? tx.pushHint : tx.freeHint}</p>
          <button type="button" onClick={() => void c.call(mode)} className="flex size-44 flex-col items-center justify-center gap-2 rounded-full bg-lime text-ink shadow-md transition-transform active:scale-95" aria-label={tx.call}>
            <Phone aria-hidden size={52} />
            <span className="display text-[1.8rem]">{tx.call}</span>
          </button>
          <p className="max-w-sm text-center text-sm text-ink-soft">{tx.languages}</p>
        </div>
      )}

      {v.phase === "ringing" && (
        <div className="mt-14 flex flex-1 flex-col items-center gap-8">
          <VoiceStatus state="thinking" size="lg" label={tx.calling} />
          <HangUp onClick={() => c.hangUp("cancelled")} />
        </div>
      )}

      {(live || recovering) && (
        <div className="mt-4 flex justify-center" data-status={recovering ? "recovering" : c.status} onClick={c.status === "paused" ? c.resume : undefined}>
          <VoiceStatus state={recovering ? "reconnecting" : VOICE[c.status]} size={v.lines.length || v.pending || v.step ? "sm" : "lg"} label={statusText} />
        </div>
      )}
      {live && ios && <p className="mt-1 text-center text-[0.8rem] text-ink-soft">{tx.silentHint}</p>}

      {(live || recovering || typing || over) && (
        <div className="mt-3 flex-1">
          <Thread label={tx.transcript}>
            {v.lines.length === 0 && <p className="text-[1.05rem] text-ink-soft">{live ? tx.connected : tx.typeNeed}</p>}
            {v.lines.map((l) =>
              l.who === "you" ? (
                <BuyerTurn key={l.id} via={typing ? "typed" : "voice"}>
                  <span className={l.final ? "" : "opacity-75"}>{l.text}</span>
                </BuyerTurn>
              ) : (
                <AgentTurn
                  key={l.id}
                  pending={!l.final}
                  text={
                    l.dropped?.length ? (
                      <>
                        <span className="line-through decoration-2">{l.text}</span>
                        <span className="mt-1 block rounded-md bg-safety-soft px-2 py-1 text-[0.9rem] font-semibold text-safety-ink">{tx.cutOff(l.dropped.join(", "))}</span>
                      </>
                    ) : (
                      l.text
                    )
                  }
                />
              ),
            )}
            {(v.pending || v.step || v.order || v.problem) && <AgentTurn status={v.order?.status === "pending_approval" ? "waiting_approver" : undefined}>{cards}</AgentTurn>}
            <div ref={end} />
          </Thread>
          {v.notice && <p className="mt-2 text-[0.95rem] text-ink-soft">{v.notice}</p>}
        </div>
      )}

      {recovering && (
        <div className="sticky bottom-0 mt-4 flex items-center gap-3 bg-mist pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
          <Button className="flex-1" onClick={() => void c.typeInstead()}>
            {tx.typeInstead}
          </Button>
          <HangUp onClick={() => c.hangUp()} />
        </div>
      )}

      {live && (
        <div className="sticky bottom-0 mt-4 bg-mist pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
          <div className="flex items-center gap-3">
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
                className={`flex h-28 min-w-0 flex-1 touch-none select-none items-center justify-center gap-3 rounded-full text-center font-bold shadow-md transition-colors [-webkit-touch-callout:none] ${v.talking ? "bg-lavender-deep text-paper ring-4 ring-lavender-mid" : "bg-petrol text-paper"}`}
              >
                <Mic aria-hidden size={34} />
                <span className="display text-[1.5rem]">{v.talking ? (v.latched ? tx.tapToStop : tx.listening) : v.agentSpeaking ? tx.holdToInterrupt : tx.holdToTalk}</span>
              </button>
            ) : (
              <p className={`flex h-28 min-w-0 flex-1 items-center justify-center gap-3 rounded-full font-bold ${v.agentSpeaking ? "bg-lavender text-lavender-deep" : "bg-lime text-ink"}`} aria-live="polite">
                <Mic aria-hidden size={30} />
                <span className="display text-[1.5rem]">{v.agentSpeaking ? tx.agentSpeaking : v.busy || v.thinking ? tx.checking : tx.listening}</span>
              </p>
            )}
            <HangUp onClick={() => c.hangUp()} />
          </div>
          <div className="mt-1 flex justify-center">
            <button type="button" onClick={() => void c.typeInstead()} className="min-h-11 px-3 text-[0.98rem] font-semibold text-petrol underline">
              {tx.typeInstead}
            </button>
          </div>
        </div>
      )}

      {typing && (
        <div className="sticky bottom-0 mt-4 bg-mist pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
          <Composer
            id="call-typed"
            label={tx.typedLabel}
            value={draft}
            onChange={setDraft}
            placeholder={tx.typedPlaceholder}
            busy={v.busy}
            onSubmit={() => {
              const t = draft.trim();
              if (!t) return;
              setDraft("");
              void c.typed("submit_request", { request: t }, t);
            }}
          />
        </div>
      )}

      {over && (
        <div className="mt-4 space-y-3 text-center">
          <p className="text-[1.1rem] font-semibold">
            {v.phase === "lost" ? tx.dropped : tx.ended} {v.endReason && v.endReason !== "hung up" ? (tx.endReason[v.endReason] ?? v.endReason) : ""}
          </p>
          {v.micProblem && <p className="text-[1rem]">{tx.mic(v.micProblem === "denied" ? tx.micBlocked : (tx.micWord[v.micProblem] ?? v.micProblem.replace("_", " ")))}</p>}
          <p className="text-sm text-ink-soft tabular">
            {v.grounding.checked > 0 ? tx.checked(v.grounding.checked, v.grounding.dropped) : ""}
            {tx.cost(v.costUsd.toFixed(3))}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button kind="go" onClick={() => void c.call(mode, c.callId() ?? undefined)}>
              <Phone aria-hidden size={18} /> {v.phase === "lost" ? tx.callBack : tx.callAgain}
            </Button>
            <Button onClick={() => void c.typeInstead()}>{v.phase === "ended" ? tx.continueTyping : tx.typeInstead}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function HangUp({ onClick }: { onClick: () => void }) {
  const tx = useText(CALL_TEXT);
  return (
    <button type="button" onClick={onClick} className="flex size-20 shrink-0 flex-col items-center justify-center gap-0.5 rounded-full bg-bad text-paper shadow-md" aria-label={tx.hangUp}>
      <PhoneOff aria-hidden size={26} />
      <span className="text-[0.78rem] font-semibold">{tx.endCall}</span>
    </button>
  );
}
