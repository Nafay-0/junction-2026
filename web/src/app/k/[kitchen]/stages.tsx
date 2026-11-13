"use client";

import { useEffect, useState } from "react";
import type { ApiError } from "../../_client/api";
import { api } from "../../_client/api";
import type { Interpretation } from "../../_client/interpret";
import type { NeedInput } from "@/core/need";
import type { Incomplete } from "./console";
import { attr, clock, day, measure, money, moneyShort, num, roleLabel, ruleTitle, say, shortProduct } from "../../_ui/plain";
import { Target } from "../../_ui/target";
import { Spinner, Tag, Working } from "../../_ui/kit";
import { Button, Field, MemoryNote, Missing, Paper } from "./ui";
import { cutoffText } from "./when";
import type { ApprovalQr, KitchenInfo, Order, Step } from "./types";

type Names = Record<string, string>;

const LABEL: Record<string, string> = { best_price: "Best price", lowest_carbon: "Lowest CO2", most_reliable: "Most reliable", same_as_last_time: "Same as last time" };
const OPTIMISE: Record<string, string> = { price: "Lowest price", co2: "Lowest CO2", reliability: "Most reliable delivery", no_preference: "No preference", unstated: "Nothing said about price or CO2" };

function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// ---------- 1. what Dock understood ----------

type NeedLike = NonNullable<Interpretation["need"]>;

export function Understood({
  text,
  interp,
  step,
  busy,
  incomplete,
  onComplete,
}: {
  text: string;
  interp?: Interpretation;
  step?: Step;
  busy?: string;
  incomplete?: Incomplete;
  onComplete: (need: NeedInput) => void;
}) {
  if (incomplete) return <CompleteNeed text={text} incomplete={incomplete} onComplete={onComplete} />;
  const need = (step?.need ?? interp?.need) as NeedLike | undefined;
  const original = interp?.need;
  const corrected = step && original?.quantity && step.need.quantity && (original.quantity.amount !== step.need.quantity.amount || original.quantity.unit !== step.need.quantity.unit);
  const dateChanged = step && original?.deliverBy && step.need.deliverBy !== original.deliverBy;
  const musts = need ? [...(need.requiredClaims ?? []), ...(need.item.attributes ?? [])] : [];
  return (
    <Paper>
      <div className="p-4 sm:p-6">
        <blockquote className="display max-w-[34ch] text-[1.7rem] leading-[1.08] text-petrol-deep sm:text-[2.1rem]">“{text}”</blockquote>
        <div className="min-h-[4.5rem]">
          {!need && busy && <Working className="mt-4">{busy}</Working>}
          {need && (
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-3 xl:grid-cols-4">
              <Field label="Item">{need.item.text}</Field>
              <Field label="Amount">
                {need.quantity ? measure(need.quantity.amount, need.quantity.unit) : need.sameAsLastTime ? "Same as last time" : <Missing>Not said</Missing>}
                {corrected && original?.quantity && <span className="block text-[0.9rem] font-medium text-ink-soft">corrected from {measure(original.quantity.amount, original.quantity.unit)}</span>}
              </Field>
              <Field label="Deliver by">
                {need.deliverBy ? day(need.deliverBy) : <Missing>Not said</Missing>}
                {dateChanged && original?.deliverBy && <span className="block text-[0.9rem] font-medium text-ink-soft">changed from {day(original.deliverBy)}</span>}
              </Field>
              <Field label="What matters most">{OPTIMISE[need.optimise ?? "unstated"]}</Field>
              {musts.length > 0 && <Field label="Must be">{musts.map(attr).join(", ")}</Field>}
              {(need.item.excludedAttributes?.length ?? 0) > 0 && <Field label="Must not be">{need.item.excludedAttributes!.map(attr).join(", ")}</Field>}
              {(need.forbiddenAllergens?.length ?? 0) > 0 && <Field label="No allergens">{need.forbiddenAllergens!.map(attr).join(", ")}</Field>}
              {need.sameAsLastTime && need.quantity && <Field label="Same as last time">Yes</Field>}
            </dl>
          )}
        </div>
        {interp?.memoryLine && (
          <div className="mt-3 bg-lavender px-3 py-2">
            <MemoryNote>{interp.memoryLine}</MemoryNote>
          </div>
        )}
        {interp && (
          <p className="mt-3 flex flex-wrap items-center gap-x-2 text-[0.88rem] text-ink-soft">
            {interp.noModel ? (
              <>No model read this: it is the earlier request&apos;s own fields. Everything after this line is plain code.</>
            ) : interp.offline ? (
              <>
                <Tag>Offline example</Tag>
                Read by {interp.model} in {interp.ms} ms, not by the model. Everything after this line is plain code.
              </>
            ) : interp.addedByBuyer?.length ? (
              <>Read by {interp.model}; the buyer added the {interp.addedByBuyer.map((m) => (m === "item" ? "item" : "amount")).join(" and ")}. Everything after this line is plain code.</>
            ) : (
              <>Read by {interp.model} in {interp.ms} ms. The model only fills these fields; everything after this line is plain code.</>
            )}
          </p>
        )}
        {busy && need && <Working className="mt-2 text-[0.95rem]">{busy}</Working>}
      </div>
    </Paper>
  );
}

/** The reader understood part of the request: show that, and ask for exactly what is missing, as fields. */
function CompleteNeed({ text, incomplete, onComplete }: { text: string; incomplete: Incomplete; onComplete: (need: NeedInput) => void }) {
  const p = incomplete.partial;
  const needItem = incomplete.missing.includes("item") || !p.item?.text;
  const needQty = incomplete.missing.includes("quantity") || (!p.quantity && !p.sameAsLastTime);
  const [item, setItem] = useState(p.item?.text ?? "");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState<"L" | "kg" | "pcs" | "pack">("L");
  const n = Number(qty.replace(",", "."));
  const ready = (!needItem || item.trim().length > 0) && (!needQty || (Number.isFinite(n) && n > 0));
  const submit = () => {
    if (!ready) return;
    onComplete({
      ...p,
      text,
      item: { ...(p.item ?? {}), text: needItem ? item.trim() : (p.item?.text ?? item.trim()) },
      ...(needQty ? { quantity: { amount: n, unit } } : {}),
    });
  };
  const input = "min-h-11 border-2 border-petrol bg-paper px-2 font-semibold";
  return (
    <Paper>
      <form
        className="p-4 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <blockquote className="display text-[1.7rem] leading-[1.08] text-petrol-deep sm:text-[2.1rem]">“{text}”</blockquote>
        <p className="mt-2 text-[1.02rem]">{incomplete.message} Add it here; everything else stays as read.</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-3 sm:grid-cols-3">
          <div>
            <dt className="text-[0.8rem] font-medium text-ink-soft">
              <label htmlFor="fix-item">Item</label>
            </dt>
            <dd className="mt-0.5">
              {needItem ? (
                <input id="fix-item" autoFocus value={item} onChange={(e) => setItem(e.target.value)} placeholder="e.g. lactose-free milk" className={`${input} w-full`} />
              ) : (
                <span className="text-[1.05rem] font-semibold">{p.item?.text}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[0.8rem] font-medium text-ink-soft">
              <label htmlFor="fix-qty">Amount</label>
            </dt>
            <dd className="mt-0.5">
              {needQty ? (
                <span className="flex gap-1">
                  <input id="fix-qty" autoFocus={!needItem} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="100" className={`${input} w-24 tabular`} />
                  <select aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)} className={`${input} px-1`}>
                    <option value="L">litres</option>
                    <option value="kg">kilos</option>
                    <option value="pack">packs</option>
                    <option value="pcs">pieces</option>
                  </select>
                </span>
              ) : (
                <span className="text-[1.05rem] font-semibold">{p.quantity ? measure(p.quantity.amount, p.quantity.unit) : "Same as last time"}</span>
              )}
            </dd>
          </div>
          <Field label="Deliver by">{p.deliverBy ? day(p.deliverBy) : <Missing>Not said</Missing>}</Field>
          {[...(p.requiredClaims ?? []), ...(p.item?.attributes ?? [])].length > 0 && <Field label="Must be">{[...(p.requiredClaims ?? []), ...(p.item?.attributes ?? [])].map(attr).join(", ")}</Field>}
        </dl>
        <div className="mt-4">
          <Button type="submit" kind="go" disabled={!ready}>
            Continue with this
          </Button>
        </div>
      </form>
    </Paper>
  );
}

// ---------- 2. lookup: the mistake check, and what memory answered ----------

export function Concerns({ step, seen, onRespond, busyKey, names, remembered }: { step: Step; seen: Step["concerns"]; onRespond: (key: string, choice: string) => void; busyKey?: string; names: Names; remembered?: { text: string }[] }) {
  const memory = remembered && remembered.length > 0 && (
    <div className="bg-lavender px-4 py-3 sm:px-5">
      <p className="text-[0.88rem] font-semibold text-lavender-deep">Remembered, so not asked</p>
      <ul className="mt-1 space-y-1">
        {remembered.map((l) => (
          <li key={l.text}>
            <MemoryNote>{say(l.text, names)}</MemoryNote>
          </li>
        ))}
      </ul>
    </div>
  );
  if (seen.length === 0) {
    return (
      <div className="space-y-3">
        <Paper>
          <div className="flex items-start gap-3 p-4 sm:p-5">
            <span aria-hidden className="mt-0.5 flex size-7 shrink-0 items-center justify-center bg-petrol text-[0.95rem] font-bold text-paper">
              ✓
            </span>
            <p className="text-[1.05rem] leading-snug">
              <strong>Nothing looks unusual.</strong>{" "}
              <span className="text-ink-soft">The amount was compared with what this kitchen usually orders, and the delivery day, the order cut-off, duplicates and the kitchen&apos;s own rules were checked, before any price was asked.</span>
            </p>
          </div>
        </Paper>
        {memory}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {seen.map((c) => {
        const open = step.state === "needs_confirmation" && step.concerns.some((x) => x.key === c.key);
        const ack = step.acknowledgements.find((a) => a.key === c.key);
        const fix = ack?.correctionId ? c.corrections.find((x) => x.id === ack.correctionId) : undefined;
        const message = say(c.message, names);
        return (
          <article key={c.key} className={`bg-paper ${open ? "outline-[3px] outline-petrol" : ""}`}>
            <div aria-hidden className={open ? "h-1.5 bg-lime" : "h-[3px] bg-petrol"} />
            <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <p className="text-[0.88rem] font-semibold text-petrol">{open ? (c.severity === "error" ? "This cannot go ahead as it is" : "Did you mean this?") : "Checked"}</p>
                <p className="mt-1 max-w-[52ch] text-[1.35rem] font-semibold leading-snug sm:text-[1.5rem]">{message}</p>
                {!open && (
                  <p className="mt-2 flex items-center gap-2 text-[1.02rem]">
                    <span aria-hidden className="flex size-5 items-center justify-center bg-petrol text-[0.75rem] font-bold text-paper">
                      ✓
                    </span>
                    {ack?.action === "corrected" ? `Corrected: ${fix?.label ?? "changed"}.` : ack?.action === "confirmed" ? `Confirmed as intended by ${ack.by}.` : ack?.action === "cancelled" ? "Cancelled." : "Settled."}
                  </p>
                )}
              </div>
              {open && (
                <div className="flex flex-col items-stretch gap-2 lg:min-w-[16rem]">
                  {c.corrections.map((x, i) => (
                    <Button key={x.id} kind={i === 0 ? "go" : "secondary"} busy={busyKey === `${c.key}:${x.id}`} disabled={!!busyKey} onClick={() => onRespond(c.key, x.id)}>
                      {x.label}
                    </Button>
                  ))}
                  {c.confirmable && (
                    <Button kind="secondary" busy={busyKey === `${c.key}:confirm`} disabled={!!busyKey} onClick={() => onRespond(c.key, "confirm")}>
                      Yes, I meant that
                    </Button>
                  )}
                  {c.corrections.length === 0 && !c.confirmable && <p className="text-ink-soft">Start a new request with a different day or amount.</p>}
                </div>
              )}
            </div>
          </article>
        );
      })}
      {memory}
    </div>
  );
}

// ---------- 3. questions ----------

export function Questions({
  step,
  asked,
  answers,
  fromMemory,
  onAnswer,
  busyKey,
  hideMemory = false,
}: {
  step: Step;
  hideMemory?: boolean;
  asked: { id: string; text: string; options: { id: string; label: string }[] }[];
  answers: Record<string, { optionId: string; label: string; remember: boolean }>;
  fromMemory: Step["fromMemory"];
  onAnswer: (questionId: string, optionId: string, label: string, remember: boolean) => void;
  busyKey?: string;
}) {
  const [remember, setRemember] = useState<Record<string, boolean>>({});
  const stated = step.rules.filter((r) => r.source === "stated");
  return (
    <Paper>
      <div className="divide-y divide-line">
        {asked.map((q) => {
          const open = step.state === "needs_input" && step.questions.some((x) => x.id === q.id);
          const given = answers[q.id];
          return (
            <fieldset key={q.id} className="p-4 sm:p-6">
              <legend className="float-left w-full text-[1.35rem] font-semibold leading-snug">{q.text}</legend>
              <div className="clear-left flex flex-wrap gap-2 pt-3" role="group">
                {q.options.map((o) => {
                  const chosen = given?.optionId === o.id;
                  return (
                    <Button
                      key={o.id}
                      kind={chosen ? "primary" : "secondary"}
                      pressed={given ? chosen : undefined}
                      busy={busyKey === `${q.id}:${o.id}`}
                      disabled={!open || !!busyKey}
                      onClick={() => onAnswer(q.id, o.id, o.label, !!remember[q.id])}
                    >
                      {o.label}
                    </Button>
                  );
                })}
              </div>
              {open ? (
                <label className="mt-3 flex min-h-11 items-center gap-2 text-[0.98rem]">
                  <input type="checkbox" className="size-5 accent-[var(--color-lavender-deep)]" checked={!!remember[q.id]} onChange={(e) => setRemember((r) => ({ ...r, [q.id]: e.target.checked }))} />
                  Remember this answer for the next order
                </label>
              ) : (
                given && (
                  <p className="mt-2 text-[0.98rem] text-ink-soft">
                    Answered: {given.label}
                    {given.remember ? ". The agent keeps it as a rule from now on." : "."}
                  </p>
                )
              )}
            </fieldset>
          );
        })}
        {!hideMemory && (fromMemory.length > 0 || stated.length > 0) && (
          <div className="space-y-1.5 bg-lavender p-4 sm:p-6">
            <h3 className="font-semibold text-lavender-deep">{asked.length ? "Not asked, because the kitchen's memory answers it" : "Nothing to ask: the kitchen's memory answers it"}</h3>
            {stated.map((r) => {
              const m = /^Stated by (.+?): (.*)$/.exec(r.text);
              const who = m?.[1].replace(/\s*\(.*\)$/, "") ?? "a person";
              return (
                <MemoryNote key={r.text}>
                  <strong>{m?.[2] ?? r.text}</strong>: a rule {who} stated earlier, always applied.
                </MemoryNote>
              );
            })}
            {fromMemory
              .filter((m) => m.source === "learned")
              .map((m) => (
                <MemoryNote key={m.question.id}>
                  {m.question.text} <strong>{m.label}</strong>, learned from history{evidenceOf(m.text)}. Pre-selected only.
                </MemoryNote>
              ))}
          </div>
        )}
      </div>
    </Paper>
  );
}

/** " (10 of your last 10 milk orders)" out of a learned preference's text. */
function evidenceOf(text: string): string {
  const m = /(\d+ of your last \d+ [\w ]+? orders)/.exec(text);
  return m ? ` (${m[1]})` : "";
}

// ---------- 4. options ----------

const RANK: Record<string, string> = { best: "Best", better: "Better", good: "Good" };
const RANK_STEPS: Record<string, number> = { good: 1, better: 2, best: 3 };

/** Good, better, best as three squares: how far up the ladder this option is. */
function RankMark({ rank }: { rank?: string }) {
  const n = rank ? (RANK_STEPS[rank] ?? 0) : 0;
  return (
    <span aria-hidden className="flex items-end gap-0.5">
      {[1, 2, 3].map((i) => (
        <span key={i} className={`w-2 ${i <= n ? "bg-petrol" : "bg-line"}`} style={{ height: 6 + i * 4 }} />
      ))}
    </span>
  );
}

type Card = Step["options"][number];

function co2Text(c: Card) {
  return c.co2.kg === null ? null : `${num(c.co2.kg, 1)} kg CO2e`;
}

export function Options({
  step,
  options,
  onChoose,
  onNarrow,
  busyKey,
  names,
}: {
  step: Step;
  options: Step["options"];
  onChoose: (optionId: string) => void;
  onNarrow?: (questionId: string, optionId: string, label: string) => void;
  busyKey?: string;
  names: Names;
}) {
  const chosen = step.chosen?.optionId;
  const open = step.state === "options_ready";
  const choices = step.openChoices ?? [];
  const [compare, setCompare] = useState(false);
  // The order on screen: good, better, best from left to right, so the ladder reads upwards.
  const ordered = [...options].sort((a, b) => (RANK_STEPS[a.rank ?? ""] ?? 0) - (RANK_STEPS[b.rank ?? ""] ?? 0));
  return (
    <div>
      {open && choices.length > 0 && onNarrow && (
        <div className="mb-3 space-y-2 bg-lavender p-3 sm:p-4">
          <p className="text-[0.95rem] text-lavender-deep">The request did not say, so the options cover more than one. Narrow it only if it matters:</p>
          {choices.map((q) => (
            <div key={q.id} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{q.text}</span>
              {q.options.map((o) => (
                <Button key={o.id} kind="secondary" size="sm" busy={busyKey === `${q.id}:${o.id}`} disabled={!!busyKey} onClick={() => onNarrow(q.id, o.id, o.label)}>
                  {o.label}
                </Button>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {step.preselected && open ? (
          <p className="text-[1rem]">
            <strong>Pre-selected:</strong> {say(step.preselected.reason, names)}
          </p>
        ) : (
          <span />
        )}
        {options.length > 1 && (
          <div role="group" aria-label="Show the options as" className="flex">
            <button type="button" aria-pressed={!compare} onClick={() => setCompare(false)} className={`min-h-10 border-2 border-petrol px-3 text-[0.92rem] font-semibold ${!compare ? "bg-petrol text-paper" : "bg-paper text-petrol"}`}>
              Cards
            </button>
            <button type="button" aria-pressed={compare} onClick={() => setCompare(true)} className={`-ml-[2px] min-h-10 border-2 border-petrol px-3 text-[0.92rem] font-semibold ${compare ? "bg-petrol text-paper" : "bg-paper text-petrol"}`}>
              Compare side by side
            </button>
          </div>
        )}
      </div>
      {compare ? (
        <CompareTable options={ordered} step={step} open={open} chosen={chosen} busyKey={busyKey} onChoose={onChoose} names={names} />
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 17rem), 1fr))" }}>
          {ordered.map((c) => {
            const pre = step.preselected?.optionId === c.optionId;
            const isChosen = chosen === c.optionId;
            const dim = !open && !isChosen;
            const top = c.rank === "best";
            return (
              <article
                key={c.optionId}
                className={`flex flex-col bg-paper ${isChosen || (open && pre) ? "outline-[3px] outline-petrol" : ""} ${c.match === "compromise" ? "border-2 border-dashed border-ink-soft/60" : ""} ${dim ? "opacity-55" : ""}`}
                aria-label={`${c.rank ? RANK[c.rank] : "Option"}${c.match === "compromise" ? ", a compromise" : ""}${c.labels.length ? `: ${c.labels.map((l) => LABEL[l]).join(" and ")}` : ""}`}
              >
                <div aria-hidden className={c.signOff.length ? "hazard-thin h-2" : top ? "h-1.5 bg-petrol-deep" : "h-[3px] bg-petrol"} />
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="display text-[1.6rem] text-ink">{c.rank ? RANK[c.rank] : "Option"}</h3>
                    <RankMark rank={c.rank} />
                  </div>
                  {c.labels.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {c.labels.map((l) => (
                        <Tag key={l} tone={l === "same_as_last_time" ? "agent" : "plain"}>
                          {LABEL[l]}
                        </Tag>
                      ))}
                    </p>
                  )}
                  {c.match === "compromise" && <p className="mt-2 text-[0.95rem] font-semibold leading-snug">Compromise: {(c.givesUp ?? []).map((g) => say(g.text, names).replace(/\.$/, "")).join("; ") || "does not meet the whole request"}.</p>}
                  <p className="mt-2 min-h-[2.75em] text-[0.95rem] leading-snug text-ink-soft">{c.lines.map((l) => `${l.packs} × ${shortProduct(l.name)}${l.substituteFor ? " (swap)" : ""}`).join(" + ")}</p>
                  <p className="display mt-3 text-[2.6rem] text-ink tabular">{money(c.totalCents)}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line pt-3">
                    <Field label="Arrives">{day(c.deliveryDate)}</Field>
                    <Field label="Amount">
                      {measure(c.delivered.amount, c.delivered.unit)}
                      {c.leftover.amount > 0 && <span className="block text-[0.85rem] font-medium text-ink-soft">+{measure(c.leftover.amount, c.leftover.unit)} over</span>}
                    </Field>
                    <Field label="Carbon">
                      {co2Text(c) ? <span className="tabular">{co2Text(c)}</span> : <Missing>No carbon data</Missing>}
                      {c.co2.kg !== null && <span className="block text-[0.82rem] font-medium leading-tight text-ink-soft">product-group average</span>}
                    </Field>
                    <Field label="Delivered in full">{c.reliability === null ? <Missing>No data</Missing> : <span className="tabular">{Math.round(c.reliability * 100)} % of past deliveries</span>}</Field>
                    {c.orderBy && <Field label="Order by">{cutoffText(c.orderBy) ?? c.orderBy}</Field>}
                    {c.stockConfirmed === false && <Field label="Stock">not confirmed by the wholesaler</Field>}
                  </dl>
                  <ul className="mt-3 space-y-1 text-[0.95rem] leading-snug">
                    {c.pros.map((p) => (
                      <li key={p} className="grid grid-cols-[1.1rem_1fr]">
                        <span aria-label="For" className="font-bold text-petrol">
                          +
                        </span>
                        {say(p, names)}
                      </li>
                    ))}
                    {c.cons.map((p) => (
                      <li key={p} className="grid grid-cols-[1.1rem_1fr] text-ink-soft">
                        <span aria-label="Against" className="font-bold text-ink">
                          –
                        </span>
                        {say(p, names)}
                      </li>
                    ))}
                  </ul>
                  {c.signOff.length > 0 && <p className="mt-3 border-l-4 border-safety-ink bg-safety/25 px-2 py-1 text-[0.9rem] leading-snug">A person will have to sign this one off.</p>}
                  <div className="mt-auto pt-4">
                    {open ? (
                      <Button kind={pre ? "go" : "secondary"} className="w-full" busy={busyKey === c.optionId} disabled={!!busyKey} onClick={() => onChoose(c.optionId)}>
                        Get a fixed price for this
                      </Button>
                    ) : isChosen ? (
                      <p className="flex min-h-11 items-center gap-2 font-semibold text-petrol">
                        <span aria-hidden className="flex size-6 items-center justify-center bg-petrol text-[0.8rem] text-paper">
                          ✓
                        </span>
                        Chosen{step.chosen?.by ? ` by ${step.chosen.by.replace(/^agent .*/, "the agent")}` : ""}
                      </p>
                    ) : (
                      <p className="min-h-11" />
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {step.notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-[0.98rem]">
          {step.notes.map((n) => (
            <li key={n}>{say(n, names)}</li>
          ))}
        </ul>
      )}
      {(step.signOffNotes ?? []).length > 0 && (
        <div className="mt-3">
          <p className="font-semibold">For the person who signs off</p>
          <ul className="mt-1 space-y-1 text-[0.98rem]">
            {step.signOffNotes!.map((n) => (
              <li key={n}>– {say(n, names)}</li>
            ))}
          </ul>
        </div>
      )}
      <Excluded step={step} names={names} />
    </div>
  );
}

/** The options as columns, one row per fact, with the best value in each row marked. */
function CompareTable({ options, step, open, chosen, busyKey, onChoose, names }: { options: Card[]; step: Step; open: boolean; chosen?: string; busyKey?: string; onChoose: (id: string) => void; names: Names }) {
  // The best value in a row is marked only when the options differ on it.
  const min = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length > 1 && new Set(v).size > 1 ? Math.min(...v) : undefined;
  };
  const max = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length > 1 && new Set(v).size > 1 ? Math.max(...v) : undefined;
  };
  const cheapest = min(options.map((c) => c.totalCents));
  const greenest = min(options.map((c) => c.co2.kg));
  const surest = max(options.map((c) => c.reliability));
  const earliest = options.map((c) => c.deliveryDate).sort()[0];
  const mark = (on: boolean, text: React.ReactNode) => (
    <span className={on ? "bg-petrol-soft px-1 font-bold text-petrol-deep" : ""}>
      {text}
      {on && <span className="sr-only"> (the best here)</span>}
    </span>
  );
  const rows: { label: string; cell: (c: Card) => React.ReactNode }[] = [
    { label: "Total", cell: (c) => mark(c.totalCents === cheapest, <span className="display text-[1.5rem] tabular">{money(c.totalCents)}</span>) },
    { label: "What", cell: (c) => c.lines.map((l) => `${l.packs} × ${shortProduct(l.name)}${l.substituteFor ? " (swap)" : ""}`).join(" + ") },
    { label: "Arrives", cell: (c) => mark(c.deliveryDate === earliest && options.some((o) => o.deliveryDate !== earliest), day(c.deliveryDate)) },
    { label: "Amount", cell: (c) => `${measure(c.delivered.amount, c.delivered.unit)}${c.leftover.amount > 0 ? `, ${measure(c.leftover.amount, c.leftover.unit)} over` : ""}` },
    { label: "Carbon", cell: (c) => (co2Text(c) ? mark(c.co2.kg === greenest, co2Text(c)) : <Missing>No data</Missing>) },
    { label: "Delivered in full", cell: (c) => (c.reliability === null ? <Missing>No data</Missing> : mark(c.reliability === surest, `${Math.round(c.reliability * 100)} %`)) },
    { label: "Order by", cell: (c) => (c.orderBy ? (cutoffText(c.orderBy) ?? c.orderBy) : "no cut-off stated") },
    { label: "Sign-off", cell: (c) => (c.signOff.length ? "A person signs off" : "The agent may place it") },
    {
      label: "For and against",
      cell: (c) => (
        <ul className="space-y-0.5 text-[0.9rem]">
          {c.pros.map((p) => (
            <li key={p}>+ {say(p, names)}</li>
          ))}
          {c.cons.map((p) => (
            <li key={p} className="text-ink-soft">
              – {say(p, names)}
            </li>
          ))}
        </ul>
      ),
    },
  ];
  return (
    <div className="overflow-x-auto bg-paper">
      <div aria-hidden className="h-[3px] bg-petrol" />
      <table className="w-full min-w-[40rem] text-left text-[0.98rem]">
        <caption className="sr-only">The options side by side</caption>
        <thead>
          <tr className="border-b border-line">
            <th className="w-40 px-4 py-3" />
            {options.map((c) => (
              <th key={c.optionId} scope="col" className={`px-3 py-3 align-bottom ${chosen === c.optionId ? "bg-petrol-soft" : ""}`}>
                <span className="flex items-center gap-2">
                  <span className="display text-[1.5rem]">{c.rank ? RANK[c.rank] : "Option"}</span>
                  <RankMark rank={c.rank} />
                </span>
                <span className="block text-[0.85rem] font-medium text-ink-soft">{c.labels.map((l) => LABEL[l]).join(", ") || (c.match === "compromise" ? "Compromise" : "")}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.label} className="align-top">
              <th scope="row" className="px-4 py-2.5 text-[0.88rem] font-medium text-ink-soft">
                {r.label}
              </th>
              {options.map((c) => (
                <td key={c.optionId} className={`px-3 py-2.5 ${chosen === c.optionId ? "bg-petrol-soft/50" : ""}`}>
                  {r.cell(c)}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row" className="px-4 py-3" />
            {options.map((c) => (
              <td key={c.optionId} className="px-3 py-3">
                {open ? (
                  <Button kind={step.preselected?.optionId === c.optionId ? "go" : "secondary"} size="sm" busy={busyKey === c.optionId} disabled={!!busyKey} onClick={() => onChoose(c.optionId)}>
                    Fix this price
                  </Button>
                ) : chosen === c.optionId ? (
                  <span className="font-semibold text-petrol">Chosen</span>
                ) : null}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Excluded({ step, names }: { step: Step; names: Names }) {
  if (!step.excluded.length) return null;
  return (
    <details className="mt-3 text-[0.95rem]">
      <summary className="min-h-10 cursor-pointer py-2 font-semibold text-petrol underline decoration-2 underline-offset-4">
        Why {step.excluded.length} other product{step.excluded.length === 1 ? " is" : "s are"} not offered
      </summary>
      <ul className="mt-1 space-y-0.5 text-ink-soft">
        {step.excluded.map((e, i) => (
          <li key={`${e.productId}-${i}`}>
            {names[e.productId] ? shortProduct(names[e.productId]) : "Another product"}: {say(e.reason, names)}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function NoOptions({ step, names, onNew }: { step: Step; names: Names; onNew: () => void }) {
  return (
    <Paper>
      <div className="p-4 sm:p-6">
        <p className="text-[1.35rem] font-semibold leading-snug">{step.state === "cancelled" ? "The request was cancelled. Nothing was ordered." : say(step.notes[0] ?? "Nothing fits.", names)}</p>
        {step.notes.slice(1).map((n) => (
          <p key={n} className="mt-1 text-ink-soft">
            {say(n, names)}
          </p>
        ))}
        <Excluded step={step} names={names} />
        <div className="mt-4">
          <Button kind="primary" onClick={onNew}>
            New request
          </Button>
        </div>
      </div>
    </Paper>
  );
}

// ---------- 5. fixed price ----------

export function Quote({ q, names, decided, busy, onPlace, onNew }: { q: NonNullable<Step["quote"]>; names: Names; decided: boolean; busy: boolean; onPlace: () => void; onNew: () => void }) {
  const now = useNow();
  const end = Date.parse(q.quote.expiresAt);
  const start = Date.parse(q.quote.issuedAt);
  const left = Math.max(0, end - now);
  const share = end > start ? Math.max(0, Math.min(1, left / (end - start))) : 0;
  const mm = Math.floor(left / 60_000);
  const ss = Math.floor((left % 60_000) / 1000);
  const expired = left === 0;
  const preview = q.policyPreview;
  const lead =
    preview.outcome === "auto_approve"
      ? "Within the mandate: the agent may place this alone."
      : preview.outcome === "needs_human_approval"
        ? `Beyond the mandate: ${preview.approver.name} (${roleLabel(preview.approver.role)}) will have to sign off.`
        : "The gate would refuse this.";
  return (
    <Paper>
      <div className="p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <p className="text-[0.88rem] font-medium text-ink-soft">Total, signed by the wholesaler, VAT 0 %</p>
            <p className="display text-[3.4rem] text-ink tabular">{money(q.quote.totalCents)}</p>
          </div>
          <div className="min-w-[12rem] flex-1 sm:max-w-[18rem]" aria-live="off">
            <p className="flex items-baseline justify-between gap-3 text-[0.88rem] font-medium text-ink-soft">
              <span>{expired ? "Price expired" : decided ? "Price held" : "Price holds for"}</span>
              <span>until {clock(q.quote.expiresAt)}</span>
            </p>
            <p className={`display text-right text-[2.4rem] tabular ${expired ? "text-ink-soft line-through" : share < 0.2 && !decided ? "text-ink" : "text-petrol-deep"}`}>
              {String(mm).padStart(2, "0")}.{String(ss).padStart(2, "0")}
            </p>
            <div aria-hidden className="mt-1 h-2 bg-line">
              <div className={`h-full transition-[width] duration-1000 ease-linear ${share < 0.2 ? "bg-ink" : "bg-petrol"}`} style={{ width: `${share * 100}%` }} />
            </div>
          </div>
        </div>
        <table className="mt-5 w-full text-left text-[0.98rem]">
          <caption className="sr-only">Quoted lines</caption>
          <thead className="border-y border-line text-[0.82rem] text-ink-soft">
            <tr>
              <th className="py-2 pr-2 font-medium">Product</th>
              <th className="py-2 pr-2 text-right font-medium">Packs</th>
              <th className="hidden py-2 pr-2 text-right font-medium sm:table-cell">Per pack</th>
              <th className="py-2 pr-2 text-right font-medium">Line</th>
              <th className="py-2 text-right font-medium">Arrives</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {q.quote.lines.map((l) => (
              <tr key={l.productId}>
                <td className="py-2 pr-2">
                  {shortProduct(l.name)}
                  {l.substituteFor && <span className="block text-[0.85rem] text-ink-soft">swap for {shortProduct(l.substituteFor.name)}</span>}
                </td>
                <td className="py-2 pr-2 text-right tabular">{l.quantity}</td>
                <td className="hidden py-2 pr-2 text-right tabular sm:table-cell">{money(l.unitPriceCents)}</td>
                <td className="py-2 pr-2 text-right tabular">{money(l.lineTotalCents)}</td>
                <td className="py-2 text-right">{day(l.deliveryDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={`mt-4 flex items-start gap-3 px-3 py-2.5 ${preview.outcome === "auto_approve" ? "bg-mist" : "border-l-[6px] border-safety-ink bg-safety/20"}`}>
          {preview.outcome !== "auto_approve" && <Target size={22} tone="safety" className="mt-0.5 shrink-0" />}
          <div>
            <p className="font-semibold">The gate&apos;s preview: {lead}</p>
            {preview.outcome !== "auto_approve" && (
              <ul className="mt-1 space-y-0.5 text-[0.95rem] text-ink-soft">
                {preview.reasons
                  .filter((r) => !r.startsWith("Sent to "))
                  .map((r) => (
                    <li key={r}>{say(r, names)}</li>
                  ))}
              </ul>
            )}
          </div>
        </div>
        {!decided && (
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <Button kind="go" size="lg" busy={busy} onClick={onPlace}>
              Place the order
            </Button>
            {expired && <span className="text-[0.95rem] text-ink-soft">The price has expired: the gate will refuse it. Start again for a new price.</span>}
            <Button kind="quiet" onClick={onNew}>
              Start again
            </Button>
          </div>
        )}
      </div>
    </Paper>
  );
}

// ---------- 6. the gate ----------

const OUTCOME_WORD: Record<string, string> = { pass: "Passed", escalate: "Needs a person", fail: "Failed" };

/**
 * The gate's decision. When it stops an order this is the loudest thing on the customer side: a black slab in a
 * hazard frame, the crash-test mark, the barrier arms closing. When it passes an order it is a quiet white plate.
 * `withSignOff` puts the sign-off (who, the QR code, the stamp) inside the same plate, for pages without a lane.
 */
export function Gate({ order, refusal, kitchen, names, streaming, byHand = false, withSignOff = true }: { order?: Order; refusal?: ApiError; kitchen: KitchenInfo; names: Names; streaming: boolean; byHand?: boolean; withSignOff?: boolean }) {
  if (!order) {
    return (
      <GateSlab title="Refused at the gate" sub={ruleTitle(refusal?.rule)}>
        <p className="text-[1.1rem] leading-snug text-paper">{say(refusal?.message ?? "The order was refused.", names)}</p>
        <p className="mt-2 text-[0.95rem] text-paper/70">Nothing was ordered. The refusal and its reason are in the ledger.</p>
      </GateSlab>
    );
  }
  const d = order.decision;
  const rules = d.rules;
  const a = order.approval;
  const checks = <ChecksList rules={rules} names={names} dark={order.status !== "committed" || !!a} />;

  if (order.status === "rejected") {
    const failed = rules.filter((r) => r.outcome === "fail");
    return (
      <GateSlab title={a ? "Refused at the re-check" : "Refused at the gate"} sub={failed.map((r) => ruleTitle(r.rule)).join(", ") || ruleTitle(refusal?.rule)}>
        <ul className="space-y-1 text-[1.08rem] leading-snug text-paper">
          {failed.map((r) => (
            <li key={r.rule}>{say(r.reason, names)}</li>
          ))}
        </ul>
        <p className="mt-2 text-[0.95rem] text-paper/70">Nothing was ordered. The refusal and its reason are in the ledger.</p>
        {checks}
      </GateSlab>
    );
  }
  if (a) {
    const escalated = rules.filter((r) => r.outcome === "escalate");
    return (
      <div className="space-y-3">
        <GateSlab title="Stopped at the gate" sub={`${a.approver.name}, ${roleLabel(a.approver.role)}, must sign off. The agent cannot approve its own order.`} closed={a.status === "pending"}>
          <ul className="space-y-2 leading-snug">
            {escalated.map((r) => (
              <li key={r.rule} className="text-paper">
                <strong className="text-safety">{ruleTitle(r.rule)}.</strong> <span className="text-paper/90">{say(r.reason, names)}</span>
              </li>
            ))}
          </ul>
          {checks}
        </GateSlab>
        {withSignOff && <SignOff order={order} kitchen={kitchen} streaming={streaming} />}
      </div>
    );
  }
  return (
    <Paper>
      <div className="p-4 sm:p-6">
        <div className="flex items-start gap-4">
          <span aria-hidden className="flex size-14 shrink-0 items-center justify-center bg-petrol text-[1.8rem] font-bold text-paper">
            ✓
          </span>
          <div className="min-w-0">
            <p className="display text-[2.2rem] text-ink sm:text-[2.6rem]">{byHand ? "Passed: within the kitchen's mandate" : "Passed: the agent may place it alone"}</p>
            <p className="mt-1 text-[1.05rem] text-ink-soft">
              All {rules.length} checks passed{byHand ? ", the same checks as an agent's order" : ""}. No sign-off needed.
            </p>
          </div>
        </div>
        <p className="mt-3 text-[1.05rem]">{say(d.reasons[0] ?? "", names)}</p>
        {checks}
      </div>
    </Paper>
  );
}

/** The black slab in a hazard frame, with the barrier closing across its top. Gate only. */
function GateSlab({ title, sub, children, closed = true }: { title: string; sub: string; children: React.ReactNode; closed?: boolean }) {
  return (
    <div role="group" aria-label={title} className="hazard-frame on-dark relative overflow-hidden">
      <div aria-hidden className="relative h-4 overflow-hidden">
        {closed ? (
          <>
            <span className="barrier-left hazard-thin absolute inset-y-0 left-0 w-1/2" />
            <span className="barrier-right hazard-thin absolute inset-y-0 right-0 w-1/2" />
          </>
        ) : (
          <>
            <span className="hazard-thin absolute inset-y-0 left-0 w-[12%]" />
            <span className="hazard-thin absolute inset-y-0 right-0 w-[12%]" />
          </>
        )}
      </div>
      <div className="p-4 sm:p-7">
        <div className="flex items-start gap-4 sm:gap-6">
          <Target size={84} tone="safety" className="hidden shrink-0 sm:block" />
          <Target size={52} tone="safety" className="shrink-0 sm:hidden" />
          <div className="min-w-0">
            <p className="display text-[2.4rem] leading-[0.95] text-safety sm:text-[3.6rem]">{title}</p>
            <p className="mt-2 max-w-[60ch] text-[1.1rem] leading-snug text-paper">{sub}</p>
          </div>
        </div>
        <div className="mt-5 sm:ml-[6.5rem]">{children}</div>
      </div>
    </div>
  );
}

function ChecksList({ rules, names, dark }: { rules: Order["decision"]["rules"]; names: Names; dark: boolean }) {
  const passed = rules.filter((r) => r.outcome === "pass").length;
  return (
    <details className={`mt-4 text-[0.95rem] ${dark ? "text-paper" : ""}`}>
      <summary className={`min-h-10 cursor-pointer py-2 font-semibold underline decoration-2 underline-offset-4 ${dark ? "text-paper" : "text-petrol"}`}>
        All {rules.length} checks ({passed} passed)
      </summary>
      <ul className={`mt-1 divide-y ${dark ? "divide-paper/15" : "divide-line"}`}>
        {rules.map((r) => (
          <li key={r.rule} className="grid gap-x-3 py-1.5 sm:grid-cols-[16rem_8rem_1fr]">
            <span className="font-semibold">{ruleTitle(r.rule)}</span>
            <span className={r.outcome === "pass" ? (dark ? "text-paper/60" : "text-ink-soft") : dark ? "font-semibold text-safety" : "font-semibold"}>{OUTCOME_WORD[r.outcome]}</span>
            <span className={dark ? "text-paper/75" : "text-ink-soft"}>{say(r.reason, names)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ---------- 7. sign-off ----------

/**
 * The person the gate named: waiting (a phone with the code to scan, a running clock), or decided (a stamp lands).
 * The phone screen this hands off to opens with the same hazard band and the same words, so it reads as one act.
 */
export function SignOff({ order, kitchen, streaming }: { order: Order; kitchen: KitchenInfo; streaming: boolean }) {
  const a = order.approval;
  const now = useNow(1000);
  if (!a) return null;
  const how = a.signOff?.method === "passkey" ? "with their passkey" : a.signOff?.method === "link_token" ? "with the one-time link sent to their phone" : a.signOff?.method === "demo_tap" ? "with a demo tap, not verified" : "";
  if (a.status === "pending") {
    const since = Math.max(0, Math.floor((now - Date.parse(a.requestedAt)) / 1000));
    return (
      <div className="border-[3px] border-safety-ink bg-paper">
        <div aria-hidden className="hazard h-3" />
        <div className="grid gap-6 p-4 sm:p-6 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[0.95rem] font-semibold">
              <span aria-hidden className="breathe inline-block size-3 bg-safety-ink" />
              Waiting for a person
            </p>
            <p className="display mt-2 text-[2.6rem] leading-[0.95] text-ink sm:text-[3.2rem]">{a.approver.name}</p>
            <p className="mt-1 text-[1.1rem]">
              {roleLabel(a.approver.role)}, may sign up to {moneyShort(a.approver.maxApprovalCents)}
            </p>
            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:max-w-md">
              <div>
                <dt className="text-[0.8rem] font-medium text-ink-soft">Asked</dt>
                <dd className="display text-[2rem] tabular" aria-live="off">
                  {since < 60 ? `${since} s` : `${Math.floor(since / 60)} min ${String(since % 60).padStart(2, "0")} s`}
                  <span className="ml-1 font-sans text-[0.9rem] font-medium text-ink-soft">ago</span>
                </dd>
              </div>
              <div>
                <dt className="text-[0.8rem] font-medium text-ink-soft">Order</dt>
                <dd className="display text-[2rem] tabular">{money(order.totalCents)}</dd>
              </div>
            </dl>
            <p className="mt-4 text-[0.95rem] text-ink-soft">{streaming ? "Live: this page changes the moment they decide on their phone." : "Checking every second for their decision."}</p>
          </div>
          <ApprovalPanel kitchen={kitchen} approvalId={a.approvalId} />
        </div>
      </div>
    );
  }
  const approved = a.status === "approved";
  return (
    <Paper>
      <div className="flex flex-wrap items-center gap-6 p-4 sm:p-6">
        <div className={`stamp inline-block border-[4px] px-5 py-3 ${approved ? "border-petrol text-petrol" : "border-ink text-ink"}`}>
          <p className="display text-[2.4rem] leading-none">{approved ? "Signed off" : "Declined"}</p>
          <p className="mt-1 text-[1rem] font-semibold">
            {a.approver.name}, {clock(a.decidedAt ?? order.updatedAt)}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[1.1rem] leading-snug">
            {approved ? "Approved" : "Declined"} by {a.approver.name}, {roleLabel(a.approver.role)}, at {clock(a.decidedAt ?? order.updatedAt)} {how}.
          </p>
          {a.note && <p className="mt-1 text-ink-soft">Note: “{a.note}”</p>}
          {approved && <p className="mt-1 text-ink-soft">The gate checked the order again before it went to the wholesaler.</p>}
        </div>
      </div>
    </Paper>
  );
}

/** A phone, drawn: the code to scan sits on its screen, so the hand-off reads as "pick up your phone". */
export function ApprovalPanel({ kitchen, approvalId }: { kitchen: KitchenInfo; approvalId: string }) {
  const [qr, setQr] = useState<ApprovalQr>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    void api<ApprovalQr>("GET", `/ui-api/kitchens/${encodeURIComponent(kitchen.slug)}/approval/${encodeURIComponent(approvalId)}`).then((r) => {
      if (!live) return;
      if (r.ok) setQr(r.data);
      else setError(r.error.message);
    });
    return () => {
      live = false;
    };
  }, [kitchen.slug, approvalId]);
  const name = qr?.approver.name ?? "the approver";
  return (
    <figure className="mx-auto w-full max-w-[15rem] md:w-56">
      <div className="rounded-[1.6rem] bg-safety-ink p-2.5 pb-4">
        <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-paper/25" />
        <div className="overflow-hidden rounded-[0.9rem] bg-paper">
          <div aria-hidden className="hazard-thin h-2" />
          <div className="p-2.5">
            <p className="text-center text-[0.8rem] font-semibold leading-tight">Stopped at the gate</p>
            <div className="mt-1.5 aspect-square w-full">
              {qr ? <div className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qr.qrSvg }} /> : <div className={`size-full ${error ? "bg-mist" : "animate-pulse bg-mist"}`} />}
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-[0.92rem] leading-snug">
        {error && <span className="text-ink-soft">No code to show: {error}</span>}
        {qr?.mode === "passkey" && <>Scan with {name}&apos;s phone. Approving needs their passkey.</>}
        {qr?.mode === "demo_link" && <>{name} is made up for this demo kitchen. Scan to sign off in their place, with the one-time link sent to their phone.</>}
        {qr?.mode === "view_only" && <>{name} signs off with the link sent to their phone.</>}
        {qr?.mode === "enrol" && <>{name} is made up for this demo kitchen. A presenter scans this, enters the operations passcode and makes a passkey to sign in their place.</>}
        {qr && (
          <a href={qr.url} target="_blank" rel="noreferrer" className="mt-1 block font-semibold text-petrol underline decoration-2 underline-offset-4">
            {qr.mode === "enrol" ? "Become the approver" : "Open the sign-off screen"}
          </a>
        )}
        {qr?.orderId && qr.status === "pending" && <WithdrawButton kitchen={kitchen} orderId={qr.orderId} />}
        {!qr && !error && (
          <span className="flex items-center gap-2 text-ink-soft">
            <Spinner size={14} /> Preparing the code…
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/** The buyer takes the waiting order back: it stops holding the weekly budget, and the approver's phone shows it withdrawn. */
function WithdrawButton({ kitchen, orderId }: { kitchen: KitchenInfo; orderId: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>();
  async function withdraw() {
    setBusy(true);
    const r = await api<{ order: Order }>("POST", `/ui-api/kitchens/${encodeURIComponent(kitchen.slug)}/call`, { method: "POST", path: `/api/v1/orders/${orderId}/withdraw`, body: { reason: "withdrawn from the kitchen portal" } });
    setBusy(false);
    setDone(r.ok ? "Withdrawn. It no longer holds the weekly budget." : r.error.message);
  }
  if (done) return <span className="mt-2 block text-ink-soft">{done}</span>;
  return (
    <span className="mt-2 block">
      <Button kind="quiet" busy={busy} onClick={() => void withdraw()}>
        Withdraw this order
      </Button>
    </span>
  );
}

// ---------- 8. signed order ----------

function ledgerSeq(jws?: string): number | undefined {
  try {
    const p = jws?.split(".")[1];
    if (!p) return undefined;
    const json = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))) as { ledgerHead?: { seq: number } };
    return json.ledgerHead?.seq;
  } catch {
    return undefined;
  }
}

export function SignedOrder({ order, names, onNew }: { order: Order; names: Names; onNew: () => void }) {
  if (order.status === "declined") {
    return (
      <Paper>
        <div className="p-4 sm:p-6">
          <p className="text-[1.35rem] font-semibold">Nothing was ordered: {order.approval?.approver.name ?? "the approver"} declined.</p>
          <div className="mt-4">
            <Button kind="primary" onClick={onNew}>
              New request
            </Button>
          </div>
        </div>
      </Paper>
    );
  }
  const seq = ledgerSeq(order.confirmation);
  const latest = order.lines.map((l) => l.deliveryDate).sort().at(-1)!;
  const by = order.approval?.status === "approved" ? `${order.approval.approver.name} (${roleLabel(order.approval.approver.role)})` : "the agent, within its mandate";
  return (
    <div className="bg-paper">
      <div aria-hidden className="h-2 bg-petrol-deep" />
      <div className="p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="display text-[2.2rem] text-petrol-deep">Order placed with the wholesaler</p>
            <p className="mt-1 text-ink-soft">
              Committed at {clock(order.updatedAt)}, at the fixed price. Authorised by {by}.
            </p>
          </div>
          <p className="display text-[3rem] text-ink tabular">{money(order.totalCents)}</p>
        </div>
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {order.lines.map((l) => (
            <li key={l.productId} className="flex justify-between gap-3 py-2">
              <span>
                {l.quantity} × {shortProduct(l.name)}
                {l.substituteFor && <span className="text-ink-soft"> (swap for {shortProduct(l.substituteFor.name)})</span>}
              </span>
              <span className="shrink-0 tabular">{money(l.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Field label="Delivery">{day(latest)}</Field>
          <Field label="Confirmation">{order.confirmation ? "Signed by the wholesaler" : <Missing>Not signed</Missing>}</Field>
          {seq !== undefined && <Field label="In the ledger">at entry {seq}</Field>}
        </dl>
        <p className="mt-3 text-[0.92rem] text-ink-soft">{say("Anyone can check the confirmation against the wholesaler's published key at /.well-known/jwks.json.", names)}</p>
        <div className="mt-4">
          <Button kind="secondary" onClick={onNew}>
            New request
          </Button>
        </div>
      </div>
    </div>
  );
}
