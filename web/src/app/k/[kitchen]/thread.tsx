"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormat, useText } from "../../_i18n/provider";
import { buttonClass, useToast } from "../../_ui/kit";
import { money, shortProduct } from "../../_ui/plain";
import {
  AgentTurn,
  AnomalyCard,
  BuyerTurn,
  Composer,
  GateCard,
  MemoryCard,
  NoticeCard,
  OptionsCard,
  OrderCard,
  PriceCard,
  QuestionCard,
  RecordsCard,
  StepLines,
  Thread,
  UnderstoodCard,
  type MicState,
  type ThreadOption,
  type UnderstoodItem,
} from "../../_ui/thread";
import type { AgentTurn as AgentTurnT, BuyerTurn as BuyerTurnT, Card, OptionsCard as OptionsCardT, Thread as ThreadT, ThreadAction, ThreadStep } from "@/server/thread/types";
import { requestLabel, usePortal } from "./portal";
import { nameIn } from "./shop";
import { THREAD_PAGE_TEXT } from "./thread.text";
import { WaitingGate } from "./thread-signoff";

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
  const endRef = useRef<HTMLLIElement>(null);
  const t = api.thread;
  const tap: Tap = (action, label) => void api.submit({ door: "typed", via: "tap", action, label });
  const turns = t?.turns ?? [];
  const lastCards = turns.reduce((n, x) => n + (x.role === "agent" ? x.cards.length + x.steps.length : 1), 0) + api.pending.length;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [lastCards]);
  const gatedRequests = new Set(turns.flatMap((x) => (x.role === "agent" ? x.cards.flatMap((c) => (c.type === "gate" && c.requestId ? [c.requestId] : [])) : [])));

  return (
    <Thread label={tx.log} className={className}>
      {turns.length === 0 && api.pending.length === 0 && <Intro />}
      {turns.map((x) =>
        x.role === "buyer" ? <Buyer key={x.turnId} turn={x} /> : <Agent key={x.turnId} turn={x} tap={tap} busy={api.posting} gated={gatedRequests} base={base} thread={t!} />,
      )}
      {api.pending.map((p) => (
        <PendingTurn key={p.turnId} turn={p} />
      ))}
      {api.error && (
        <li>
          <p role="alert" className="rounded-xl bg-bad-soft px-4 py-3 text-[0.92rem]">
            {tx.sendFailed(api.error)}
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

function stepsOf(steps: ThreadStep[]) {
  return steps.map((s) => ({ key: s.stepId, text: s.label, state: s.status === "running" ? ("doing" as const) : s.status === "failed" ? ("failed" as const) : ("done" as const), detail: s.ms !== undefined && s.status !== "running" ? `${(s.ms / 1000).toFixed(1)} s` : undefined }));
}

function Agent({ turn, tap, busy, gated, base, thread }: { turn: AgentTurnT; tap: Tap; busy: boolean; gated: Set<string>; base: string; thread: ThreadT }) {
  const steps = stepsOf(turn.steps);
  return (
    <AgentTurn text={turn.line} status={turn.status} pending={turn.status === "working" && turn.cards.length === 0} steps={steps.length ? <StepLines steps={steps} fold={turn.status !== "working"} /> : undefined}>
      {turn.cards.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {turn.cards.map((c) => (
            <CardView key={c.cardId} card={c} tap={tap} busy={busy} gated={gated} base={base} turn={turn} thread={thread} />
          ))}
        </div>
      )}
    </AgentTurn>
  );
}

// ---------- cards ----------

function CardView({ card, tap, busy, gated, base, turn, thread }: { card: Card; tap: Tap; busy: boolean; gated: Set<string>; base: string; turn: AgentTurnT; thread: ThreadT }) {
  const tx = useText(THREAD_PAGE_TEXT);
  const f = useFormat();
  const btn = (kind: "go" | "secondary" | "quiet" | "safety" | "ghost-dark", label: string, action: ThreadAction) => (
    <button key={label} type="button" disabled={busy} className={buttonClass(kind, "sm")} onClick={() => tap(action, label)}>
      {label}
    </button>
  );
  const measure = (a: { amount: number; unit: string }) => f.measure(a.amount, a.unit);
  const lineText = (l: { quantity: number; name: string }) => tx.packs(f.num(l.quantity), shortProduct(l.name));

  switch (card.type) {
    case "understood": {
      const items: UnderstoodItem[] = [{ label: tx.field.item, value: card.item }];
      if (card.amount) items.push({ label: tx.field.amount, value: measure(card.amount), from: card.basedOn?.fields.includes("quantity") ? "memory" : "said" });
      if (card.deliverOn) items.push({ label: tx.field.deliverOn, value: f.day(card.deliverOn) });
      else if (card.deliverBy) items.push({ label: tx.field.deliverBy, value: f.day(card.deliverBy), from: card.basedOn?.fields.includes("deliverBy") ? "memory" : "said" });
      if (card.claims.length) items.push({ label: tx.field.claims, value: card.claims.map((c) => f.attr(c)).join(", ") });
      if (card.allergens.length) items.push({ label: tx.field.allergens, value: card.allergens.join(", ") });
      if (card.optimise) items.push({ label: tx.field.goal, value: tx.goal[card.optimise] ?? card.optimise });
      const based = card.basedOn ? (card.basedOn.label ? tx.basedOn(`“${card.basedOn.label}”`, card.basedOn.fields.join(", ")) : tx.basedOnPlain(card.basedOn.fields.join(", "))) : undefined;
      return (
        <>
          <UnderstoodCard kind={tx.kind.understood} items={items} basedOn={based} alsoAsked={card.alsoAsked.length ? tx.alsoAsked(card.alsoAsked.join("; ")) : undefined} />
          {card.memoryUsed.length > 0 && <MemoryCard kind={tx.kind.memory} items={card.memoryUsed.map((m, i) => ({ key: `${i}`, text: m }))} />}
        </>
      );
    }
    case "anomaly":
      return (
        <>
          {card.concerns.map((c) => {
            const answered = card.answered ? (card.answered.choice === "confirm" ? tx.answeredConfirm : tx.answeredChoice(c.corrections.find((x) => x.id === card.answered!.choice)?.label ?? card.answered.choice)) : undefined;
            return (
              <AnomalyCard
                key={c.key}
                kind={tx.kind.anomaly}
                title={c.message}
                reason={card.answered && !card.answered.verified && card.answered.choice === "confirm" ? tx.relayedNote : undefined}
                answered={answered}
                actions={
                  <>
                    {c.confirmable && btn("go", tx.confirm, { type: "concern", requestId: card.requestId, key: c.key, choice: "confirm" })}
                    {c.corrections.map((x) => btn("secondary", x.label, { type: "concern", requestId: card.requestId, key: c.key, choice: x.id }))}
                  </>
                }
              />
            );
          })}
        </>
      );
    case "question":
      return (
        <>
          {card.questions.map((q) => (
            <QuestionCard
              key={q.id}
              kind={tx.kind.question}
              question={q.text}
              choices={q.options.map((o) => ({ id: o.id, label: o.label }))}
              chosen={card.answered?.[q.id]}
              onChoose={busy || card.answered?.[q.id] ? undefined : (id) => tap({ type: "answer", requestId: card.requestId, questionId: q.id, optionId: id }, q.options.find((o) => o.id === id)?.label ?? id)}
            />
          ))}
        </>
      );
    case "options":
      return <Options card={card} tap={tap} busy={busy} />;
    case "price": {
      const placed = gated.has(card.requestId);
      return (
        <PriceCard
          kind={tx.kind.price}
          price={money(card.totalCents)}
          per={tx.preview[card.preview.outcome] ?? undefined}
          holds={tx.holds(f.clock(card.expiresAt))}
          lines={[...card.lines.map((l) => ({ label: lineText(l), value: l.unitPriceCents !== undefined ? money(l.unitPriceCents * l.quantity) : "" })), { label: tx.deliver(f.day(card.deliveryDate)), value: "" }]}
          signed={tx.signed}
          actions={!placed && !turnClosedFor(thread, card.requestId) ? btn("go", tx.place, { type: "place", requestId: card.requestId }) : undefined}
        />
      );
    }
    case "gate": {
      const name = card.approver?.name ?? "";
      const g = tx.gate;
      const title = { waiting: g.waiting(name), approved: g.approved(name), refused: g.refused(f.ruleTitle(card.rule)), placed_alone: g.placed_alone, declined: g.declined, withdrawn: g.withdrawn, expired: g.expired }[card.outcome];
      if (card.outcome === "waiting" && card.approvalId)
        return <WaitingGate card={card} kind={tx.kind.gate} title={title} reason={card.reasons.join(" ")} role={card.approver ? f.role(card.approver.role) : undefined} withdraw={card.orderId ? btn("ghost-dark", tx.withdraw, { type: "withdraw", orderId: card.orderId }) : undefined} />;
      return (
        <GateCard
          state={card.outcome}
          kind={tx.kind.gate}
          title={title}
          reason={card.reasons.join(" ")}
          approver={card.approver ? { name: card.approver.name, role: f.role(card.approver.role), where: tx.onPhone } : undefined}
          actions={card.outcome === "waiting" && card.orderId ? btn("ghost-dark", tx.withdraw, { type: "withdraw", orderId: card.orderId }) : undefined}
        />
      );
    }
    case "order": {
      const tone = card.status === "committed" ? "good" : card.status === "pending_approval" ? "waiting" : card.status === "rejected" ? "refused" : "neutral";
      const who = card.authorised.by === "agent" ? tx.byAgent : card.authorised.by === "person" ? tx.byPerson(card.authorised.name) : tx.waitingFor(card.authorised.name);
      return (
        <>
          <OrderCard
            kind={tx.kind.order}
            status={{ label: tx.status[card.status] ?? card.status, tone }}
            lines={card.lines.map((l) => ({ name: shortProduct(l.name), qty: `× ${f.num(l.quantity)}`, price: l.unitPriceCents !== undefined ? money(l.unitPriceCents * l.quantity) : undefined }))}
            total={money(card.totalCents)}
            totalLabel={tx.total}
            delivery={`${card.deliveryDate ? tx.deliver(f.day(card.deliveryDate)) : ""} ${who}`.trim()}
            href={`${base}/orders/${card.orderId}`}
            linkLabel={tx.seeOrder}
          />
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
          {card.used.length > 0 && <MemoryCard kind={tx.kind.memory} items={card.used.map((u, i) => ({ key: `u${i}`, text: u }))} />}
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
      return (
        <>
          <RecordsCard
            kind={tx.kind.records}
            rows={card.rows.length ? card.rows.map((r) => ({ label: r.label, value: r.totalCents !== undefined ? money(r.totalCents) : undefined, sub: [r.date ? f.day(r.date) : "", r.detail ? (tx.status[r.detail] ?? r.detail) : ""].filter(Boolean).join(" · ") })) : [{ label: tx.noRecords }]}
          />
          {card.repeat && <RepeatButton label={card.repeat.label} />}
        </>
      );
    case "notice":
      return (
        <NoticeCard kind={tx.kind.notice} title={tx.notice[card.kind] ?? tx.kind.notice} tone={card.kind === "suspended" ? "gate" : "plain"} actions={card.retry ? btn("secondary", tx.retry, { type: "retry", turnId: turn.turnId }) : undefined}>
          {card.message}
          {card.rule ? ` (${f.ruleTitle(card.rule)})` : ""}
        </NoticeCard>
      );
  }
}

/** A price whose request already moved on (a gate card, or a newer reading) offers nothing to tap. */
function turnClosedFor(thread: ThreadT, requestId: string): boolean {
  return thread.turns.some((x) => x.role === "agent" && x.cards.some((c) => c.type === "gate" && c.requestId === requestId));
}

function RepeatButton({ label }: { label: string }) {
  const { thread } = usePortal();
  const tx = useText(THREAD_PAGE_TEXT);
  return (
    <p className="px-1">
      <button type="button" disabled={thread.posting} className={buttonClass("quiet", "sm")} onClick={() => void thread.submit({ door: "typed", via: "typed", text: tx.repeatWords(`“${shortProduct(label)}”`) })}>
        {tx.repeat}
      </button>
    </p>
  );
}

function Options({ card, tap, busy }: { card: OptionsCardT; tap: Tap; busy: boolean }) {
  const tx = useText(THREAD_PAGE_TEXT);
  const f = useFormat();
  const options: ThreadOption[] = card.options.map((o) => ({
    id: o.optionId,
    rank: o.rank === "best" || o.rank === "better" ? o.rank : "good",
    name: shortProduct(o.title),
    detail: o.lines.map((l) => tx.packs(f.num(l.quantity), shortProduct(l.name))).join(" + "),
    price: money(o.totalCents),
    per: f.measure(o.delivered.amount, o.delivered.unit),
    delivery: [tx.deliver(f.day(o.deliveryDate)), o.orderBy ? tx.orderBy(f.clock(o.orderBy)) : "", o.stockConfirmed ? "" : tx.stockUnknown].filter(Boolean).join(", "),
    keeps: o.pros,
    givesUp: [...o.givesUp, ...o.cons],
    preselected: card.preselected?.optionId === o.optionId ? tx.preselected(card.preselected.reason) : undefined,
    signOff: o.signOff.length ? o.signOff.join(" ") : undefined,
  }));
  const left = card.excluded.map((x) => tx.left(x.count, x.reason)).join(" · ");
  const note = [left, ...card.notes].filter(Boolean).join(" ");
  return (
    <OptionsCard
      kind={tx.kind.options}
      options={options}
      chosen={card.chosen}
      note={note || undefined}
      onChoose={busy || card.chosen ? undefined : (id) => tap({ type: "choose", requestId: card.requestId, optionId: id }, `${shortProduct(card.options.find((o) => o.optionId === id)?.title ?? id)}`)}
    />
  );
}

// ---------- the composer: words, the microphone, a photo ----------

/**
 * The microphone is the voice door (server/channels/voice/): its realtime recogniser primed with the kitchen's own
 * words in three languages, and the spoken read-back of amount, product and day before anything is priced. The
 * call writes every step into this same thread (server/thread/voice-bridge.ts), so the conversation continues
 * here when the call ends. A visitor's kitchen calls from its own phone at /call; an account's kitchen at
 * /call?k=<kitchen>, on a phone signed in to it (this one).
 */
function useVoiceDoor(slug: string, visitor: boolean) {
  const onDown = () => {
    window.location.assign(visitor ? "/call" : `/call?k=${encodeURIComponent(slug)}`);
  };
  return { state: "idle" as MicState, heard: "", onDown, onUp: () => undefined };
}

type ScanReply = { lines: { read: string; status: string }[]; deliverByAsWritten: string | null };

/**
 * `standalone`: a composer of its own (Home's hero), with its own field, that opens the thread once it has sent;
 * otherwise the thread's composer, sharing the field (and what it is set to change) with the rest of the store.
 */
export function ThreadComposer({ id = "need", size = "md", standalone = false, placeholder, label }: { id?: string; size?: "md" | "lg"; standalone?: boolean; placeholder?: string; label?: string }) {
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
    if (agent.product) return tx.productWords(shortProduct(lang === "en" ? (agent.product.names?.en ?? agent.product.name) : nameIn(agent.product, lang)), text);
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
  const mic = useVoiceDoor(kitchen.slug, kitchen.kind === "visitor");

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
              <span className="truncate">{shortProduct(lang === "en" ? (agent.product.names?.en ?? agent.product.name) : nameIn(agent.product, lang))}</span>
              <button type="button" className={drop} aria-label={tx.removeProduct} onClick={() => shared.setProduct(undefined)}>
                <X aria-hidden size={15} />
              </button>
            </span>
          )}
        </div>
      )}
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
        hint={standalone ? undefined : tx.hint}
      />
      <input ref={file} type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onFile(e.target.files?.[0])} />
    </div>
  );
}

/** The full-page thread (the Order page): the same conversation as the dock, with room to read it. */
export function ThreadPage() {
  const { thread } = usePortal();
  const tx = useText(THREAD_PAGE_TEXT);
  return (
    <section aria-labelledby="thread-title" className="mx-auto max-w-[46rem] py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 id="thread-title" className="display text-[2rem] leading-tight sm:text-[2.4rem]">
            {tx.pageTitle}
          </h1>
          <p className="mt-1 max-w-[60ch] text-[0.98rem] leading-relaxed text-ink-soft">{tx.pageLead}</p>
        </div>
        {(thread.thread?.turns.length ?? 0) > 0 && <StartOver />}
      </header>
      <ThreadLog />
      <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 mt-6 rounded-[2rem] bg-mist/95 py-2 backdrop-blur-sm lg:bottom-4">
        <ThreadComposer />
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
