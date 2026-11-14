"use client";

import { Menu, Mic, MicOff, PhoneOff, X, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LangSwitch, useText } from "../../_i18n/provider";
import { Sheet, buttonClass, useToast } from "../../_ui/kit";
import { Composer, VoiceStatus, type MicState, type VoiceState } from "../../_ui/thread";
import { AccountBar } from "./account-bar";
import { CallAgent } from "./call-agent";
import { requestLabel, usePortal } from "./portal";
import { nameIn } from "./shop";
import { ThreadLine } from "./thread-line";
import { THREAD_LINE_TEXT } from "./thread-line.text";
import { THREAD_PAGE_TEXT } from "./thread.text";
import { callOn, useVoiceMode } from "../../_channels/voice-mode";
import { VOICE_MODE_TEXT } from "../../_channels/voice-mode.text";

/**
 * The kitchen's conversation with its purchasing agent (docs/agent-thread.md): the buyer's turns, and the agent's
 * turns as one short line plus cards built from records. Every button on a card is a turn of its own (a tap), sent
 * to the same engine as words; the server streams the agent's work back. One component for the docked panel and
 * the full Order page; the state lives in the portal (thread-state.ts), so both show the same thread.
 */



// ---------- the log ----------

/** The conversation, drawn as "Thread" (thread-line.tsx): the dock on every store page and the agent's own page. */
export function ThreadLog({ className = "" }: { className?: string }) {
  return <ThreadLine className={className} />;
}

// ---------- the composer: words, the microphone, a photo ----------

/**
 * Talking is a mode of this thread, and there is one way to do it (docs/doors.md): the microphone starts a
 * hands-free conversation in place, on the voice door's own recogniser (no browser speech recognition anywhere).
 * While it is on, this bar over the composer says what the call is doing (listening, hearing the buyer, working,
 * the agent speaking, waiting for an OK, reconnecting), shows the live level, and has mute and end. Everything said
 * lands in this same thread as ordinary turns (server/thread/voice-bridge.ts); hanging up leaves the buyer here,
 * typing.
 */
function VoiceBar({ onEnded }: { onEnded: () => void }) {
  const voice = useVoiceMode();
  const tx = useText(VOICE_MODE_TEXT);
  if (!voice || !callOn(voice)) return null;
  const v = voice.view;
  const st = voice.status;
  const state: VoiceState = st === "reconnecting" ? "reconnecting" : st === "speaking" ? "speaking" : st === "hearing" || st === "listening" ? "listening" : st === "waiting" ? "waiting" : st === "muted" || st === "paused" ? "idle" : "thinking";
  const label = { starting: tx.calling, listening: tx.listening, hearing: tx.hearing, working: tx.working, speaking: tx.speaking, waiting: v.waitingFor ? tx.waitingFor(v.waitingFor) : tx.working, reconnecting: tx.reconnecting, muted: tx.muted, paused: tx.paused }[st];
  const caption = v.heard || v.saying;
  return (
    <div className="mb-2 space-y-1.5 rounded-[1.25rem] bg-paper/90 p-2 ring-1 ring-lavender-mid" data-voice-mode="hands_free" data-voice-status={st}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2" onClick={st === "paused" ? voice.resume : undefined}>
          <VoiceStatus state={state} label={label} />
          {v.phase === "live" && <Level read={voice.level} muted={v.muted} label={tx.level} />}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <button type="button" className={buttonClass("quiet", "sm")} onClick={() => voice.setMuted(!v.muted)} aria-pressed={v.muted} disabled={v.phase !== "live"}>
            {v.muted ? <MicOff aria-hidden size={16} /> : <Mic aria-hidden size={16} />} {v.muted ? tx.unmute : tx.mute}
          </button>
          <button
            type="button"
            className={buttonClass("secondary", "sm", "!bg-bad !text-paper")}
            onClick={() => {
              voice.hangUp();
              onEnded();
            }}
            aria-label={tx.endCall}
          >
            <PhoneOff aria-hidden size={16} /> {tx.endCall}
          </button>
        </span>
      </div>
      {caption ? (
        <p className={`truncate px-1 text-[0.92rem] leading-snug ${v.heard ? "italic text-petrol-deep" : "text-ink-soft"}`} aria-live="off">
          {caption}
        </p>
      ) : (
        <p className="px-1 text-[0.8rem] leading-snug text-ink-soft">{v.notice ?? `${tx.hint} ${tx.languages}`}</p>
      )}
    </div>
  );
}

/** The microphone's live level: five bars that follow the buyer's voice (still when muted). */
function Level({ read, muted, label }: { read: () => number; muted: boolean; label: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const lvl = muted ? 0 : Math.min(1, read() * 4);
      const bars = ref.current?.children;
      if (bars) for (let i = 0; i < bars.length; i++) (bars[i] as HTMLElement).style.transform = `scaleY(${Math.max(0.15, Math.min(1, lvl * (1 + i * 0.35) - i * 0.12))})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [read, muted]);
  return (
    <span ref={ref} aria-hidden title={label} className="inline-flex h-5 items-center gap-[3px] text-lavender-deep" data-voice-level>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="h-full w-[3px] origin-center rounded-full bg-current transition-transform duration-75" style={{ transform: "scaleY(0.15)" }} />
      ))}
    </span>
  );
}

/** The composer's microphone: one tap starts the hands-free conversation in place, a second tap ends it. */
function useVoiceDoor(onStarted: () => void, onEnded: () => void): { state: MicState; onTap: () => void } {
  const voice = useVoiceMode();
  if (!voice) return { state: "off", onTap: () => undefined };
  const p = voice.view.phase;
  if (p === "starting" || p === "reconnecting") return { state: "starting", onTap: () => undefined };
  if (p === "live")
    return {
      state: "live",
      onTap: () => {
        voice.hangUp();
        onEnded();
      },
    };
  // Inside the tap, which every phone counts as the user's gesture (iOS opens the microphone and plays audio only inside one).
  return {
    state: "idle",
    onTap: () => {
      onStarted();
      void voice.call();
    },
  };
}

type ScanReply = { lines: { read: string; status: string }[]; deliverByAsWritten: string | null };

/**
 * `standalone`: a composer of its own (Home's hero), with its own field, that opens the thread once it has sent;
 * otherwise the thread's composer, sharing the field (and what it is set to change) with the rest of the store.
 */
export function ThreadComposer({ id = "need", size = "md", standalone = false, placeholder, label, hint = true }: { id?: string; size?: "md" | "lg"; standalone?: boolean; placeholder?: string; label?: string; hint?: boolean }) {
  const { thread, agent: shared, kitchen, lang, fieldRef } = usePortal();
  const [ownDraft, setOwnDraft] = useState("");
  const agent = standalone ? { ...shared, draft: ownDraft, setDraft: setOwnDraft, followUp: undefined, product: undefined } : shared;
  const tx = useText(THREAD_PAGE_TEXT);
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  /** The buyer's words, with what the composer was set to (changing an earlier request, a product from the shop). */
  const words = (raw: string) => {
    const text = raw.trim();
    if (agent.followUp) return tx.changeWords(requestLabel(agent.followUp, lang), text);
    if (agent.product) return tx.productWords((lang === "en" ? (agent.product.names?.en ?? agent.product.name) : nameIn(agent.product, lang)), text);
    return text;
  };
  const send = async (raw: string, door: "typed" | "voice" = "typed") => {
    if (!raw.trim()) return fieldRef.current?.focus();
    const ok = await thread.submit({ door, via: door === "voice" ? "speech" : "typed", text: words(raw), lang });
    if (ok) {
      agent.setDraft("");
      if (standalone) shared.setPanelOpen(true);
      else {
        shared.setFollowUp(undefined);
        shared.setProduct(undefined);
      }
    }
  };
  const voice = useVoiceMode();
  const vtx = useText(VOICE_MODE_TEXT);
  const byUser = useRef(false);
  const onEnded = () => {
    byUser.current = true;
    toast.show(vtx.ended);
  };
  const mic = useVoiceDoor(() => {
    if (standalone) shared.setPanelOpen(true);
  }, onEnded);
  // A call that ends by itself (the microphone refused, the line lost and not recovered, the time limit, the screen
  // locked): say why, once, in a plain sentence; the buyer carries on typing here, the conversation as it was.
  const phase = voice?.view.phase;
  const endReason = voice?.view.endReason;
  useEffect(() => {
    if (phase !== "ended") return;
    if (!byUser.current && endReason) toast.show(endReason, "bad");
    byUser.current = false;
  }, [phase, endReason, toast]);
  // Arrived from the "talk on your phone" code (?talk=1): the microphone is the way in; say so above the composer.
  const [talkHint, setTalkHint] = useState(false);
  useEffect(() => {
    if (!standalone && new URLSearchParams(window.location.search).get("talk") === "1") queueMicrotask(() => setTalkHint(true));
  }, [standalone]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setReading(true);
    toast.show(tx.photoReading);
    const body = new FormData();
    body.set("file", f);
    try {
      const res = await fetch(`/ui-api/scan/${encodeURIComponent(kitchen.slug)}`, { method: "POST", body, credentials: "same-origin" });
      const json = (await res.json().catch(() => ({}))) as ScanReply & { error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      const lines = (json.lines ?? []).filter((l) => l.status !== "instruction" && l.status !== "not_an_item").map((l) => l.read.trim()).filter(Boolean);
      if (!lines.length) toast.show(tx.photoNothing, "bad");
      else await thread.submit({ door: "photo", via: "photo", text: [...lines, json.deliverByAsWritten ? tx.photoFor(json.deliverByAsWritten) : ""].filter(Boolean).join("\n").slice(0, 2000), lang });
    } catch (err) {
      toast.show(tx.photoFailed((err as Error).message), "bad");
    } finally {
      setReading(false);
      if (file.current) file.current.value = "";
    }
  };

  const chip = "inline-flex max-w-full items-center gap-1.5 rounded-full bg-paper py-0.5 pl-3 pr-1 text-[0.85rem] ring-1 ring-lavender-mid";
  const drop = "flex size-8 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-lavender hover:text-ink";
  return (
    <div>
      {(agent.followUp || agent.product) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {agent.followUp && (
            <span className={chip}>
              <span className="shrink-0 font-semibold text-lavender-deep">{tx.changing}</span>
              <span className="truncate">{requestLabel(agent.followUp, lang)}</span>
              <button type="button" className={drop} aria-label={tx.stopChanging} onClick={() => shared.setFollowUp(undefined)}>
                <X aria-hidden size={15} />
              </button>
            </span>
          )}
          {agent.product && (
            <span className={chip}>
              <span className="shrink-0 font-semibold text-lavender-deep">{tx.product}</span>
              <span className="truncate">{(lang === "en" ? (agent.product.names?.en ?? agent.product.name) : nameIn(agent.product, lang))}</span>
              <button type="button" className={drop} aria-label={tx.removeProduct} onClick={() => shared.setProduct(undefined)}>
                <X aria-hidden size={15} />
              </button>
            </span>
          )}
        </div>
      )}
      {!standalone && <VoiceBar onEnded={onEnded} />}
      {talkHint && !callOn(voice) && <p className="mb-2 rounded-full bg-lavender px-4 py-2 text-[0.88rem] font-medium text-lavender-deep">{vtx.talkHere}</p>}
      <Composer
        id={id}
        value={agent.draft}
        onChange={agent.setDraft}
        onSubmit={() => void send(agent.draft)}
        inputRef={standalone ? undefined : fieldRef}
        size={size}
        busy={thread.posting || reading}
        label={label ?? (agent.followUp ? tx.labelChange : agent.product ? tx.labelProduct : tx.labelAsk)}
        placeholder={placeholder ?? (agent.followUp ? tx.phChange : agent.product ? tx.phProduct : tx.phAsk)}
        mic={mic}
        onPhoto={() => file.current?.click()}
        hint={standalone || !hint ? undefined : tx.hint}
      />
      <input ref={file} type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onFile(e.target.files?.[0])} />
    </div>
  );
}

/**
 * The agent, full page: where a signed-in kitchen lands (and the Order page, the same thread), drawn as the design
 * lead's "Thread": the agent's name and the kitchen at the top, the conversation on its line, the composer under the
 * thumb. The store's sections are one tap away under the kitchen's name.
 */
export function ThreadPage() {
  const tl = useText(THREAD_LINE_TEXT);
  const tx = useText(THREAD_PAGE_TEXT);
  return (
    <section aria-labelledby="thread-title" className="mx-auto flex min-h-[calc(100dvh-2rem)] w-full max-w-[40rem] flex-col">
      <header className="flex items-center gap-2.5 px-5 pb-2 pt-4 text-ink-soft">
        <span aria-hidden className="size-2.5 rounded-full bg-petrol" />
        <h1 id="thread-title" className="text-[0.86rem] font-medium">
          {tl.name}
          <span className="sr-only"> · {tx.pageTitle}</span>
        </h1>
        <ShellMenu />
      </header>
      <div className="relative flex flex-1 flex-col px-5 pb-5 pt-4">
        <ThreadLine landing className="flex flex-1 flex-col justify-end" />
      </div>
      <footer className="sticky bottom-0 z-20 bg-gradient-to-t from-mist via-mist to-transparent px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2">
        <ThreadComposer hint={false} placeholder={tl.placeholder} />
      </footer>
    </section>
  );
}

/** The kitchen's name, top right: the store's sections, the language and starting over, one tap away. */
function ShellMenu() {
  const { kitchen, base, account } = usePortal();
  const tl = useText(THREAD_LINE_TEXT);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className="ml-auto inline-flex min-h-9 max-w-[55%] items-center gap-1 truncate text-[0.76rem] text-ink-soft hover:text-petrol">
        <span className="truncate">{kitchen.name}</span>
        <Menu aria-hidden size={15} className="shrink-0" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={tl.menu}>
        <AccountBar kitchen={kitchen} account={account} />
        <ul className="-mx-5 mt-2 divide-y divide-line border-y border-line">
          {(
            [
              ["/catalogue", tl.sections.catalogue],
              ["/orders", tl.sections.orders],
              ["/agent", tl.sections.rules],
            ] as const
          ).map(([href, label]) => (
            <li key={href}>
              <Link href={`${base}${href}`} className="flex min-h-12 items-center px-5 text-[0.98rem] font-medium hover:bg-surface">
                {label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex items-center justify-between gap-4">
          <p className="text-[0.92rem] font-medium">{tl.sections.language}</p>
          <LangSwitch />
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <CallAgent compact />
          <StartOver />
        </div>
      </Sheet>
    </>
  );
}

export function StartOver({ children, compact }: { children?: ReactNode; /** On a phone: the icon, with its name for screen readers. */ compact?: boolean }) {
  const { thread } = usePortal();
  const tx = useText(THREAD_PAGE_TEXT);
  if (compact)
    return (
      <button type="button" aria-label={tx.startOver} title={tx.startOver} className={buttonClass("quiet", "sm", "shrink-0 whitespace-nowrap px-2 sm:px-3")} onClick={() => void thread.reset()}>
        <RotateCcw aria-hidden size={16} className="sm:hidden" />
        <span aria-hidden className="hidden sm:inline">
          {tx.startOver}
        </span>
      </button>
    );
  return (
    <button type="button" className={buttonClass("quiet", "sm")} onClick={() => void thread.reset()}>
      {children ?? tx.startOver}
    </button>
  );
}
