"use client";

import { Menu, Mic, PhoneOff, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LangSwitch, useText } from "../../_i18n/provider";
import { Sheet, buttonClass, useToast } from "../../_ui/kit";
import { Composer, VoiceStatus, type MicState, type VoiceState } from "../../_ui/thread";
import { AccountBar } from "./account-bar";
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
 * Speaking is a mode of this thread (docs/doors.md): the microphone starts a call with the kitchen's agent on the
 * voice door's own recogniser (primed with the kitchen's words, a spoken read-back of amount, product and day before
 * anything is priced; no browser speech recognition anywhere). While the call is on, the composer holds to talk (or
 * listens, with the open microphone), the log shows what is heard and what the agent says, and every step lands in
 * this same thread as the buyer's turn and the cards (server/thread/voice-bridge.ts). Hanging up leaves the buyer
 * here, typing; a read-back that was never confirmed goes back into the field.
 */
function VoiceBar({ onEnded }: { onEnded: (pendingWords?: string) => void }) {
  const voice = useVoiceMode();
  const tx = useText(VOICE_MODE_TEXT);
  if (!voice || !callOn(voice)) return null;
  const v = voice.view;
  const approver = v.order?.status === "pending_approval" ? v.order.approval?.approver?.name : undefined;
  const state: VoiceState = v.phase === "recovering" ? "reconnecting" : v.phase === "ringing" ? "thinking" : voice.status === "listening" ? "listening" : voice.status === "speaking" ? "speaking" : voice.status === "thinking" ? "thinking" : voice.status === "waiting" ? "waiting" : "idle";
  const label = v.phase === "ringing" ? tx.calling : v.phase === "recovering" ? tx.reconnecting : voice.status === "paused" ? tx.paused : voice.status === "waiting" && approver ? tx.waitingFor(approver) : voice.status === "ready" ? tx.holdToTalk : undefined;
  const live = v.phase === "connected";
  const end = () => {
    const words = v.pending ? ((v.pending.need as { text?: string }).text ?? "") : undefined;
    voice.hangUp();
    onEnded(words);
  };
  const switchMode = () => {
    const next = v.mode === "push_to_talk" ? "hands_free" : "push_to_talk";
    const id = voice.callId() ?? undefined;
    voice.hangUp("switching mode");
    void voice.call(next, id);
  };
  return (
    <div className="mb-2 space-y-2" data-voice-mode={v.mode}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span data-status={v.phase === "recovering" ? "recovering" : voice.status} onClick={voice.status === "paused" ? voice.resume : undefined}>
          <VoiceStatus state={state} label={label} />
        </span>
        <span className="flex items-center gap-1.5">
          {live && (
            <button type="button" className={buttonClass("quiet", "sm")} onClick={switchMode} aria-pressed={v.mode === "hands_free"}>
              {v.mode === "push_to_talk" ? tx.handsFree : tx.pushToTalk}
            </button>
          )}
          <button type="button" className={buttonClass("secondary", "sm", "!bg-bad !text-paper")} onClick={end} aria-label={tx.endCall}>
            <PhoneOff aria-hidden size={16} /> {tx.endCall}
          </button>
        </span>
      </div>
      {live && v.mode === "push_to_talk" && (
        // A large target for a thumb in a loud room; the composer's microphone does the same.
        <button
          type="button"
          aria-pressed={v.talking}
          onPointerDown={(e) => {
            e.preventDefault();
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            voice.pressTalk();
          }}
          onPointerUp={() => voice.releaseTalk()}
          onPointerCancel={() => voice.releaseTalk()}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if ((e.key === " " || e.key === "Enter") && !e.repeat) {
              e.preventDefault();
              voice.pressTalk();
            }
          }}
          onKeyUp={(e) => (e.key === " " || e.key === "Enter") && voice.releaseTalk()}
          className={`flex h-16 w-full touch-none select-none items-center justify-center gap-2.5 rounded-full text-[1.1rem] font-semibold shadow-sm transition-colors [-webkit-touch-callout:none] ${v.talking ? "bg-lavender-deep text-paper ring-4 ring-lavender-mid" : "bg-petrol text-paper"}`}
        >
          <Mic aria-hidden size={24} />
          {v.talking ? (v.latched ? tx.tapToStop : tx.listening) : tx.holdToTalk}
        </button>
      )}
      {(v.notice || v.phase === "ringing") && <p className="px-1 text-[0.8rem] leading-snug text-ink-soft">{v.notice ?? tx.languages}</p>}
    </div>
  );
}

function useVoiceDoor(onStarted: () => void): { state: MicState; heard: string; onDown: () => void; onUp: () => void } {
  const voice = useVoiceMode();
  if (!voice) return { state: "off", heard: "", onDown: () => undefined, onUp: () => undefined };
  const v = voice.view;
  if (callOn(voice)) {
    if (v.phase !== "connected" || v.mode !== "push_to_talk") return { state: "processing", heard: "", onDown: () => undefined, onUp: () => undefined };
    const heard = v.lines.findLast((l) => l.who === "you" && !l.final)?.text ?? "";
    return { state: v.talking ? "listening" : "idle", heard, onDown: voice.pressTalk, onUp: voice.releaseTalk };
  }
  // No call yet: a tap on the microphone starts one. On release, which every phone counts as the user's gesture
  // (iOS opens the microphone and plays audio only inside one).
  return {
    state: "idle",
    heard: "",
    onDown: () => undefined,
    onUp: () => {
      onStarted();
      void voice.call("push_to_talk");
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
  const mic = useVoiceDoor(() => {
    if (standalone) shared.setPanelOpen(true);
  });
  // The microphone refused or the call over: say so once, and carry on typing here.
  const micProblem = voice?.view.micProblem;
  useEffect(() => {
    if (micProblem === "denied") toast.show(vtx.micBlocked, "bad");
  }, [micProblem, toast, vtx.micBlocked]);
  // A call that ends by itself (dropped after two reconnects, the time limit, no voice connection): say why, and the
  // buyer carries on typing here; a read-back still waiting goes back into the field.
  const setDraft = agent.setDraft;
  const wasOn = useRef(false);
  const byUser = useRef(false);
  const on = callOn(voice);
  useEffect(() => {
    if (wasOn.current && !on && !byUser.current && voice) {
      const words = voice.view.pending ? ((voice.view.pending.need as { text?: string }).text ?? "") : "";
      if (words) setDraft(words);
      toast.show(voice.view.endReason ?? voice.view.notice ?? vtx.ended, "bad");
    }
    if (!on) byUser.current = false;
    wasOn.current = on;
  }, [on, voice, setDraft, toast, vtx.ended]);
  const onEnded = (pendingWords?: string) => {
    byUser.current = true;
    if (pendingWords) {
      agent.setDraft(pendingWords);
      toast.show(vtx.readBackLeft);
    } else toast.show(vtx.ended);
    fieldRef.current?.focus();
  };

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
        mic={{ state: mic.state, onDown: mic.onDown, onUp: mic.onUp, heard: mic.heard }}
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
        <div className="mt-4">
          <StartOver />
        </div>
      </Sheet>
    </>
  );
}

export function StartOver({ children }: { children?: ReactNode }) {
  const { thread } = usePortal();
  const tx = useText(THREAD_PAGE_TEXT);
  return (
    <button type="button" className={buttonClass("quiet", "sm")} onClick={() => void thread.reset()}>
      {children ?? tx.startOver}
    </button>
  );
}
