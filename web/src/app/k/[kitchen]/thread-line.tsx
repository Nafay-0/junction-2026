"use client";

import { Check, ChevronDown, Mic, ScanFace, Sparkles } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { useFormat, useText } from "../../_i18n/provider";
import { clock, money } from "../../_ui/plain";
import type { AgentTurn, BuyerTurn, GateCard as GateCardT, RulesCard as RulesCardT, OfferCard, ScenarioCard, WatchCard, OptionView, OrderCard, Thread, ThreadAction, ThreadStep, TodayCard } from "@/server/thread/types";
import { usePortal } from "./portal";
import { Dishes } from "./thread-dishes";
import { RulesSignOffSlab } from "./thread-rules-signoff";
import { groupNameL } from "./rules-change";
import { familyL } from "./family.text";
import { THREAD_RULES_TEXT } from "./thread-rules.text";
import { attrL } from "../../_i18n/format";
import { THREAD_LINE_TEXT } from "./thread-line.text";
import { useSignOff } from "./thread-signoff";
import { THREAD_WORDS } from "./thread-words.text";
import { concernText, correctionLabel, fmtFor, gateReasons, leadOption, leftOutGroups, memoryText, oneThing, stepLabel, titleOf } from "./thread-words";

/**
 * The buyer's conversation with their agent, drawn as "Thread" (the design lead's /design/conversation?d=b): one line
 * runs down the conversation; each reply of the agent is a node on it, in two to four plain sentences it wrote from
 * the engine's results. While it works the line draws itself in lime. A short list of at most three choices only for a
 * real choice (tappable, or answered in words), the order's lines behind "Show the list", the passkey OK as the one
 * button on the dark slab, and the agent's work folded under each reply as "N steps", written for a person.
 *
 * The engine's cards are unchanged underneath: they make the words true, and they are what the open interface returns.
 */

type Tap = (action: ThreadAction, label: string) => void;
type Tx = (typeof THREAD_LINE_TEXT)["en"];
type Think = { label: string; detail?: string; tone?: "kept" | "left" | "rule" | "live" | "memory" | "plain" };

const TONE: Record<NonNullable<Think["tone"]>, string> = {
  plain: "bg-ink-soft/40",
  kept: "bg-good",
  left: "bg-notice",
  rule: "bg-petrol",
  live: "bg-lime",
  memory: "bg-lavender-deep",
};

/** The agent's text with its two marks: **a figure** and {{a day}}, set inside the sentence. */
export function Rich({ text }: { text: string }) {
  // "{{Monday 16.11.}}." would read "16.11.." : one full stop is enough.
  text = text.replace(/\.\}\}\./g, ".}}");
  const parts = text.split(/(\*\*[^*]+\*\*|\{\{[^}]+\}\})/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") ? (
          <strong key={i} className="whitespace-nowrap font-semibold text-ink tabular">
            {p.slice(2, -2)}
          </strong>
        ) : p.startsWith("{{") ? (
          <span key={i} className="font-medium text-petrol">
            {p.slice(2, -2)}
          </span>
        ) : (
          // An unmarked amount never wraps mid-number ("1 010,00 €").
          <Fragment key={i}>{p.replace(/(\d) (?=\d{3}\b)/g, "$1\u00a0").replace(/(\d) (€|%|L|l|kg)(?![\p{L}])/gu, "$1\u00a0$2")}</Fragment>
        ),
      )}
    </>
  );
}

const wordsOf = (s: string) => s.replace(/\*\*|\{\{|\}\}/g, "").split(/\s+/).filter(Boolean).length;

// ---------- the log ----------

export function ThreadLine({ className = "", landing = false }: { className?: string; landing?: boolean }) {
  const { thread: api } = usePortal();
  const { lang } = useFormat();
  const t = api.thread;
  const turns = t?.turns ?? [];
  const endRef = useRef<HTMLLIElement>(null);
  const tap: Tap = (action, label) => void api.submit({ door: "typed", via: "tap", action, label, lang });
  const working = api.pending.length > 0 || turns.some((x) => x.role === "agent" && x.status === "working");
  const size = turns.reduce((n, x) => n + (x.role === "agent" ? x.cards.length + x.steps.length + (x.line?.length ?? 0) : 1), 0) + api.pending.length;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [size]);
  const buyers = turns.filter((x): x is BuyerTurn => x.role === "buyer");
  const opening = turns.find((x): x is AgentTurn => x.role === "agent" && x.cards.some((c) => c.type === "today"));
  const onlyOpening = buyers.length === 0 && api.pending.length === 0;
  const lastAgent = [...turns].reverse().find((x): x is AgentTurn => x.role === "agent");
  // Replies not started yet because an earlier one is still being worked on: shown as waiting their turn.
  const firstWorking = turns.findIndex((x) => x.role === "agent" && x.status === "working");
  const queued = new Set(firstWorking < 0 ? [] : turns.slice(firstWorking + 1).flatMap((x) => (x.role === "agent" && x.status === "working" && !x.steps.length && !x.cards.length && !x.line ? [x.turnId] : [])));

  return (
    // The landing (nothing said yet) sits in the upper part of the screen, not under a screen of empty space.
    <div className={`relative ${onlyOpening && landing ? className.replace("justify-end", "justify-start pt-[6dvh]") : className}`}>
      <span aria-hidden className={`absolute bottom-0 left-[0.6rem] top-0 w-px origin-top transition-colors ${working ? "tl-draw bg-gradient-to-b from-petrol via-petrol to-lime" : "bg-petrol/30"}`} />
      <ol role="log" aria-live="polite" aria-label="Conversation with the purchasing agent" className="relative flex flex-col gap-7 pl-9">
        {onlyOpening && landing ? (
          <li>
            <Landing today={opening?.cards.find((c): c is TodayCard => c.type === "today")} offer={opening?.cards.find((c): c is OfferCard => c.type === "offer")} watch={opening?.cards.find((c): c is WatchCard => c.type === "watch")} thread={t} />
          </li>
        ) : (
          turns.map((x) =>
            x.role === "agent" && x === opening && !onlyOpening && !x.cards.some((c) => (c.type === "today" && c.items.length > 0) || c.type === "offer" || c.type === "watch") ? null : x.role === "buyer" ? (
              <BuyerLine key={x.turnId} turn={x} />
            ) : queued.has(x.turnId) ? (
              <QueuedNode key={x.turnId} />
            ) : (
              <AgentNode key={x.turnId} turn={x} thread={t!} tap={tap} busy={api.posting} latest={x === lastAgent} />
            ),
          )
        )}
        {api.pending.map((p, i) => (
          <Fragment key={p.turnId}>
            <BuyerLine turn={p} />
            {i === 0 && firstWorking < 0 ? <WorkingNode label={undefined} /> : <QueuedNode />}
          </Fragment>
        ))}
        {api.error && (
          <li>
            <p role="alert" className="text-[0.95rem] text-bad">
              {api.error}
            </p>
          </li>
        )}
        <li ref={endRef} aria-hidden />
      </ol>
    </div>
  );
}

function BuyerLine({ turn }: { turn: BuyerTurn }) {
  const text = turn.text ?? turn.label ?? "";
  // Words heard by the voice door are marked as spoken (the transcript is the evidence the turn was acted on).
  const spoken = turn.door === "voice" && turn.via === "speech";
  const tx = useText(THREAD_LINE_TEXT);
  return (
    <li className="tl-in relative" {...(spoken ? { "data-spoken": "" } : {})}>
      <span aria-hidden className="absolute -left-[2.05rem] top-[0.45em] z-10 size-2.5 rounded-full border-2 border-petrol bg-mist" />
      <p className="display whitespace-pre-line text-[1.2rem] leading-tight text-petrol-deep [overflow-wrap:anywhere]">
        {spoken && <Mic aria-hidden size={16} className="mr-1.5 inline-block align-[-0.1em] text-lavender-deep" />}
        {text}
        {spoken && <span className="sr-only"> ({tx.spoken})</span>}
      </p>
    </li>
  );
}

function WorkingNode({ label }: { label?: string }) {
  const tx = useText(THREAD_LINE_TEXT);
  return (
    <li className="relative" aria-busy>
      <span aria-hidden className="tl-pulse absolute -left-[2.35rem] top-[0.25em] size-[1.15rem] rounded-full bg-lime" />
      <p className="tl-sheen text-[1.02rem] font-medium text-petrol">{label ?? tx.working}</p>
    </li>
  );
}

/** A message sent while the agent still works on the one before: kept, and answered next, in order. */
function QueuedNode() {
  const tx = useText(THREAD_LINE_TEXT);
  return (
    <li className="relative" data-queued>
      <span aria-hidden className="absolute -left-[2.2rem] top-[0.35em] size-[0.85rem] rounded-full border-2 border-petrol/40 bg-mist" />
      <p className="text-[0.92rem] text-ink-soft">{tx.queued}</p>
    </li>
  );
}

/** The store's formats, with English days as people write them ("Mon 16 Nov"); Finnish and Swedish keep "ma 16.11.". */
function useThreadFormat() {
  const f = useFormat();
  if (f.lang !== "en") return f;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { ...f, day: (iso: string) => { const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; } };
}

// ---------- one reply of the agent ----------

function AgentNode({ turn, thread, tap, busy, latest }: { turn: AgentTurn; thread: Thread; tap: Tap; busy: boolean; latest: boolean }) {
  const tx = useText(THREAD_LINE_TEXT);
  const w = useText(THREAD_WORDS);
  const f = useThreadFormat();
  const cards = turn.cards;
  const today = cards.find((c): c is TodayCard => c.type === "today");
  const running = turn.steps.findLast((s) => s.status === "running");
  if (turn.status === "working" && !turn.line && !cards.some((c) => c.type !== "understood")) return <WorkingNode label={running ? stepLabel(running, w, f.lang) : undefined} />;
  // While it works, the agent's own words are still coming: no stand-in text from the cards until it has finished.
  // "Nothing needs you today" is not said above a stock-out or an offer that the same opening says.
  const quietToday = today && !today.items.length && cards.some((c) => c.type === "watch" || c.type === "offer");
  const text = turn.line || (today ? (quietToday ? "" : todaySentence(today, tx, f)) : turn.status === "working" ? "" : fallbackLine(turn, thread, tx, f));
  const thinks = thinking(turn, thread, tx, w, f);
  const busyNow = turn.status === "working" || !!running;
  // A menu in the reply: the dishes after the words, and the reply's closing question after the dishes and the total.
  const dishes = cards.find((c) => c.type === "dishes");
  const sentences = text ? text.split(/(?<=[.!?])\s+(?=[^\s])/) : [];
  const ask = dishes && sentences.length > 1 && /\?$/.test(sentences.at(-1)!.trim()) ? sentences.at(-1)! : "";
  const said = ask ? sentences.slice(0, -1).join(" ") : text;
  return (
    <li className="tl-in relative">
      {/* The busy mark and the working words change together: busy while any step still runs. */}
      <span aria-hidden className={`absolute -left-[2.35rem] top-[0.3em] flex size-[1.15rem] items-center justify-center rounded-full ${busyNow ? "tl-pulse bg-lime" : "bg-petrol"}`}>
        {!busyNow && <span className="size-1.5 rounded-full bg-lime" />}
      </span>
      {said && (
        <p data-agent-words={wordsOf(text)} className="max-w-[38ch] whitespace-pre-line text-[1.02rem] leading-[1.6] text-ink [text-wrap:pretty]">
          <Rich text={said} />
        </p>
      )}
      {dishes?.type === "dishes" && <Dishes card={dishes} lang={f.lang} day={f.day} said={text} />}
      {ask && (
        <p className="mt-2.5 max-w-[38ch] text-[1.02rem] leading-[1.6] text-ink [text-wrap:pretty]">
          <Rich text={ask} />
        </p>
      )}
      {busyNow && (running || !text) && <p aria-busy className="tl-sheen mt-1 text-[0.9rem] font-medium text-petrol">{running ? stepLabel(running, w, f.lang) : tx.working}</p>}
      {cards.map((c) => (c.type === "scenario" && c.state === "open" && !(turn.line ?? "").includes(c.text[f.lang].say.slice(0, 24)) ? <ScenarioWords key={c.cardId} card={c} lang={f.lang} /> : null))}
      {cards.map((c) => (c.type === "watch" && c.state !== "answered" && !(turn.line ?? "").includes(c.text[f.lang].say.slice(0, 24)) ? <WatchWords key={c.cardId} card={c} lang={f.lang} /> : null))}
      {cards.map((c) => (c.type === "offer" && c.state === "open" && !(turn.line ?? "").includes(c.text[f.lang].say.slice(0, 24)) ? <OfferWords key={c.cardId} card={c} lang={f.lang} /> : null))}
      {latest && <Choices turn={turn} thread={thread} tap={tap} busy={busy} />}
      <Lists turn={turn} thread={thread} latest={latest} />
      <Memory turn={turn} />
      {cards.map((c) => (c.type === "gate" && c.outcome === "waiting" && c.approvalId ? <SignOffSlab key={c.cardId} card={c} thread={thread} tap={tap} /> : c.type === "gate" && c.outcome === "approved" && c.orderId ? <SignedSlab key={c.cardId} card={c} thread={thread} /> : null))}
      {today && <WaitingSlabs today={today} thread={thread} tap={tap} />}
      {/* A change to the rules that waits for the approver: its slab under the reply that said so (the card itself may
          have been first shown a turn earlier), always in view, never inside a disclosure. */}
      {rulesSlabsFor(turn, thread).map((c) => (
        <RulesSignOffSlab key={c.cardId} card={c} />
      ))}
      {thinks.length > 0 && <Steps steps={thinks} orderId={cards.find((c): c is OrderCard => c.type === "order" && (c.status === "committed" || c.status === "pending_approval"))?.orderId} />}
    </li>
  );
}

/** The rules changes whose sign-off this turn shows: said to wait in this turn, or (older cards) first shown here. */
function rulesSlabsFor(turn: AgentTurn, thread: Thread): RulesCardT[] {
  const all = thread.turns.flatMap((x) => (x.role === "agent" ? x.cards.map((card) => ({ at: x.turnId, card })) : []));
  return all.flatMap(({ at, card }) => {
    if (card.type !== "rules" || !card.proposal?.approval || !["waiting", "signed", "declined", "expired"].includes(card.proposal.state)) return [];
    const here = card.proposal.approval.turnId && thread.turns.some((x) => x.turnId === card.proposal!.approval!.turnId) ? card.proposal.approval.turnId : at;
    return here === turn.turnId ? [card] : [];
  });
}

/**
 * The orders waiting for a person's OK on the day's opening: the newest one's slab, and when there are more, one quiet
 * link to all of them in Orders (never a wall of slabs).
 */
function WaitingSlabs({ today, thread, tap }: { today: TodayCard; thread: Thread; tap: Tap }) {
  const tx = useText(THREAD_LINE_TEXT);
  const f = useThreadFormat();
  const { base } = usePortal();
  const waiting = today.items.filter((i): i is Extract<TodayCard["items"][number], { kind: "sign_off" }> => i.kind === "sign_off");
  const i = waiting[0];
  if (!i) return null;
  return (
    <>
      <SignOffSlab key={i.approvalId} card={{ type: "gate", cardId: `gate:${i.orderId}`, requestId: i.requestId ?? "", orderId: i.orderId, approvalId: i.approvalId, outcome: "waiting", approver: i.approver, reasons: [], rules: [] } as GateCardT} thread={thread} tap={tap} total={i.totalCents} what={i.lines.map((l) => `${f.num(l.quantity)} × ${l.name}`).join(", ")} />
      {waiting.length > 1 && (
        <a href={`${base}/orders?show=waiting`} className="mt-2 inline-flex min-h-10 items-center text-[0.9rem] font-medium text-petrol underline decoration-petrol/40 underline-offset-4">
          {tx.today.allWaiting(waiting.length)}
        </a>
      )}
    </>
  );
}

// ---------- choices: at most three, only for a real choice ----------

function Choices({ turn, thread, tap, busy }: { turn: AgentTurn; thread: Thread; tap: Tap; busy: boolean }) {
  const tx = useText(THREAD_LINE_TEXT);
  const w = useText(THREAD_WORDS);
  const f = useThreadFormat();
  const wf = fmtFor(f.lang);
  const rows: { key: string; title: string; price?: string; differs?: string; action: ThreadAction }[] = [];
  for (const c of turn.cards) {
    if (rows.length) break;
    if (c.type === "options" && !c.chosen && !c.adjusted && !answeredAfter(thread, turn)) {
      const lead = leadOption(c);
      const usable = c.options.filter((o) => o.gate?.outcome !== "reject");
      const ordered = [lead, ...usable.filter((o) => o.optionId !== lead.optionId)].slice(0, 3);
      if (ordered.length > 1) for (const o of ordered) rows.push({ key: o.optionId, title: titleOf(o, w), price: money(o.totalCents), differs: [perUnitOf(o, f), o.optionId === lead.optionId ? "" : oneThing(o, lead, w, wf)].filter(Boolean).join(" · "), action: { type: "choose", requestId: c.requestId, optionId: o.optionId } });
    } else if (c.type === "menu" && c.stage === "choose" && !c.sheetId) {
      for (const p of c.proposals.slice(0, 3)) rows.push({ key: p.proposalId, title: p.title, ...(p.costPerCoverCents ? { price: `${money(p.costPerCoverCents)}` } : {}), differs: p.dishes.join(", "), action: { type: "menu_choose", planId: c.planId, proposalId: p.proposalId } });
    } else if (c.type === "question") {
      const q = c.questions.find((x) => !c.answered?.[x.id]);
      if (q) for (const o of q.options.slice(0, 3)) rows.push({ key: o.id, title: o.label, action: { type: "answer", requestId: c.requestId, questionId: q.id, optionId: o.id } });
    } else if (c.type === "anomaly" && !c.answered) {
      const k = c.concerns[0];
      // Several items in one message: a choice names its item, so a chip is never without context.
      const several = turn.cards.filter((x) => x.type === "understood").length > 1;
      const item = several ? turn.cards.find((x) => x.type === "understood" && x.requestId === c.requestId) : undefined;
      const of = item?.type === "understood" ? `${item.item}: ` : "";
      if (k) {
        if (k.confirmable) rows.push({ key: "confirm", title: `${of}${tx.asSaid}`, action: { type: "concern", requestId: c.requestId, key: k.key, choice: "confirm" } });
        for (const x of k.corrections.slice(0, 2)) rows.push({ key: x.id, title: `${of}${correctionLabel(x, w, wf, f.lang)}`, action: { type: "concern", requestId: c.requestId, key: k.key, choice: x.id } });
      }
    }
  }
  if (!rows.length) return null;
  return (
    <div className="mt-3">
      <div role="group" aria-label={tx.choices} className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <button key={r.key} type="button" aria-label={r.price ? `${r.title}, ${r.price}` : r.title} disabled={busy} onClick={() => tap(r.action, r.title)} className="group flex items-baseline gap-3 rounded-xl bg-paper/70 px-3 py-2 text-left transition-colors hover:bg-paper disabled:opacity-60">
            <span className="min-w-0 flex-1">
              <span className="block text-[0.95rem] font-medium leading-snug [overflow-wrap:anywhere]">{r.title}</span>
              {r.differs && <span className="block text-[0.8rem] leading-snug text-ink-soft">{r.differs}</span>}
            </span>
            {r.price && <span className="shrink-0 text-[0.86rem] tabular">{r.price}</span>}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[0.8rem] text-ink-soft">{tx.orWords}</p>
    </div>
  );
}

/** A later buyer turn answered this one already (its choices are history). */
function answeredAfter(thread: Thread, turn: AgentTurn): boolean {
  const i = thread.turns.indexOf(turn);
  return thread.turns.slice(i + 1).some((x) => x.role === "buyer");
}

function perUnitOf(o: OptionView, f: ReturnType<typeof useFormat>): string | undefined {
  const l = o.lines[0];
  if (!l?.unitPriceCents || !l.packSize || !l.unit || l.unit === "pcs") return undefined;
  return `${money(Math.round(l.unitPriceCents / l.packSize))}/${l.unit.toLowerCase()} · ${f.day(o.deliveryDate)}`;
}

// ---------- the order's lines, open under the reply ("Hide the list" folds them) ----------

/** A rule's value in words for the list under a reply: product groups and claims by name, never a code. */
function ruleValue(field: string, v: string, lang: "en" | "fi" | "sv"): string {
  if (!v) return "";
  const xs = v.split(", ").filter(Boolean);
  if (field === "groups") return xs.map((g) => groupNameL(g, lang)).join(", ");
  if (field === "forbiddenAllergens" || field === "requiredAttributes") return xs.map((a) => attrL(a, lang)).join(", ");
  if (field === "perOrderLimitEur" || field === "weeklyBudgetEur") return `${v} €`;
  return v.replaceAll("_", " ");
}

function Lists({ turn, thread, latest }: { turn: AgentTurn; thread: Thread; latest?: boolean }) {
  const tx = useText(THREAD_LINE_TEXT);
  const rx = useText(THREAD_RULES_TEXT);
  const f = useThreadFormat();
  const lists: { key: string; rows: { item: string; amount?: string; total?: string }[]; total?: string }[] = [];
  // A menu's products: each with its packs and pack size, and its price.
  const menuRows = (c: Extract<AgentTurn["cards"][number], { type: "menu" }>) => c.dishes.flatMap((d) => d.lines.filter((l) => l.product).map((l) => ({ item: l.product!.name, amount: `${f.num(l.product!.packs)} × ${f.measure(l.product!.packSize, l.product!.unit)}`, total: money(l.product!.totalCents) })));
  const fromSheet = new Set(thread.turns.flatMap((x) => (x.role === "agent" ? x.cards.flatMap((c) => (c.type === "sheet" && c.orderId ? [c.orderId] : [])) : [])));
  for (const c of turn.cards) {
    if (c.type === "sheet") lists.push({ key: c.cardId, rows: c.lines.map((l) => ({ item: l.name, amount: `${f.num(l.packs)} × ${f.measure(l.packSize, l.unit)}`, total: money(l.lineTotalCents) })), total: money(c.totalCents) });
    else if (c.type === "order" && !fromSheet.has(c.orderId) && c.lines.length > 1) lists.push({ key: c.cardId, rows: c.lines.map((l) => ({ item: l.name, amount: f.num(l.quantity), ...(l.unitPriceCents !== undefined ? { total: money(l.unitPriceCents * l.quantity) } : {}) })), total: money(c.totalCents) });
    else if (c.type === "menu" && (c.stage === "ready" || c.stage === "ordered")) lists.push({ key: c.cardId, rows: menuRows(c), total: money(c.totalCents) });
    else if (c.type === "records") lists.push({ key: c.cardId, rows: c.rows.map((r) => ({ item: r.label, ...(r.date ? { amount: f.day(r.date) } : {}), ...(r.totalCents !== undefined ? { total: money(r.totalCents) } : {}) })) });
    else if (c.type === "products") lists.push({ key: c.cardId, rows: c.products.map((p) => ({ item: p.name, amount: f.measure(p.packSize, p.unit) })) });
    else if (c.type === "standing") lists.push({ key: c.cardId, rows: c.items.map((i) => ({ item: i.name, amount: `${f.measure(i.usual.amount, i.usual.unit)} · ${f.weekdays(i.weekdays)}` })) });
    else if (c.type === "deliveries") lists.push({ key: c.cardId, rows: c.items.map((d) => ({ item: d.lines.map((l) => l.name).join(", "), amount: f.day(d.deliveryDate), total: money(d.totalCents) })) });
    else if (c.type === "backup" && c.others.length) lists.push({ key: c.cardId, rows: c.others.map((o) => ({ item: o })) });
    else if (c.type === "memory_list") lists.push({ key: c.cardId, rows: c.items.map((m) => ({ item: m.text })) });
    else if (c.type === "rules" && c.proposal?.approval) continue;
    else if (c.type === "rules") lists.push({ key: c.cardId, rows: c.proposal ? c.diff.map((d) => ({ item: rx.field[d.field] ?? d.field.replaceAll("_", " "), amount: `${ruleValue(d.field, d.before, f.lang) || "—"} → ${ruleValue(d.field, d.after, f.lang) || "—"}` })) : [{ item: tx.rulesAlone, amount: money(c.current.perOrderLimitCents) }, { item: tx.rulesWeek, amount: money(c.current.weeklyBudgetCents) }, ...c.stated.map((s) => ({ item: tx.statedRule(s.text) }))] });
  }
  // A reply that gives a total for the menu or the order on the table ("comes to 23,48 €") always has its lines one tap
  // away, even when the card it changed sits in an earlier turn.
  if (latest && !lists.length && /\d,\d\d\s?€/.test(turn.line ?? "")) {
    const c = thread.turns.flatMap((x) => (x.role === "agent" ? x.cards : [])).filter((x) => (x.type === "menu" && (x.stage === "ready" || x.stage === "ordered")) || (x.type === "sheet" && x.state === "editing")).at(-1);
    if (c?.type === "menu") lists.push({ key: `${c.cardId}:here`, rows: menuRows(c), total: money(c.totalCents) });
    else if (c?.type === "sheet") lists.push({ key: `${c.cardId}:here`, rows: c.lines.map((l) => ({ item: l.name, amount: `${f.num(l.packs)} × ${f.measure(l.packSize, l.unit)}`, total: money(l.lineTotalCents) })), total: money(c.totalCents) });
  }
  return (
    <>
      {lists.filter((l) => l.rows.length).map((l) => (
        <ShortList key={l.key} rows={l.rows} total={l.total} tx={tx} />
      ))}
    </>
  );
}

function ShortList({ rows, total, tx }: { rows: { item: string; amount?: string; total?: string }[]; total?: string; tx: Tx }) {
  // Open from the start: the products, amounts and prices are what the buyer reads; "Hide the list" folds it.
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex min-h-9 items-center gap-1.5 text-[0.84rem] font-medium text-petrol">
        {open ? tx.hideList : tx.list(rows.length)}
        <ChevronDown aria-hidden size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <table className="tl-in mt-1 w-full text-[0.88rem]">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line">
                <td className="py-1.5 pr-2 leading-snug [overflow-wrap:anywhere]">{r.item}</td>
                <td className="py-1.5 pr-3 text-right tabular opacity-70">{r.amount}</td>
                <td className="py-1.5 text-right tabular">{r.total}</td>
              </tr>
            ))}
            {total && (
              <tr>
                <td className="pt-2 font-semibold" colSpan={2}>
                  {tx.total}
                </td>
                <td className="pt-2 text-right font-semibold tabular">{total}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Memory({ turn }: { turn: AgentTurn }) {
  const tx = useText(THREAD_LINE_TEXT);
  const m = turn.cards.find((c) => c.type === "memory");
  if (m?.type !== "memory") return null;
  const open = m.proposals.filter((p) => !p.decided).slice(0, 1);
  const kept = m.proposals.filter((p) => p.decided === "kept");
  if (!open.length && !kept.length) return null;
  return (
    <div className="mt-3 space-y-1">
      {kept.map((p) => (
        <p key={p.itemId} className="flex items-start gap-2 text-[0.88rem] leading-snug text-lavender-deep">
          <Sparkles aria-hidden size={15} className="mt-[0.15em] shrink-0" />
          <span>
            <span className="font-medium">{tx.remembered}:</span> {p.question}
          </span>
        </p>
      ))}
      {open.map((p) => (
        <p key={p.itemId} className="flex items-start gap-2 text-[0.88rem] leading-snug text-lavender-deep">
          <Sparkles aria-hidden size={15} className="mt-[0.15em] shrink-0" />
          <span>
            <span className="font-medium">{tx.canRemember}:</span> {p.question} <span className="text-ink-soft">({tx.sayRemember})</span>
          </span>
        </p>
      ))}
    </div>
  );
}

// ---------- the one action: a person's OK, on the dark slab ----------

function orderOf(thread: Thread, orderId?: string): OrderCard | undefined {
  let found: OrderCard | undefined;
  for (const x of thread.turns) if (x.role === "agent") for (const c of x.cards) if (c.type === "order" && c.orderId === orderId) found = c;
  return found;
}

/** A signer named by role on the test kitchens ("Kitchen manager"), in the buyer's language; a person's name as it is. */
function roleL(name: string, lang: "en" | "fi" | "sv"): string {
  const ROLES: Record<string, Record<"fi" | "sv", string>> = {
    "kitchen manager": { fi: "keittiöpäällikkö", sv: "köksansvarig" },
    "head chef": { fi: "keittiömestari", sv: "kökschef" },
    owner: { fi: "omistaja", sv: "ägare" },
    "food service manager": { fi: "ruokapalvelupäällikkö", sv: "måltidschef" },
    "purchasing manager": { fi: "hankintapäällikkö", sv: "inköpschef" },
  };
  const r = ROLES[name.trim().toLowerCase()];
  return lang === "en" || !r ? name : r[lang];
}

function SignOffSlab({ card, thread, tap, total, what }: { card: GateCardT; thread: Thread; tap: Tap; total?: number; what?: string }) {
  const { account } = usePortal();
  const tx = useText(THREAD_LINE_TEXT);
  const f = useThreadFormat();
  const w = useText(THREAD_WORDS);
  const s = useSignOff(card);
  const order = orderOf(thread, card.orderId);
  const sum = total ?? order?.totalCents;
  // At most three lines on the slab; a longer order says how many and lists them behind the reply's "Show the list".
  const all = order?.lines ?? [];
  const lines = what ?? (all.length > 3 ? tx.many(all.length, all.slice(0, 2).map((l) => l.name).join(", ")) : all.map((l) => `${f.num(l.quantity)} × ${l.name}`).join(", "));
  // The same reason the sentence gives: over the limit by the gate's figures, or the mistake check's own comparison.
  const overLimit = card.rules?.some((r) => r.rule === "per_order_limit" && r.outcome !== "pass");
  const u = thread.turns.flatMap((x) => (x.role === "agent" ? x.cards : [])).find((c) => c.type === "understood" && c.requestId === card.requestId);
  const note = !overLimit && u?.type === "understood" ? (u.notes ?? []).map((n) => w.note[n.code]?.(n.params as Record<string, string | number>, fmtFor(f.lang))).find(Boolean) : undefined;
  const why = note ?? gateReasons(card.rules, card.reasons, w, fmtFor(f.lang), f.lang)[0];
  return (
    <section aria-label={tx.needsOk} data-slab="waiting" className="tl-in mt-4 overflow-hidden rounded-[1.4rem] bg-safety-ink text-paper">
      <div className="hazard-thin h-1.5" />
      <div className="p-4 pt-3.5">
        <p className="text-[0.78rem] font-medium tracking-wide text-safety">{tx.needsOk}</p>
        {sum !== undefined && <p className="display mt-1.5 text-[2.1rem] leading-none tabular">{money(sum)}</p>}
        {lines && <p className="mt-2 text-[0.92rem] leading-snug text-paper/85">{lines}</p>}
        {/* What the person OKs includes what it replaces: a substitute is said on the slab, in one line. */}
        {(() => {
          const sub = order?.lines.find((l) => l.substituteForName);
          return sub ? <p className="mt-1 text-[0.86rem] leading-snug text-safety">{tx.inPlaceOf(sub.substituteForName!.replace(/[®™]/g, "").replace(/novobox/gi, f.lang === "fi" ? "laatikko" : "box"))}</p> : null;
        })()}
        <p className="text-[0.86rem] leading-snug text-paper/55">
          {[order?.deliveryDate ? f.day(order.deliveryDate).replace(/\.$/, "") : "", why].filter(Boolean).join(". ")}
        </p>
        {s.canSignHere && s.phase !== "signed" && account?.shared && card.approver && !card.pressured && (
          <p className="mt-3 text-[0.8rem] leading-snug text-paper/65">{tx.testSigner(roleL(card.approver.name, f.lang))}</p>
        )}
        {card.pressured && s.phase !== "signed" && s.offerPhone ? (
          // The buyer asked to skip the limit or said the manager already agreed: the OK is the manager's own, on the
          // manager's own device, so the first action sends it there; the same-screen OK is not offered.
          <button type="button" onClick={() => void s.toPhone()} className="mt-4 flex min-h-13 w-full items-center justify-center gap-2.5 rounded-full bg-lime text-[1rem] font-semibold text-ink transition-transform active:scale-[0.98]">
            {s.phone ? tx.hidePhone : tx.toPhoneOf(card.approver ? roleL(card.approver.name, f.lang) : "")}
          </button>
        ) : s.canSignHere && s.phase !== "signed" ? (
          <button type="button" disabled={s.busy} onClick={() => void s.sign()} className="mt-4 flex min-h-13 w-full items-center justify-center gap-2.5 rounded-full bg-lime text-[1rem] font-semibold text-ink transition-transform active:scale-[0.98] disabled:opacity-70">
            <ScanFace aria-hidden size={21} />
            {s.busy ? tx.okWorking : tx.ok}
          </button>
        ) : s.phase === "signed" ? (
          <p className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-full bg-paper/10 text-[0.95rem] font-semibold text-lime">
            <Check aria-hidden size={18} strokeWidth={2.6} /> {tx.okDone(clock(new Date()))}
          </p>
        ) : (
          <p className="mt-4 text-[0.9rem] text-paper/75">{card.approver ? tx.waitsFor(roleL(card.approver.name, f.lang)) : s.where}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-x-4">
          {s.offerPhone && s.phase !== "signed" && !card.pressured && (
            <button type="button" onClick={() => void s.toPhone()} className="min-h-9 text-[0.84rem] text-paper/60 underline underline-offset-4 hover:text-paper">
              {s.phone ? tx.hidePhone : tx.toPhone}
            </button>
          )}
          {card.orderId && s.phase !== "signed" && (
            <button type="button" onClick={() => tap({ type: "withdraw", orderId: card.orderId! }, tx.takeBack)} className="min-h-9 text-[0.84rem] text-paper/60 underline underline-offset-4 hover:text-paper">
              {tx.takeBack}
            </button>
          )}
        </div>
        {s.problem && <p className="mt-2 text-[0.88rem] text-safety">{s.problem}</p>}
        {s.phone && (
          <div className="mt-3 flex items-center gap-3 rounded-xl bg-paper p-3 text-ink">
            <span aria-hidden className="block size-32 shrink-0 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: s.phone.qrSvg }} />
            <a className="text-[0.88rem] font-semibold text-petrol underline underline-offset-4" href={s.phone.url}>
              {s.phone.url.replace(/^https?:\/\//, "").slice(0, 40)}
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

function SignedSlab({ card, thread }: { card: GateCardT; thread: Thread }) {
  const tx = useText(THREAD_LINE_TEXT);
  const f = useThreadFormat();
  const order = orderOf(thread, card.orderId);
  return (
    <section aria-label={tx.okd} data-slab="signed" className="tl-in mt-4 overflow-hidden rounded-[1.4rem] bg-safety-ink text-paper">
      <div className="p-4">
        <p className="text-[0.78rem] font-medium tracking-wide text-paper/55">{tx.okd}</p>
        {order && <p className="display mt-1.5 text-[2.1rem] leading-none tabular">{money(order.totalCents)}</p>}
        {order && <p className="mt-2 text-[0.92rem] leading-snug text-paper/85">{order.lines.length > 3 ? tx.many(order.lines.length, order.lines.slice(0, 2).map((l) => l.name).join(", ")) : order.lines.map((l) => `${f.num(l.quantity)} × ${l.name}`).join(", ")}</p>}
        <p className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-full bg-paper/10 text-[0.95rem] font-semibold text-lime">
          <Check aria-hidden size={18} strokeWidth={2.6} /> {card.approver ? tx.okBy(roleL(card.approver.name, f.lang)) : tx.okDone("")}
        </p>
      </div>
    </section>
  );
}

// ---------- the agent's work: "N steps", shown quietly ----------

function Steps({ steps, orderId }: { steps: Think[]; orderId?: string }) {
  const tx = useText(THREAD_LINE_TEXT);
  // Shown from the start, set quieter than the reply: smaller, grey, indented under a thin rule, so the work is there
  // to read without competing with what the agent said. "N steps" folds it away.
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex min-h-8 items-center gap-1.5 rounded-full text-[0.76rem] font-medium text-ink-soft/80 transition-colors hover:text-petrol">
        <span className="tabular">{tx.steps(steps.length)}</span>
        <ChevronDown aria-hidden size={13} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ol className="ml-1 mt-0.5 space-y-1.5 border-l border-line pl-3.5">
          {steps.map((s, i) => (
            <li key={i} className="relative pl-3.5">
              <span aria-hidden className={`absolute left-0 top-[0.5em] size-1.5 rounded-full opacity-70 ${TONE[s.tone ?? "plain"]}`} />
              <p className="max-w-[46ch] text-[0.78rem] leading-snug text-ink-soft/90">
                <span className="font-medium text-ink-soft">{s.label}.</span> {s.detail && <span>{s.detail}</span>}
              </p>
            </li>
          ))}
          {/* The same order on the wholesaler's side (the operations portal, open to look at): one quiet link. */}
          {orderId && (
            <li className="relative pl-5">
              <a href={`/ops/orders/${encodeURIComponent(orderId)}`} target="_blank" rel="noreferrer" className="text-[0.84rem] text-petrol underline decoration-petrol/40 underline-offset-4 hover:decoration-petrol">
                {tx.asWholesaler}
              </a>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}

/** The agent's work in this turn, as a person would tell it: from the engine's cards and steps, never from the model. */
function thinking(turn: AgentTurn, thread: Thread, tx: Tx, w: (typeof THREAD_WORDS)["en"], f: ReturnType<typeof useFormat>): Think[] {
  const out: Think[] = [];
  const wf = fmtFor(f.lang);
  for (const c of turn.cards) {
    switch (c.type) {
      case "offer":
        out.push({ label: tx.step.offer, detail: c.steps.join(" "), tone: "live" });
        break;
      case "scenario":
        out.push({ label: c.kind === "event" ? tx.step.event : tx.step.season, detail: c.steps.slice(0, 12).join(" "), tone: "live" });
        break;
      case "backup":
        out.push({ label: tx.step.backup, detail: c.steps.join(" "), tone: "live" });
        break;
      case "watch":
        out.push({ label: tx.step.watch, detail: [...c.steps, ...(c.others?.length ? [c.others.join(" · ")] : [])].join(" "), tone: "live" });
        break;
      case "understood": {
        const bits = [c.amount ? f.measure(c.amount.amount, c.amount.unit) : "", c.item, c.claims.map((x) => f.attr(x)).filter((a) => !c.item.toLowerCase().includes(a.toLowerCase())).join(", "), c.deliverOn ? f.day(c.deliverOn) : c.deliverBy ? f.day(c.deliverBy) : ""].filter(Boolean);
        out.push({ label: tx.step.read, detail: bits.join(", ") });
        const mem = (c.memory?.length ? c.memory : c.memoryUsed).map((m) => memoryText(m, w, wf, f.lang)).filter((x): x is string => !!x);
        const notes = (c.notes ?? []).map((n) => w.note[n.code]?.(n.params, wf)).filter((x): x is string => !!x);
        if (mem.length || notes.length) out.push({ label: tx.step.history, detail: [...mem, ...notes].slice(0, 2).join(" "), tone: "memory" });
        break;
      }
      case "dishes": {
        // Why an ingredient is taken as already in the kitchen: the basis, in the steps (the reply only says "already in your kitchen").
        const have = c.dishes.flatMap((d) => d.items).filter((i) => i.note?.code === "have");
        for (const basis of ["staple", "on_hand", "chef"] as const) {
          const names = have.filter((i) => i.note?.basis === basis).map((i) => i.name[f.lang].toLowerCase());
          if (names.length) out.push({ label: tx.step.have[basis], detail: names.join(", "), tone: "kept" });
        }
        break;
      }
      case "anomaly":
        out.push({ label: tx.step.history, detail: c.concerns.map((k) => concernText(k, w, wf, f.lang)).join(" "), tone: "memory" });
        break;
      case "options": {
        const prices = c.options.map((o) => o.totalCents);
        const days = [...new Set(c.options.map((o) => o.deliveryDate))];
        out.push({ label: tx.step.searched, detail: c.options.map((o) => titleOf(o, w)).slice(0, 3).join(" · ") });
        out.push({ label: tx.step.live(c.options.length), detail: [days.length === 1 ? tx.step.allBy(f.day(days[0]).replace(/\.$/, "")) : "", prices.length ? tx.step.cheapest(money(Math.min(...prices))) : ""].filter(Boolean).join(" "), tone: "live" });
        const left = leftOutGroups(c, w, f.lang);
        const n = left.reduce((s, g) => s + g.count, 0);
        // Each reason with its count, and the rest counted, so the figures add up; a sentence, capitalised.
        const shown = left.slice(0, 3);
        const rest = n - shown.reduce((x, g) => x + g.count, 0);
        const detail = [...shown.map((g) => `${g.label} (${g.count})`), ...(rest > 0 ? [tx.step.otherReasons(rest)] : [])].join("; ");
        if (n) out.push({ label: tx.step.leftOut(n), detail: detail.charAt(0).toUpperCase() + detail.slice(1), tone: "left" });
        break;
      }
      case "price":
        out.push({ label: tx.step.held(clock(c.expiresAt)), detail: tx.step.heldDetail, tone: "kept" });
        break;
      case "gate": {
        const reasons = gateReasons(c.rules, c.reasons, w, wf, f.lang);
        out.push({ label: c.outcome === "waiting" ? tx.step.waiting : tx.step.rules, detail: reasons.join(" ") || (c.outcome === "placed_alone" ? tx.step.insideRules : undefined), tone: "rule" });
        break;
      }
      case "sheet":
        out.push({ label: tx.step.sheet, detail: `${c.lines.map((l) => l.name).slice(0, 3).join(", ")} · ${money(c.totalCents)} · ${f.day(c.deliveryDate)}`, tone: "kept" });
        if (c.gate) out.push({ label: tx.step.rules, detail: gateReasons(c.gate.rules, c.gate.reasons, w, wf, f.lang).join(" ") || tx.step.insideRules, tone: "rule" });
        break;
      case "menu":
        if (c.dishes.length) out.push({ label: tx.step.menu, detail: c.dishes.map((d) => d.name).join(", ") });
        break;
      case "records":
        out.push({ label: tx.step.records });
        break;
      case "rules":
        out.push({ label: tx.step.rulesRead, tone: "rule" });
        break;
      case "order":
        if (c.status === "committed") out.push({ label: tx.step.ordered, detail: f.day(c.deliveryDate), tone: "kept" });
        break;
    }
  }
  for (const s of turn.steps as ThreadStep[]) if (s.status === "failed") out.push({ label: tx.step.failed, detail: stepLabel(s, w, f.lang), tone: "left" });
  void thread;
  return out;
}

// ---------- words when the agent wrote none (a pause, a refused sentence): from the cards ----------

function fallbackLine(turn: AgentTurn, thread: Thread, tx: Tx, f: ReturnType<typeof useFormat>): string {
  for (const c of [...turn.cards].reverse()) {
    if (c.type === "gate" && c.outcome === "waiting") return tx.fallback.waiting(roleL(c.approver?.name ?? "", f.lang));
    if (c.type === "order" && c.status === "committed") return tx.fallback.ordered(f.day(c.deliveryDate));
    if (c.type === "sheet" && c.state === "editing") return tx.fallback.sheet(money(c.totalCents), f.day(c.deliveryDate));
    if (c.type === "options" && !c.chosen) {
      const n = c.options.filter((o) => o.gate?.outcome !== "reject").length;
      return n === 1 ? tx.fallback.one : tx.fallback.options(n);
    }
    if (c.type === "menu") return c.stage === "choose" ? tx.fallback.menus : c.stage === "ready" ? tx.fallback.menu : tx.fallback.planning;
    if (c.type === "records") return tx.fallback.records;
    if (c.type === "rules") return tx.fallback.rules;
    if (c.type === "products") return tx.fallback.products;
    if (c.type === "gate" && c.said) return c.said[f.lang];
    if (c.type === "notice" && c.said) return c.said[f.lang];
    // The engine's own notice, short: its first two sentences, without product codes.
    if (c.type === "notice") return c.message.replace(/\s*\([A-Z]{2}-\d{3,}\)/g, "").split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 280);
  }
  void thread;
  return "";
}

// ---------- the landing: Paper-style text ----------

/** An amount as the replies write it: "8 l", "12 kg", "20 pcs" (kpl, st), with a space and a lower-case litre. */
function amountWord(n: number, unit: string, f: ReturnType<typeof useFormat>): string {
  const u = unit === "L" || unit === "l" ? "l" : unit === "pcs" ? ({ en: "pcs", fi: "kpl", sv: "st" } as const)[f.lang] : unit;
  return `${f.num(n)} ${u}`;
}

function todaySentence(card: TodayCard, tx: Tx, f: ReturnType<typeof useFormat>): string {
  if (card.pending) return "";
  const parts: string[] = [];
  let asked = false;
  for (const i of card.items.slice(0, 3)) {
    if (i.kind === "sign_off") {
      // Several waiting: one sentence for all of them, the newest one's slab under it (WaitingSlabs).
      const waiting = card.items.filter((x) => x.kind === "sign_off");
      if (waiting.length > 1 && i !== waiting[0]) continue;
      parts.push(waiting.length > 1 ? tx.today.signOffMany(waiting.length, money(i.totalCents)) : tx.today.signOff(money(i.totalCents), ""));
    }
    else if (i.kind === "cutoff") parts.push(tx.today.cutoff(i.name, clock(i.orderBy)));
    else if (i.kind === "drift") {
      // What changed, with its figures, and the one question a yes answers (the next one at the usual amount): only
      // for the first drift, and only when nothing waits for a person's OK.
      const ask = !asked && !card.items.some((x) => x.kind === "sign_off") && !!i.nextDue;
      if (ask) asked = true;
      parts.push(tx.today.drift({ what: familyL(i.family, f.lang).toLowerCase(), usual: amountWord(i.usual.amount, i.usual.unit, f), amountPct: i.amountPct, pricePct: i.pricePct, ...(ask && i.nextDue ? { day: f.day(i.nextDue).replace(/\.$/, "") } : {}) }));
    }
    else if (i.kind === "recall") parts.push(tx.today.recall(i.productName));
    else if (i.kind === "delivery") parts.push(tx.today.delivery(f.day(i.deliveryDate)));
  }
  if (card.items.length > 3) parts.push(tx.today.more(card.items.length - 3));
  return parts.length ? parts.join(" ") : tx.today.none;
}

/** The wholesaler's offer, in the words plain code wrote from the signed offer: its sentence and its question. */
function OfferWords({ card, lang, big }: { card: OfferCard; lang: "en" | "fi" | "sv"; big?: boolean }) {
  const t = card.text[lang] ?? card.text.en;
  return (
    <p data-offer={card.offerId} className={`mt-3 max-w-[38ch] leading-[1.6] text-ink [text-wrap:pretty] ${big ? "text-[1.1rem]" : "text-[1.02rem]"}`}>
      <Rich text={`${t.say} ${t.ask}`} />
    </p>
  );
}

/** A menu scenario's words (a seasonal menu, a booking at short notice): its sentences and its question. */
function ScenarioWords({ card, lang }: { card: ScenarioCard; lang: "en" | "fi" | "sv" }) {
  const t = card.text[lang] ?? card.text.en;
  return (
    <p data-scenario={card.planId} className="mt-3 max-w-[38ch] text-[1.02rem] leading-[1.6] text-ink [text-wrap:pretty]">
      <Rich text={`${t.say} ${t.ask}`} />
    </p>
  );
}

/** The watch's moment, in the kitchen's short names: its sentence and its question. */
function WatchWords({ card, lang, big }: { card: WatchCard; lang: "en" | "fi" | "sv"; big?: boolean }) {
  const t = card.text[lang] ?? card.text.en;
  return (
    <p data-watch={card.momentId} className={`mt-3 max-w-[38ch] leading-[1.6] text-ink [text-wrap:pretty] ${big ? "text-[1.1rem]" : "text-[1.02rem]"}`}>
      <Rich text={`${t.say}${t.ask ? ` ${t.ask}` : ""}`} />
    </p>
  );
}

function Landing({ today, offer, watch, thread }: { today?: TodayCard; offer?: OfferCard; watch?: WatchCard; thread?: Thread }) {
  const tx = useText(THREAD_LINE_TEXT);
  const f = useThreadFormat();
  const { kitchen, thread: api, lang, account } = usePortal();
  const demoOwn = !!account?.demo && account.kitchen === kitchen.slug;
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/Helsinki" }).format(new Date()));
  const part = h < 11 ? "morning" : h < 18 ? "day" : "evening";
  const who = kitchen.mandate.approvers[0]?.name ?? "";
  const first = /^[A-ZÅÄÖ][a-zåäö]+ [A-ZÅÄÖ]/.test(who) ? who.split(" ")[0] : "";
  return (
    <div className="tl-in">
      <h1 className="display text-[2.2rem] leading-[1.05] text-ink">{tx.greeting(part, first)}</h1>
      {today?.pending && <p aria-busy className="tl-sheen mt-3 text-[0.98rem] font-medium text-petrol">{tx.lookingToday}</p>}
      {today && !today.pending && !(today.items.length === 0 && (watch || offer)) && (
        <p className="mt-3 max-w-[34ch] text-[1.1rem] leading-[1.6] text-ink">
          {/* A demo account with nothing yet: what the agent is, in one sentence (the guide's link sits above). */}
          <Rich text={today.items.length === 0 && demoOwn ? tx.today.intro : todaySentence(today, tx, f)} />
        </p>
      )}
      {watch && watch.state !== "answered" && <WatchWords card={watch} lang={f.lang} big />}
      {offer?.state === "open" && <OfferWords card={offer} lang={f.lang} big />}
      {today && thread && <WaitingSlabs today={today} thread={thread} tap={(action, label) => void api.submit({ door: "typed", via: "tap", action, label, lang })} />}
      <ul className="mt-6 flex flex-col gap-1.5">
        {/* A demo account with nothing yet has no "last week": a first order, a menu, and what to try. */}
        {(demoOwn && today && !today.pending && today.items.length === 0 ? tx.examplesNew : tx.examples).map((e) => (
          <li key={e}>
            <button type="button" onClick={() => void api.submit({ door: "typed", via: "typed", text: e, lang })} className="text-left text-[0.92rem] text-ink-soft transition-colors hover:text-petrol">
              “{e}”
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
