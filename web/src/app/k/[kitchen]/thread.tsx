"use client";

import { Mic, PhoneOff, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormat, useText } from "../../_i18n/provider";
import { buttonClass, useToast } from "../../_ui/kit";
import { money } from "../../_ui/plain";
import {
  AgentTurn,
  AnomalyCard,
  BuyerTurn,
  Composer,
  GateCard,
  MemoryCard,
  NoticeCard,
  OrderCard,
  PriceCard,
  RecordsCard,
  StepLines,
  Thread,
  UnderstoodCard,
  VoiceStatus,
  type MicState,
  type VoiceState,
  type UnderstoodItem,
} from "../../_ui/thread";
import type { AgentTurn as AgentTurnT, BuyerTurn as BuyerTurnT, Card, MemoryLine, Thread as ThreadT, ThreadAction, ThreadStep } from "@/server/thread/types";
import { requestLabel, usePortal } from "./portal";
import { nameIn } from "./shop";
import { THREAD_PAGE_TEXT } from "./thread.text";
import { WaitingGate } from "./thread-signoff";
import { MenuCardView } from "./thread-menu";
import { HomeCardView, OrderInPlace, PriceProof } from "./thread-home";
import { RulesCardView } from "./thread-rules";
import { OptionsDecision } from "./thread-options";
import { HistoryList } from "../../_ui/widgets-more";
import { PickerView, QuestionView, SheetView, isQuiet, sheetOrders, whenText } from "./thread-sheet";
import { THREAD_SHEET_TEXT } from "./thread-sheet.text";
import { SEND_PROBLEM } from "./thread-state";
import { THREAD_WORDS } from "./thread-words.text";
import { concernText, correctionLabel, fmtFor, gateReasons, memoryKey, memoryText, stepLabel } from "./thread-words";
import { callOn, useVoiceMode } from "../../_channels/voice-mode";
import { VOICE_MODE_TEXT } from "../../_channels/voice-mode.text";

/**
 * The kitchen's conversation with its purchasing agent (docs/agent-thread.md): the buyer's turns, and the agent's
 * turns as one short line plus cards built from records. Every button on a card is a turn of its own (a tap), sent
 * to the same engine as words; the server streams the agent's work back. One component for the docked panel and
 * the full Order page; the state lives in the portal (thread-state.ts), so both show the same thread.
 */


type Tap = (action: ThreadAction, label: string) => void;

// ---------- the log ----------

export function ThreadLog({ className = "" }: { className?: string }) {
  const { thread: api, base } = usePortal();
  const tx = useText(THREAD_PAGE_TEXT);
  const sx = useText(THREAD_SHEET_TEXT);
  const endRef = useRef<HTMLLIElement>(null);
  const t = api.thread;
  const voice = useVoiceMode();
  const onCall = callOn(voice);
  const tap: Tap = (action, label) => {
    void api.submit({ door: "typed", via: "tap", action, label });
    // On a call, the agent hears what was tapped, so it does not ask for it again.
    if (onCall) voice?.note(`The caller tapped "${label}" on the screen; the screen handles it. Do not act on it, and say nothing about it unless asked.`);
  };
  // What is being heard, and what the agent is saying, before the call's step reaches the thread.
  const liveYou = onCall ? voice?.view.lines.findLast((l) => l.who === "you" && !l.final) : undefined;
  const liveAgent = onCall ? voice?.view.lines.findLast((l) => l.who === "agent" && !l.final && l.text.trim()) : undefined;
  const turns = t?.turns ?? [];
  const lastCards = turns.reduce((n, x) => n + (x.role === "agent" ? x.cards.length + x.steps.length : 1), 0) + api.pending.length + (voice?.view.lines.length ?? 0);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [lastCards]);
  const gatedRequests = new Set(turns.flatMap((x) => (x.role === "agent" ? x.cards.flatMap((c) => (c.type === "gate" && c.requestId ? [c.requestId] : [])) : [])));
  const memory = memoryOnce(t);
  // Edits made in place on a card (a stepper, a day, a swap) change the card; they are not bubbles of their own.
  const quiet = new Set(turns.flatMap((x) => (x.role === "buyer" && isQuiet(x) ? [x.turnId] : [])));
  const shown = turns.filter((x) => (x.role === "buyer" ? !quiet.has(x.turnId) : !(quiet.has(x.replyTo) && x.cards.length === 0 && x.status !== "failed")));

  return (
    <Thread label={tx.log} className={className}>
      {turns.length === 0 && api.pending.length === 0 && <Intro />}
      {shown.map((x) =>
        x.role === "buyer" ? <Buyer key={x.turnId} turn={x} /> : <Agent key={x.turnId} turn={x} tap={tap} busy={api.posting} gated={gatedRequests} base={base} thread={t!} memory={memory} />,
      )}
      {api.pending.filter((p) => !isQuiet(p)).map((p) => (
        <PendingTurn key={p.turnId} turn={p} />
      ))}
      {liveYou && (
        <BuyerTurn via="voice">
          <span className="opacity-75">{liveYou.text}</span>
        </BuyerTurn>
      )}
      {liveAgent && <AgentTurn pending text={liveAgent.text} />}
      {api.error && (
        <li>
          <p role="alert" className="rounded-xl bg-bad-soft px-4 py-3 text-[0.92rem]">
            {api.error.startsWith(SEND_PROBLEM)
              ? (() => {
                  const [kind, what] = api.error.slice(SEND_PROBLEM.length).split(":") as ["busy" | "offline", "words" | "tap"];
                  return sx.sendProblem[kind]?.[what] ?? tx.sendFailed(api.error);
                })()
              : tx.sendFailed(api.error)}
          </p>
        </li>
      )}
      <li ref={endRef} aria-hidden />
    </Thread>
  );
}

function Intro() {
  const { thread, kitchen } = usePortal();
  const tx = useText(THREAD_PAGE_TEXT);
  const suggestions = [...tx.suggestions, kitchen.examples[0]].filter(Boolean) as string[];
  return (
    <li className="space-y-3">
      <p className="px-1 text-[0.95rem] leading-relaxed text-ink">{tx.intro}</p>
      <div className="flex flex-col items-stretch gap-2">
        {suggestions.map((s) => (
          <button key={s} type="button" onClick={() => void thread.submit({ door: "typed", via: "typed", text: s })} className="flex min-h-11 items-center rounded-xl bg-paper px-3.5 py-2 text-left text-[0.92rem] shadow-xs ring-1 ring-lavender-mid/70 transition-shadow duration-150 hover:shadow-sm hover:ring-lavender-deep/40">
            {s}
          </button>
        ))}
      </div>
    </li>
  );
}

const via = (t: BuyerTurnT) => (t.door === "voice" || t.via === "speech" ? "voice" : t.door === "photo" ? "photo" : "typed");

function Buyer({ turn }: { turn: BuyerTurnT }) {
  const f = useFormat();
  return (
    <BuyerTurn via={via(turn)} time={f.clock(turn.at)}>
      <span className="whitespace-pre-line">{turn.text ?? turn.label ?? ""}</span>
    </BuyerTurn>
  );
}

function PendingTurn({ turn }: { turn: BuyerTurnT }) {
  return (
    <>
      <BuyerTurn via={via(turn)}>
        <span className="whitespace-pre-line">{turn.text ?? turn.label ?? ""}</span>
      </BuyerTurn>
      <AgentTurn pending status="working" />
    </>
  );
}

/**
 * What memory used, said once in a thread: each remembered thing on the first card that used it, never again on a
 * later card or turn (the understood card's lines, then the after-order memory card's).
 */
function memoryOnce(t: ThreadT | undefined): Map<string, (MemoryLine | string)[]> {
  const seen = new Set<string>();
  const out = new Map<string, (MemoryLine | string)[]>();
  for (const x of t?.turns ?? []) {
    if (x.role !== "agent") continue;
    for (const c of x.cards) {
      const lines: (MemoryLine | string)[] = c.type === "understood" ? (c.memory?.length ? c.memory : c.memoryUsed) : c.type === "memory" ? c.used : [];
      const fresh = lines.filter((m) => {
        const k = memoryKey(m);
        const text = typeof m === "string" ? m : m.text;
        if (seen.has(k) || seen.has(text)) return false;
        seen.add(k);
        seen.add(text);
        return true;
      });
      out.set(c.cardId, fresh);
    }
  }
  return out;
}

function stepsOf(steps: ThreadStep[], label: (s: ThreadStep) => string) {
  // A skipped step (the memory note, when its writer is slow or unavailable) is not shown as work that was done.
  return steps.filter((s) => s.status !== "skipped").map((s) => ({ key: s.stepId, text: label(s), state: s.status === "running" ? ("doing" as const) : s.status === "failed" ? ("failed" as const) : ("done" as const), detail: s.ms !== undefined && s.status !== "running" ? `${(s.ms / 1000).toFixed(1)} s` : undefined }));
}

const SHOWING = new Set<Card["type"]>(["today", "products", "product", "standing", "deliveries", "memory_list", "records", "rules"]);

function Agent({ turn, tap, busy, gated, base, thread, memory }: { turn: AgentTurnT; tap: Tap; busy: boolean; gated: Set<string>; base: string; thread: ThreadT; memory: Map<string, (MemoryLine | string)[]> }) {
  const w = useText(THREAD_WORDS);
  const { lang } = useFormat();
  // Showing something (the day's opening, a list, a product, the rules) has nothing to explain once it is there: its
  // steps are drawn only while it works or if one failed. Ordering keeps its steps (how the order was checked).
  const showing = turn.status !== "working" && turn.cards.length > 0 && turn.cards.every((c) => SHOWING.has(c.type)) && !turn.steps.some((s) => s.status === "failed");
  const steps = showing ? [] : stepsOf(turn.steps, (s) => stepLabel(s, w, lang));
  return (
    <AgentTurn text={turn.line} status={turn.status} pending={turn.status === "working" && turn.cards.length === 0} steps={steps.length ? <StepLines steps={steps} fold={turn.status !== "working"} /> : undefined}>
      {turn.cards.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {turn.cards.map((c) => (
            <CardView key={c.cardId} card={c} tap={tap} busy={busy} gated={gated} base={base} turn={turn} thread={thread} memory={memory.get(c.cardId) ?? []} />
          ))}
        </div>
      )}
    </AgentTurn>
  );
}

// ---------- cards ----------

function CardView({ card, tap, busy, gated, base, turn, thread, memory }: { card: Card; tap: Tap; busy: boolean; gated: Set<string>; base: string; turn: AgentTurnT; thread: ThreadT; memory: (MemoryLine | string)[] }) {
  const tx = useText(THREAD_PAGE_TEXT);
  const sx = useText(THREAD_SHEET_TEXT);
  const w = useText(THREAD_WORDS);
  const f = useFormat();
  const wf = fmtFor(f.lang);
  const memoryLines = memory.map((m) => memoryText(m, w, wf, f.lang)).filter((x): x is string => !!x);
  const btn = (kind: "go" | "secondary" | "quiet" | "safety" | "ghost-dark", label: string, action: ThreadAction) => (
    <button key={label} type="button" disabled={busy} className={buttonClass(kind, "sm")} onClick={() => tap(action, label)}>
      {label}
    </button>
  );
  const measure = (a: { amount: number; unit: string }) => f.measure(a.amount, a.unit);
  const lineText = (l: { quantity: number; name: string }) => tx.packs(f.num(l.quantity), l.name);

  switch (card.type) {
    case "understood": {
      const items: UnderstoodItem[] = [{ label: tx.field.item, value: card.item }];
      if (card.amount) items.push({ label: tx.field.amount, value: measure(card.amount), from: card.basedOn?.fields.includes("quantity") ? "memory" : "said" });
      if (card.deliverOn) items.push({ label: tx.field.deliverOn, value: f.day(card.deliverOn) });
      else if (card.deliverBy) items.push({ label: tx.field.deliverBy, value: f.day(card.deliverBy), from: card.basedOn?.fields.includes("deliverBy") ? "memory" : "said" });
      if (card.claims.length) items.push({ label: tx.field.claims, value: card.claims.map((c) => f.attr(c)).join(", ") });
      if (card.allergens.length) items.push({ label: tx.field.allergens, value: card.allergens.join(", ") });
      if (card.optimise && tx.goal[card.optimise]) items.push({ label: tx.field.goal, value: tx.goal[card.optimise] });
      const fields = (xs: string[]) => xs.map((x) => tx.fieldWord[x] ?? x).join(", ");
      const based = card.basedOn ? (card.basedOn.label ? tx.basedOn(`“${card.basedOn.label}”`, fields(card.basedOn.fields)) : tx.basedOnPlain(fields(card.basedOn.fields))) : undefined;
      const notes = (card.notes ?? []).map((n) => w.note[n.code]?.(n.params, wf)).filter((x): x is string => !!x);
      return <UnderstoodCard kind={tx.kind.understood} items={items} basedOn={based} alsoAsked={card.alsoAsked.length ? tx.alsoAsked(card.alsoAsked.join("; ")) : undefined} notes={notes} memory={memoryLines} />;
    }
    case "anomaly":
      return (
        <>
          {card.concerns.map((c) => {
            const answeredWith = c.corrections.find((x) => x.id === card.answered?.choice);
            const answered = card.answered ? (card.answered.choice === "confirm" ? tx.answeredConfirm : tx.answeredChoice(answeredWith ? correctionLabel(answeredWith, w, wf, f.lang) : card.answered.choice)) : undefined;
            return (
              <AnomalyCard
                key={c.key}
                kind={tx.kind.anomaly}
                title={concernText(c, w, wf, f.lang)}
                reason={card.answered && !card.answered.verified && card.answered.choice === "confirm" ? tx.relayedNote : undefined}
                answered={answered}
                actions={
                  <>
                    {c.confirmable && btn("go", tx.confirm, { type: "concern", requestId: card.requestId, key: c.key, choice: "confirm" })}
                    {c.corrections.map((x) => btn("secondary", correctionLabel(x, w, wf, f.lang), { type: "concern", requestId: card.requestId, key: c.key, choice: x.id }))}
                  </>
                }
              />
            );
          })}
        </>
      );
    case "question":
      return <QuestionView card={card} tap={tap} busy={busy} />;
    case "options":
      return <OptionsDecision card={card} tap={tap} busy={busy} />;
    case "price": {
      const placed = gated.has(card.requestId);
      return (
        <>
        <PriceCard
          kind={tx.kind.price}
          price={money(card.totalCents)}
          per={tx.preview[card.preview.outcome] ?? undefined}
          holds={tx.holds(f.clock(card.expiresAt))}
          lines={[...card.lines.map((l) => ({ label: lineText(l), value: l.unitPriceCents !== undefined ? money(l.unitPriceCents * l.quantity) : "" })), { label: tx.deliver(f.day(card.deliveryDate)), value: "" }]}
          signed={tx.signed}
          actions={!placed && !turnClosedFor(thread, card.requestId) ? btn("go", tx.place, { type: "place", requestId: card.requestId }) : undefined}
        />
        <PriceProof card={card} />
        </>
      );
    }
    case "gate": {
      if (card.orderId && card.outcome === "placed_alone" && sheetOrders(thread).has(card.orderId)) return null;
      const name = card.approver?.name ?? "";
      const g = tx.gate;
      const title = { waiting: g.waiting(name), approved: g.approved(name), refused: g.refused(f.ruleTitle(card.rule)), placed_alone: g.placed_alone, declined: g.declined, withdrawn: g.withdrawn, expired: g.expired }[card.outcome];
      const reason = gateReasons(card.rules, card.reasons, w, wf, f.lang).join(" ") || undefined;
      if (card.outcome === "waiting" && card.approvalId)
        return <WaitingGate card={card} kind={tx.kind.gate} title={title} reason={reason} role={card.approver ? f.role(card.approver.role) : undefined} withdraw={card.orderId ? btn("ghost-dark", tx.withdraw, { type: "withdraw", orderId: card.orderId }) : undefined} />;
      return (
        <GateCard
          state={card.outcome}
          kind={tx.kind.gate}
          title={title}
          reason={reason}
          approver={card.approver ? { name: card.approver.name, role: f.role(card.approver.role), where: card.outcome === "waiting" ? tx.onPhone : undefined } : undefined}
          actions={card.outcome === "waiting" && card.orderId ? btn("ghost-dark", tx.withdraw, { type: "withdraw", orderId: card.orderId }) : undefined}
        />
      );
    }
    case "order": {
      // An order from the order sheet: the sheet already shows its lines, total and what happened; only the details stay.
      if (sheetOrders(thread).has(card.orderId)) return <OrderInPlace card={card} />;
      const tone = card.status === "committed" ? "good" : card.status === "pending_approval" ? "waiting" : card.status === "rejected" ? "refused" : "neutral";
      const who = card.authorised.by === "agent" ? tx.byAgent : card.authorised.by === "person" ? tx.byPerson(card.authorised.name) : tx.waitingFor(card.authorised.name);
      return (
        <>
          <OrderCard
            kind={tx.kind.order}
            status={{ label: tx.status[card.status] ?? card.status, tone }}
            lines={card.lines.map((l) => ({ name: l.name, qty: `× ${f.num(l.quantity)}`, price: l.unitPriceCents !== undefined ? money(l.unitPriceCents * l.quantity) : undefined }))}
            total={money(card.totalCents)}
            totalLabel={tx.total}
            delivery={`${card.deliveryDate ? tx.deliver(f.day(card.deliveryDate)) : ""} ${who}`.trim()}
            href={`${base}/orders/${card.orderId}`}
            linkLabel={tx.seeOrder}
          />
          {card.status === "committed" && card.takeBackUntil && (
            <p className="px-1">
              <button type="button" disabled={busy} className={buttonClass("secondary", "sm")} onClick={() => tap({ type: "withdraw", orderId: card.orderId }, sx.takeBackWords)}>
                {sx.takeBack(whenText(card.takeBackUntil, f.day))}
              </button>
            </p>
          )}
          <OrderInPlace card={card} />
          {card.passedOver.length > 0 && (
            <ul className="space-y-1 px-1 text-[0.84rem] leading-snug text-ink-soft">
              {card.passedOver.map((p, i) => (
                <li key={i}>{tx.passedOver(p.title, money(p.totalCents), p.why)}</li>
              ))}
            </ul>
          )}
        </>
      );
    }
    case "memory":
      return (
        <>
          {memoryLines.length > 0 && <MemoryCard kind={tx.kind.memory} items={memoryLines.map((u, i) => ({ key: `u${i}`, text: u }))} />}
          {card.proposals.length > 0 && (
            <MemoryCard
              kind={tx.kind.memoryAfter}
              items={card.proposals.map((p) => ({
                key: p.itemId,
                text: p.question,
                state: p.decided,
                keepLabel: tx.keep,
                dropLabel: tx.drop,
                onKeep: busy ? undefined : () => tap({ type: "remember", itemId: p.itemId, yes: true }, `${tx.keep}: ${p.question}`),
                onDrop: busy ? undefined : () => tap({ type: "remember", itemId: p.itemId, yes: false }, `${tx.drop}: ${p.question}`),
              }))}
            />
          )}
        </>
      );
    case "records":
      // Earlier orders: the kit's history list, each with "order again" onto the order sheet (it never orders by itself).
      if (card.repeatable && card.rows.length && card.rows.every((r) => r.kind === "order" && r.ref))
        return (
          <HistoryList
            kind={tx.kind.records}
            orders={card.rows.map((r) => ({ id: r.ref!, when: r.date ? f.day(r.date) : "", summary: r.label, total: r.totalCents !== undefined ? money(r.totalCents) : "", ...(r.detail && tx.status[r.detail] && r.detail !== "committed" ? { note: tx.status[r.detail] } : {}) }))}
            onAgain={(ref) => !busy && tap({ type: "order_again", ref }, tx.repeatWords(`“${card.rows.find((r) => r.ref === ref)?.label ?? ""}”`))}
          />
        );
      return (
        <>
          <RecordsCard
            kind={tx.kind.records}
            rows={card.rows.length ? card.rows.map((r) => ({ label: r.label, value: r.totalCents !== undefined ? money(r.totalCents) : undefined, sub: [r.date ? f.day(r.date) : "", r.detail ? (tx.status[r.detail] ?? r.detail) : ""].filter(Boolean).join(" · ") })) : [{ label: tx.noRecords }]}
          />
          {card.repeat && !card.repeatable && (
            <p className="px-1">
              <RepeatButton refId={card.repeat.ref} label={card.repeat.label} />
            </p>
          )}
          {card.repeatable && (
            <ul className="space-y-1.5 px-1">
              {card.rows.filter((r) => r.ref).map((r) => (
                <li key={r.ref}>
                  <RepeatButton refId={r.ref!} label={r.label} wide />
                </li>
              ))}
            </ul>
          )}
        </>
      );
    case "menu":
      return <MenuCardView card={card} busy={busy} tap={tap} />;
    case "sheet":
      return <SheetView card={card} tap={tap} busy={busy} />;
    case "alternatives":
      return <PickerView card={card} tap={tap} busy={busy} thread={thread} />;
    case "rules":
      return <RulesCardView card={card} busy={busy} tap={tap} />;
    case "notice": {
      // A tap on a card that has moved on (another tap, a newer version): said plainly, never as a rule.
      if (card.rule === "intake_sequence") return <NoticeCard kind={tx.kind.notice} title={sx.stale.title} tone="plain">{sx.stale.body}</NoticeCard>;
      const missing = (card.missing ?? []).map((m) => (/what to buy/.test(m) ? w.notice.missingItem : w.notice.missingAmount));
      const body =
        f.lang === "en"
          ? card.message
          : card.kind === "incomplete"
            ? w.notice.incomplete(missing.length ? missing : [w.notice.missingAmount])
            : card.kind === "not_purchase"
              ? w.notice.not_purchase
              : card.kind === "unavailable"
                ? w.notice.unavailable
                : card.kind === "paused"
                  ? w.notice.paused
                : card.kind === "not_found"
                  ? w.notice.not_found
                  : card.kind === "error"
                    ? w.notice.error
                    : "";
      return (
        <NoticeCard kind={tx.kind.notice} title={tx.notice[card.kind] ?? tx.kind.notice} tone={card.kind === "suspended" ? "gate" : "plain"} actions={card.retry ? btn("secondary", tx.retry, { type: "retry", turnId: turn.turnId }) : undefined}>
          {body}
          {card.rule ? `${body ? " " : ""}(${f.ruleTitle(card.rule)})` : ""}
        </NoticeCard>
      );
    }
    default:
      return <HomeCardView card={card} tap={tap} busy={busy} />;
  }
}

/** A price whose request already moved on (a gate card, or a newer reading) offers nothing to tap. */
function turnClosedFor(thread: ThreadT, requestId: string): boolean {
  return thread.turns.some((x) => x.role === "agent" && x.cards.some((c) => c.type === "gate" && c.requestId === requestId));
}

/** Order an earlier order again: its lines on the order sheet (an `order_again` tap, plain code, no model), confirmed there. */
function RepeatButton({ refId, label, wide = false }: { refId: string; label: string; wide?: boolean }) {
  const { thread } = usePortal();
  const tx = useText(THREAD_PAGE_TEXT);
  return (
    <button type="button" disabled={thread.posting} className={`${buttonClass("quiet", "sm")}${wide ? " w-full justify-start text-left" : ""}`} onClick={() => void thread.submit({ door: "typed", via: "tap", action: { type: "order_again", ref: refId }, label: tx.repeatWords(`“${label}”`) })}>
      {wide ? `${tx.repeat}: ${label}` : tx.repeat}
    </button>
  );
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
 * The agent, full page: where a signed-in kitchen lands (and the Order page, the same thread). The day's opening card
 * (AgentHome: what needs the kitchen today, then the starting points) is the page's header; the composer stays under
 * the thumb above the tab bar.
 */
export function ThreadPage() {
  const { thread } = usePortal();
  const tx = useText(THREAD_PAGE_TEXT);
  return (
    <section aria-labelledby="thread-title" className="mx-auto max-w-[46rem] py-4 sm:py-6">
      <header className="mb-2 flex items-center justify-end gap-3">
        <h1 id="thread-title" className="sr-only">
          {tx.pageTitle}
        </h1>
        {(thread.thread?.turns.length ?? 0) > 1 && <StartOver />}
      </header>
      <ThreadLog />
      {/* On the agent's own page the composer is all that stays under the thumb: what the rules mean is in the cards. */}
      <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 mt-6 rounded-[2rem] bg-mist/95 py-2 backdrop-blur-sm lg:bottom-4">
        <ThreadComposer hint={false} />
      </div>
    </section>
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
