"use client";

import { Check, ChevronDown, ScanFace, Sparkles } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { useFormat, useText } from "../../_i18n/provider";
import { clock, money } from "../../_ui/plain";
import type { AgentTurn, BuyerTurn, GateCard as GateCardT, OfferCard, OptionView, OrderCard, Thread, ThreadAction, ThreadStep, TodayCard } from "@/server/thread/types";
import { usePortal } from "./portal";
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
          <Fragment key={i}>{p}</Fragment>
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

  return (
    <div className={`relative ${className}`}>
      <span aria-hidden className={`absolute bottom-0 left-[0.6rem] top-0 w-px origin-top transition-colors ${working ? "tl-draw bg-gradient-to-b from-petrol via-petrol to-lime" : "bg-petrol/30"}`} />
      <ol role="log" aria-live="polite" aria-label="Conversation with the purchasing agent" className={`relative flex flex-col gap-7 pl-9 ${onlyOpening && landing ? "min-h-[50dvh] justify-end" : ""}`}>
        {onlyOpening && landing ? (
          <li>
            <Landing today={opening?.cards.find((c): c is TodayCard => c.type === "today")} offer={opening?.cards.find((c): c is OfferCard => c.type === "offer")} thread={t} />
          </li>
        ) : (
          turns.map((x) =>
            x.role === "agent" && x === opening && !onlyOpening && !x.cards.some((c) => (c.type === "today" && c.items.length > 0) || c.type === "offer") ? null : x.role === "buyer" ? (
              <BuyerLine key={x.turnId} turn={x} />
            ) : (
              <AgentNode key={x.turnId} turn={x} thread={t!} tap={tap} busy={api.posting} latest={x === lastAgent} />
            ),
          )
        )}
        {api.pending.map((p) => (
          <Fragment key={p.turnId}>
            <BuyerLine turn={p} />
            <WorkingNode label={undefined} />
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
  return (
    <li className="tl-in relative">
      <span aria-hidden className="absolute -left-[2.05rem] top-[0.45em] z-10 size-2.5 rounded-full border-2 border-petrol bg-mist" />
      <p className="display whitespace-pre-line text-[1.2rem] leading-tight text-petrol-deep [overflow-wrap:anywhere]">{text}</p>
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

// ---------- one reply of the agent ----------

function AgentNode({ turn, thread, tap, busy, latest }: { turn: AgentTurn; thread: Thread; tap: Tap; busy: boolean; latest: boolean }) {
  const tx = useText(THREAD_LINE_TEXT);
  const w = useText(THREAD_WORDS);
  const f = useFormat();
  const cards = turn.cards;
  const today = cards.find((c): c is TodayCard => c.type === "today");
  const running = turn.steps.findLast((s) => s.status === "running");
  if (turn.status === "working" && !turn.line && !cards.some((c) => c.type !== "understood")) return <WorkingNode label={running ? stepLabel(running, w, f.lang) : undefined} />;
  const text = turn.line || (today ? todaySentence(today, tx, f) : fallbackLine(turn, thread, tx, f));
  const thinks = thinking(turn, thread, tx, w, f);
  return (
    <li className="tl-in relative">
      <span aria-hidden className={`absolute -left-[2.35rem] top-[0.3em] flex size-[1.15rem] items-center justify-center rounded-full ${turn.status === "working" ? "tl-pulse bg-lime" : "bg-petrol"}`}>
        {turn.status !== "working" && <span className="size-1.5 rounded-full bg-lime" />}
      </span>
      {text && (
        <p data-agent-words={wordsOf(text)} className="max-w-[38ch] whitespace-pre-line text-[1.02rem] leading-[1.6] text-ink [text-wrap:pretty]">
          <Rich text={text} />
        </p>
      )}
      {turn.status === "working" && running && <p className="tl-sheen mt-1 text-[0.9rem] font-medium text-petrol">{stepLabel(running, w, f.lang)}</p>}
      {cards.map((c) => (c.type === "offer" && c.state === "open" && !(turn.line ?? "").includes(c.text[f.lang].say.slice(0, 24)) ? <OfferWords key={c.cardId} card={c} lang={f.lang} /> : null))}
      {latest && <Choices turn={turn} thread={thread} tap={tap} busy={busy} />}
      <Lists turn={turn} thread={thread} />
      <Memory turn={turn} />
      {cards.map((c) => (c.type === "gate" && c.outcome === "waiting" && c.approvalId ? <SignOffSlab key={c.cardId} card={c} thread={thread} tap={tap} /> : c.type === "gate" && c.outcome === "approved" && c.orderId ? <SignedSlab key={c.cardId} card={c} thread={thread} /> : null))}
      {today?.items.filter((i) => i.kind === "sign_off").map((i) => (i.kind === "sign_off" ? <SignOffSlab key={i.approvalId} card={{ type: "gate", cardId: `gate:${i.orderId}`, requestId: i.requestId ?? "", orderId: i.orderId, approvalId: i.approvalId, outcome: "waiting", approver: i.approver, reasons: [], rules: [] } as GateCardT} thread={thread} tap={tap} total={i.totalCents} what={i.lines.map((l) => `${f.num(l.quantity)} × ${l.name}`).join(", ")} /> : null))}
      {thinks.length > 0 && <Steps steps={thinks} />}
    </li>
  );
}

// ---------- choices: at most three, only for a real choice ----------

function Choices({ turn, thread, tap, busy }: { turn: AgentTurn; thread: Thread; tap: Tap; busy: boolean }) {
  const tx = useText(THREAD_LINE_TEXT);
  const w = useText(THREAD_WORDS);
  const f = useFormat();
  const wf = fmtFor(f.lang);
  const rows: { key: string; title: string; price?: string; differs?: string; action: ThreadAction }[] = [];
  for (const c of turn.cards) {
    if (rows.length) break;
    if (c.type === "options" && !c.chosen && !c.adjusted && !answeredAfter(thread, turn)) {
      const lead = leadOption(c);
      const usable = c.options.filter((o) => o.gate?.outcome !== "reject");
      const ordered = [lead, ...usable.filter((o) => o.optionId !== lead.optionId)].slice(0, 3);
      if (ordered.length > 1) for (const o of ordered) rows.push({ key: o.optionId, title: titleOf(o, w), price: money(o.totalCents), differs: o.optionId === lead.optionId ? perUnitOf(o, f) : oneThing(o, lead, w, wf), action: { type: "choose", requestId: c.requestId, optionId: o.optionId } });
    } else if (c.type === "menu" && c.stage === "choose" && !c.sheetId) {
      for (const p of c.proposals.slice(0, 3)) rows.push({ key: p.proposalId, title: p.title, ...(p.costPerCoverCents ? { price: `${money(p.costPerCoverCents)}` } : {}), differs: p.dishes.join(", "), action: { type: "menu_choose", planId: c.planId, proposalId: p.proposalId } });
    } else if (c.type === "question") {
      const q = c.questions.find((x) => !c.answered?.[x.id]);
      if (q) for (const o of q.options.slice(0, 3)) rows.push({ key: o.id, title: o.label, action: { type: "answer", requestId: c.requestId, questionId: q.id, optionId: o.id } });
    } else if (c.type === "anomaly" && !c.answered) {
      const k = c.concerns[0];
      if (k) {
        if (k.confirmable) rows.push({ key: "confirm", title: concernText(k, w, wf, f.lang), differs: w.correction.keep, action: { type: "concern", requestId: c.requestId, key: k.key, choice: "confirm" } });
        for (const x of k.corrections.slice(0, 2)) rows.push({ key: x.id, title: correctionLabel(x, w, wf, f.lang), action: { type: "concern", requestId: c.requestId, key: k.key, choice: x.id } });
      }
    }
  }
  if (!rows.length) return null;
  return (
    <div className="mt-3">
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <button key={r.key} type="button" disabled={busy} onClick={() => tap(r.action, r.title)} className="group flex items-baseline gap-3 rounded-xl bg-paper/70 px-3 py-2 text-left transition-colors hover:bg-paper disabled:opacity-60">
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

// ---------- the order's lines, behind "Show the list" ----------

function Lists({ turn, thread }: { turn: AgentTurn; thread: Thread }) {
  const tx = useText(THREAD_LINE_TEXT);
  const f = useFormat();
  const lists: { key: string; rows: { item: string; amount?: string; total?: string }[]; total?: string }[] = [];
  const fromSheet = new Set(thread.turns.flatMap((x) => (x.role === "agent" ? x.cards.flatMap((c) => (c.type === "sheet" && c.orderId ? [c.orderId] : [])) : [])));
  for (const c of turn.cards) {
    if (c.type === "sheet") lists.push({ key: c.cardId, rows: c.lines.map((l) => ({ item: l.name, amount: `${f.num(l.packs)} × ${f.measure(l.packSize, l.unit)}`, total: money(l.lineTotalCents) })), total: money(c.totalCents) });
    else if (c.type === "order" && !fromSheet.has(c.orderId) && c.lines.length > 1) lists.push({ key: c.cardId, rows: c.lines.map((l) => ({ item: l.name, amount: f.num(l.quantity), ...(l.unitPriceCents !== undefined ? { total: money(l.unitPriceCents * l.quantity) } : {}) })), total: money(c.totalCents) });
    else if (c.type === "menu" && (c.stage === "ready" || c.stage === "ordered")) lists.push({ key: c.cardId, rows: c.dishes.flatMap((d) => d.lines.filter((l) => l.product).map((l) => ({ item: `${l.product!.name}`, amount: f.num(l.product!.packs), total: money(l.product!.totalCents) }))), total: money(c.totalCents) });
    else if (c.type === "records") lists.push({ key: c.cardId, rows: c.rows.map((r) => ({ item: r.label, ...(r.date ? { amount: f.day(r.date) } : {}), ...(r.totalCents !== undefined ? { total: money(r.totalCents) } : {}) })) });
    else if (c.type === "products") lists.push({ key: c.cardId, rows: c.products.map((p) => ({ item: p.name, amount: f.measure(p.packSize, p.unit) })) });
    else if (c.type === "standing") lists.push({ key: c.cardId, rows: c.items.map((i) => ({ item: i.name, amount: `${f.measure(i.usual.amount, i.usual.unit)} · ${f.weekdays(i.weekdays)}` })) });
    else if (c.type === "deliveries") lists.push({ key: c.cardId, rows: c.items.map((d) => ({ item: d.lines.map((l) => l.name).join(", "), amount: f.day(d.deliveryDate), total: money(d.totalCents) })) });
    else if (c.type === "memory_list") lists.push({ key: c.cardId, rows: c.items.map((m) => ({ item: m.text })) });
    else if (c.type === "rules") lists.push({ key: c.cardId, rows: c.proposal ? c.diff.map((d) => ({ item: d.field.replaceAll("_", " "), amount: `${d.before || "—"} → ${d.after || "—"}` })) : [{ item: tx.sections.rules, amount: `${money(c.current.perOrderLimitCents)} / ${money(c.current.weeklyBudgetCents)}` }, ...c.stated.map((s) => ({ item: s.text }))] });
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
  const [open, setOpen] = useState(false);
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

function SignOffSlab({ card, thread, tap, total, what }: { card: GateCardT; thread: Thread; tap: Tap; total?: number; what?: string }) {
  const tx = useText(THREAD_LINE_TEXT);
  const f = useFormat();
  const w = useText(THREAD_WORDS);
  const s = useSignOff(card);
  const order = orderOf(thread, card.orderId);
  const sum = total ?? order?.totalCents;
  // At most three lines on the slab; a longer order says how many and lists them behind the reply's "Show the list".
  const all = order?.lines ?? [];
  const lines = what ?? (all.length > 3 ? tx.many(all.length, all.slice(0, 2).map((l) => l.name).join(", ")) : all.map((l) => `${f.num(l.quantity)} × ${l.name}`).join(", "));
  const why = gateReasons(card.rules, card.reasons, w, fmtFor(f.lang), f.lang)[0];
  return (
    <div className="tl-in mt-4 overflow-hidden rounded-[1.4rem] bg-safety-ink text-paper">
      <div className="hazard-thin h-1.5" />
      <div className="p-4 pt-3.5">
        <p className="text-[0.78rem] font-medium tracking-wide text-safety">{tx.needsOk}</p>
        {sum !== undefined && <p className="display mt-1.5 text-[2.1rem] leading-none tabular">{money(sum)}</p>}
        {lines && <p className="mt-2 text-[0.92rem] leading-snug text-paper/85">{lines}</p>}
        <p className="text-[0.86rem] leading-snug text-paper/55">
          {[order?.deliveryDate ? f.day(order.deliveryDate).replace(/\.$/, "") : "", why].filter(Boolean).join(". ")}
        </p>
        {s.canSignHere && s.phase !== "signed" ? (
          <button type="button" disabled={s.busy} onClick={() => void s.sign()} className="mt-4 flex min-h-13 w-full items-center justify-center gap-2.5 rounded-full bg-lime text-[1rem] font-semibold text-ink transition-transform active:scale-[0.98] disabled:opacity-70">
            <ScanFace aria-hidden size={21} />
            {s.busy ? tx.okWorking : tx.ok}
          </button>
        ) : s.phase === "signed" ? (
          <p className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-full bg-paper/10 text-[0.95rem] font-semibold text-lime">
            <Check aria-hidden size={18} strokeWidth={2.6} /> {tx.okDone(clock(new Date()))}
          </p>
        ) : (
          <p className="mt-4 text-[0.9rem] text-paper/75">{card.approver ? tx.waitsFor(card.approver.name) : s.where}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-x-4">
          {s.offerPhone && s.phase !== "signed" && (
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
    </div>
  );
}

function SignedSlab({ card, thread }: { card: GateCardT; thread: Thread }) {
  const tx = useText(THREAD_LINE_TEXT);
  const f = useFormat();
  const order = orderOf(thread, card.orderId);
  return (
    <div className="tl-in mt-4 overflow-hidden rounded-[1.4rem] bg-safety-ink text-paper">
      <div className="p-4">
        <p className="text-[0.78rem] font-medium tracking-wide text-paper/55">{tx.needsOk}</p>
        {order && <p className="display mt-1.5 text-[2.1rem] leading-none tabular">{money(order.totalCents)}</p>}
        {order && <p className="mt-2 text-[0.92rem] leading-snug text-paper/85">{order.lines.length > 3 ? tx.many(order.lines.length, order.lines.slice(0, 2).map((l) => l.name).join(", ")) : order.lines.map((l) => `${f.num(l.quantity)} × ${l.name}`).join(", ")}</p>}
        <p className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-full bg-paper/10 text-[0.95rem] font-semibold text-lime">
          <Check aria-hidden size={18} strokeWidth={2.6} /> {card.approver ? tx.okBy(card.approver.name) : tx.okDone("")}
        </p>
      </div>
    </div>
  );
}

// ---------- the agent's work, folded: "N steps" ----------

function Steps({ steps }: { steps: Think[] }) {
  const tx = useText(THREAD_LINE_TEXT);
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2.5">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full text-[0.8rem] font-medium text-ink-soft transition-colors hover:text-petrol">
        <span className="tabular">{tx.steps(steps.length)}</span>
        <ChevronDown aria-hidden size={14} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ol className="mt-1 space-y-2.5">
          {steps.map((s, i) => (
            <li key={i} className="tl-in relative pl-5" style={{ animationDelay: `${i * 50}ms` }}>
              <span aria-hidden className="absolute -left-[2.85rem] top-[0.62em] h-px w-[2.85rem] bg-line-strong" />
              <span aria-hidden className={`absolute left-0 top-[0.42em] size-2 rounded-full ${TONE[s.tone ?? "plain"]}`} />
              <p className="text-[0.86rem] leading-snug text-ink">
                <span className="font-medium">{s.label}.</span> {s.detail && <span className="text-ink-soft">{s.detail}</span>}
              </p>
            </li>
          ))}
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
      case "understood": {
        const bits = [c.amount ? f.measure(c.amount.amount, c.amount.unit) : "", c.item, c.claims.map((x) => f.attr(x)).join(", "), c.deliverOn ? f.day(c.deliverOn) : c.deliverBy ? f.day(c.deliverBy) : ""].filter(Boolean);
        out.push({ label: tx.step.read, detail: bits.join(", ") });
        const mem = (c.memory?.length ? c.memory : c.memoryUsed).map((m) => memoryText(m, w, wf, f.lang)).filter((x): x is string => !!x);
        const notes = (c.notes ?? []).map((n) => w.note[n.code]?.(n.params, wf)).filter((x): x is string => !!x);
        if (mem.length || notes.length) out.push({ label: tx.step.history, detail: [...mem, ...notes].slice(0, 2).join(" "), tone: "memory" });
        break;
      }
      case "anomaly":
        out.push({ label: tx.step.history, detail: c.concerns.map((k) => concernText(k, w, wf, f.lang)).join(" "), tone: "memory" });
        break;
      case "options": {
        const prices = c.options.map((o) => o.totalCents);
        const days = [...new Set(c.options.map((o) => o.deliveryDate))];
        out.push({ label: tx.step.searched, detail: c.options.map((o) => titleOf(o, w)).slice(0, 3).join(" · ") });
        out.push({ label: tx.step.live(c.options.length), detail: [days.length === 1 ? tx.step.allBy(f.day(days[0])) : "", prices.length ? tx.step.cheapest(money(Math.min(...prices))) : ""].filter(Boolean).join(" "), tone: "live" });
        const left = leftOutGroups(c, w, f.lang);
        const n = left.reduce((s, g) => s + g.count, 0);
        if (n) out.push({ label: tx.step.leftOut(n), detail: left.slice(0, 2).map((g) => `${g.label} (${g.count})`).join("; "), tone: "left" });
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
    if (c.type === "gate" && c.outcome === "waiting") return tx.fallback.waiting(c.approver?.name ?? "");
    if (c.type === "order" && c.status === "committed") return tx.fallback.ordered(f.day(c.deliveryDate));
    if (c.type === "sheet" && c.state === "editing") return tx.fallback.sheet(money(c.totalCents), f.day(c.deliveryDate));
    if (c.type === "options" && !c.chosen) return tx.fallback.options(c.options.length);
    if (c.type === "menu") return c.stage === "choose" ? tx.fallback.menus : c.stage === "ready" ? tx.fallback.menu : tx.fallback.planning;
    if (c.type === "records") return tx.fallback.records;
    if (c.type === "rules") return tx.fallback.rules;
    if (c.type === "products") return tx.fallback.products;
    if (c.type === "notice") return c.message;
  }
  void thread;
  return "";
}

// ---------- the landing: Paper-style text ----------

function todaySentence(card: TodayCard, tx: Tx, f: ReturnType<typeof useFormat>): string {
  if (card.pending) return "";
  const parts: string[] = [];
  for (const i of card.items.slice(0, 3)) {
    if (i.kind === "sign_off") parts.push(tx.today.signOff(money(i.totalCents), ""));
    else if (i.kind === "cutoff") parts.push(tx.today.cutoff(i.name, clock(i.orderBy)));
    else if (i.kind === "drift") parts.push(tx.today.drift(i.name));
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

function Landing({ today, offer, thread }: { today?: TodayCard; offer?: OfferCard; thread?: Thread }) {
  const tx = useText(THREAD_LINE_TEXT);
  const f = useFormat();
  const { kitchen, thread: api, lang } = usePortal();
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/Helsinki" }).format(new Date()));
  const part = h < 11 ? "morning" : h < 18 ? "day" : "evening";
  const who = kitchen.mandate.approvers[0]?.name ?? "";
  const first = /^[A-ZÅÄÖ][a-zåäö]+ [A-ZÅÄÖ]/.test(who) ? who.split(" ")[0] : "";
  return (
    <div className="tl-in">
      <h1 className="display text-[2.2rem] leading-[1.05] text-ink">{tx.greeting(part, first)}</h1>
      {today && !today.pending && (
        <p className="mt-3 max-w-[34ch] text-[1.1rem] leading-[1.6] text-ink">
          <Rich text={todaySentence(today, tx, f)} />
        </p>
      )}
      {offer?.state === "open" && <OfferWords card={offer} lang={f.lang} big />}
      {today?.items.filter((i) => i.kind === "sign_off").map((i) =>
        i.kind === "sign_off" && thread ? <SignOffSlab key={i.approvalId} card={{ type: "gate", cardId: `gate:${i.orderId}`, requestId: i.requestId ?? "", orderId: i.orderId, approvalId: i.approvalId, outcome: "waiting", approver: i.approver, reasons: [], rules: [] } as GateCardT} thread={thread} tap={(action, label) => void api.submit({ door: "typed", via: "tap", action, label, lang })} total={i.totalCents} what={i.lines.map((l) => `${f.num(l.quantity)} × ${l.name}`).join(", ")} /> : null,
      )}
      <ul className="mt-6 flex flex-col gap-1.5">
        {tx.examples.map((e) => (
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
