"use client";

import { useEffect, useState } from "react";
import type { ApiError } from "../../_client/api";
import { api } from "../../_client/api";
import type { Interpretation } from "../../_client/interpret";
import type { NeedInput } from "@/core/need";
import type { Incomplete } from "./console";
import { amount, attr, clock, day, eur, humanize, roleLabel, ruleTitle, shortProduct } from "../../_ui/plain";
import { Target } from "../../_ui/target";
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
      <div className="p-4 sm:p-5">
        <blockquote className="font-display text-[1.55rem] font-semibold leading-tight sm:text-[1.8rem]">“{text}”</blockquote>
        <div className="min-h-[4.5rem]">
          {!need && busy && (
            <p className="mt-4 flex items-center gap-2 text-ink-soft">
              <Target size={20} tone="hollow" spin className="text-ink" /> {busy}
            </p>
          )}
          {need && (
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-ink/15 pt-3 sm:grid-cols-3 xl:grid-cols-4">
              <Field label="Item">{need.item.text}</Field>
              <Field label="Amount">
                {need.quantity ? amount(need.quantity.amount, need.quantity.unit) : need.sameAsLastTime ? "Same as last time" : <Missing>Not said</Missing>}
                {corrected && original?.quantity && <span className="block text-[0.9rem] font-medium text-ink-soft">corrected from {amount(original.quantity.amount, original.quantity.unit)}</span>}
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
          <div className="mt-3">
            <MemoryNote>{interp.memoryLine}</MemoryNote>
          </div>
        )}
        {interp && (
          <p className="mt-3 text-[0.9rem] text-ink-soft">
            {interp.noModel ? (
              <>No model read this: it is the earlier request&apos;s own fields. Everything after this line is plain code.</>
            ) : interp.offline ? (
              <>
                <span className="mr-1.5 border border-ink px-1.5 py-px font-semibold text-ink">Offline example</span>
                Read by {interp.model} in {interp.ms} ms, not by the model. Everything after this line is plain code.
              </>
            ) : interp.addedByBuyer?.length ? (
              <>
                Read by {interp.model}; the buyer added the {interp.addedByBuyer.map((m) => (m === "item" ? "item" : "amount")).join(" and ")}. Everything after this line is plain code.
              </>
            ) : (
              <>
                Read by {interp.model} in {interp.ms} ms. The model only fills these fields; everything after this line is plain code.
              </>
            )}
          </p>
        )}
        {busy && need && (
          <p className="mt-2 flex items-center gap-2 text-[0.95rem] text-ink-soft">
            <Target size={18} tone="hollow" spin className="text-ink" /> {busy}
          </p>
        )}
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
  return (
    <Paper>
      <form
        className="p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <blockquote className="font-display text-[1.55rem] font-semibold leading-tight sm:text-[1.8rem]">“{text}”</blockquote>
        <p className="mt-2 text-[1.02rem]">{incomplete.message} Add it here; everything else stays as read.</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-ink/15 pt-3 sm:grid-cols-3">
          <div>
            <dt className="text-[0.8rem] font-medium text-ink-soft">
              <label htmlFor="fix-item">Item</label>
            </dt>
            <dd className="mt-0.5">
              {needItem ? (
                <input id="fix-item" autoFocus value={item} onChange={(e) => setItem(e.target.value)} placeholder="e.g. lactose-free milk" className="min-h-11 w-full border-2 border-ink bg-paper px-2 font-semibold" />
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
                  <input id="fix-qty" autoFocus={!needItem} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="100" className="min-h-11 w-24 border-2 border-ink bg-paper px-2 font-semibold tabular" />
                  <select aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)} className="min-h-11 border-2 border-ink bg-paper px-1 font-semibold">
                    <option value="L">litres</option>
                    <option value="kg">kilos</option>
                    <option value="pack">packs</option>
                    <option value="pcs">pieces</option>
                  </select>
                </span>
              ) : (
                <span className="text-[1.05rem] font-semibold">{p.quantity ? amount(p.quantity.amount, p.quantity.unit) : "Same as last time"}</span>
              )}
            </dd>
          </div>
          <Field label="Deliver by">{p.deliverBy ? day(p.deliverBy) : <Missing>Not said</Missing>}</Field>
          {[...(p.requiredClaims ?? []), ...(p.item?.attributes ?? [])].length > 0 && <Field label="Must be">{[...(p.requiredClaims ?? []), ...(p.item?.attributes ?? [])].map(attr).join(", ")}</Field>}
        </dl>
        <div className="mt-4">
          <Button type="submit" kind="primary" disabled={!ready}>
            Continue with this
          </Button>
        </div>
      </form>
    </Paper>
  );
}

// ---------- 2. mistake check ----------

export function Concerns({ step, seen, onRespond, busyKey, names }: { step: Step; seen: Step["concerns"]; onRespond: (key: string, choice: string) => void; busyKey?: string; names: Names }) {
  if (seen.length === 0) {
    return (
      <Paper>
        <p className="p-4 text-[1.05rem] leading-snug">
          <strong>Nothing looks unusual.</strong> <span className="text-ink-soft">Dock compared the amount with what this kitchen usually orders and checked the delivery day, the order cut-off, duplicates and the kitchen&apos;s own rules, before asking for any price.</span>
        </p>
      </Paper>
    );
  }
  return (
    <div className="space-y-3">
      {seen.map((c) => {
        const open = step.state === "needs_confirmation" && step.concerns.some((x) => x.key === c.key);
        const ack = step.acknowledgements.find((a) => a.key === c.key);
        const fix = ack?.correctionId ? c.corrections.find((x) => x.id === ack.correctionId) : undefined;
        return (
          <Paper key={c.key} safety={open}>
            <div className="p-4 sm:p-5">
              <p className="font-display text-[1.45rem] font-bold leading-tight sm:text-[1.6rem]">{humanize(c.message, names)}</p>
              {open ? (
                <>
                  <p className="mt-1 text-ink-soft">{c.severity === "error" ? "This cannot go ahead as it is. Pick one:" : "Is this what you meant? One tap fixes it."}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {c.corrections.map((x, i) => (
                      <Button key={x.id} kind={i === 0 ? "primary" : "secondary"} busy={busyKey === `${c.key}:${x.id}`} disabled={!!busyKey} onClick={() => onRespond(c.key, x.id)}>
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
                </>
              ) : (
                <p className="mt-1 flex items-center gap-2 text-[1.02rem]">
                  <Target size={18} tone="ink" />
                  {ack?.action === "corrected" ? `Corrected: ${fix?.label ?? "changed"}.` : ack?.action === "confirmed" ? `Confirmed as intended by ${ack.by}.` : ack?.action === "cancelled" ? "Cancelled." : "Settled."}
                </p>
              )}
            </div>
          </Paper>
        );
      })}
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
}: {
  step: Step;
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
      <div className="divide-y divide-ink/15">
        {asked.map((q) => {
          const open = step.state === "needs_input" && step.questions.some((x) => x.id === q.id);
          const given = answers[q.id];
          return (
            <fieldset key={q.id} className="p-4 sm:p-5">
              <legend className="float-left w-full font-display text-[1.45rem] font-bold leading-tight">{q.text}</legend>
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
                  <input type="checkbox" className="size-5 accent-[var(--color-ink)]" checked={!!remember[q.id]} onChange={(e) => setRemember((r) => ({ ...r, [q.id]: e.target.checked }))} />
                  Remember this answer for the next order
                </label>
              ) : (
                given && <p className="mt-2 text-[0.98rem] text-ink-soft">Answered: {given.label}{given.remember ? ". Dock keeps it as a rule from now on." : "."}</p>
              )}
            </fieldset>
          );
        })}
        {(fromMemory.length > 0 || stated.length > 0) && (
          <div className="space-y-1.5 p-4 sm:p-5">
            <h3 className="font-semibold">{asked.length ? "Not asked, because the kitchen's memory answers it" : "Nothing to ask: the kitchen's memory answers it"}</h3>
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
  return (
    <div>
      {open && choices.length > 0 && onNarrow && (
        <div className="mb-3 space-y-2 bg-paper p-3">
          <p className="text-[0.95rem] text-ink-soft">The request did not say, so the cards cover more than one. Narrow it only if it matters:</p>
          {choices.map((q) => (
            <div key={q.id} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{q.text}</span>
              {q.options.map((o) => (
                <Button key={o.id} kind="secondary" className="min-h-9 px-3 text-[0.95rem]" busy={busyKey === `${q.id}:${o.id}`} disabled={!!busyKey} onClick={() => onNarrow(q.id, o.id, o.label)}>
                  {o.label}
                </Button>
              ))}
            </div>
          ))}
        </div>
      )}
      {step.preselected && open && (
        <p className="mb-2 text-[1rem]">
          <strong>Pre-selected:</strong> {humanize(step.preselected.reason, names)}
        </p>
      )}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 17rem), 1fr))" }}>
        {options.map((c) => {
          const pre = step.preselected?.optionId === c.optionId;
          const isChosen = chosen === c.optionId;
          const dim = !open && !isChosen;
          return (
            <article
              key={c.optionId}
              className={`flex flex-col bg-paper ${isChosen || (open && pre) ? "outline-[3px] outline-ink" : ""} ${c.match === "compromise" ? "border-2 border-dashed border-ink/60" : ""} ${dim ? "opacity-55" : ""}`}
              aria-label={`${c.rank ? RANK[c.rank] : "Option"}${c.match === "compromise" ? ", a compromise" : ""}${c.labels.length ? `: ${c.labels.map((l) => LABEL[l]).join(" and ")}` : ""}`}
            >
              <div aria-hidden className={c.signOff.length ? "hazard-thin h-2" : "h-[3px] bg-ink"} />
              <div className="flex flex-1 flex-col p-4">
                <h3 className="font-display text-[1.3rem] font-bold leading-tight">
                  {c.rank && <span className="mr-2">{RANK[c.rank]}</span>}
                  {c.labels.length > 0 && <span className={c.rank ? "font-semibold text-ink-soft" : ""}>{c.labels.map((l) => LABEL[l]).join(" + ")}</span>}
                </h3>
                {c.match === "compromise" && (
                  <p className="mt-1 text-[0.95rem] font-semibold leading-snug">Compromise: {(c.givesUp ?? []).map((g) => humanize(g.text, names).replace(/\.$/, "")).join("; ") || "does not meet the whole request"}.</p>
                )}
                <p className="mt-0.5 min-h-[2.75em] text-[0.95rem] leading-snug text-ink-soft">
                  {c.lines.map((l) => `${l.packs} × ${shortProduct(l.name)}${l.substituteFor ? " (swap)" : ""}`).join(" + ")}
                </p>
                <p className="mt-3 font-display text-[2.6rem] font-bold leading-none tabular">{eur(c.totalCents)}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-ink/15 pt-2">
                  <Field label="Arrives">{day(c.deliveryDate)}</Field>
                  <Field label="Amount">
                    {amount(c.delivered.amount, c.delivered.unit)}
                    {c.leftover.amount > 0 && <span className="block text-[0.85rem] font-medium text-ink-soft">+{amount(c.leftover.amount, c.leftover.unit)} over</span>}
                  </Field>
                  <Field label="Carbon">
                    {c.co2.kg === null ? <Missing>No carbon data</Missing> : <span className="tabular">{c.co2.kg.toLocaleString("en-US", { maximumFractionDigits: 1 })} kg CO2e</span>}
                    {c.co2.kg !== null && <span className="block text-[0.82rem] font-medium leading-tight text-ink-soft">product-group average</span>}
                  </Field>
                  <Field label="Delivered in full">{c.reliability === null ? <Missing>No data</Missing> : <span className="tabular">{Math.round(c.reliability * 100)} % of past deliveries</span>}</Field>
                  {c.orderBy && <Field label="Order by">{cutoffText(c.orderBy) ?? c.orderBy}</Field>}
                  {c.stockConfirmed === false && <Field label="Stock">not confirmed by the wholesaler</Field>}
                </dl>
                <ul className="mt-3 space-y-1 text-[0.95rem] leading-snug">
                  {c.pros.map((p) => (
                    <li key={p} className="grid grid-cols-[1rem_1fr]">
                      <span aria-label="For" className="font-bold">+</span>
                      {humanize(p, names)}
                    </li>
                  ))}
                  {c.cons.map((p) => (
                    <li key={p} className="grid grid-cols-[1rem_1fr] text-ink-soft">
                      <span aria-label="Against" className="font-bold text-ink">–</span>
                      {humanize(p, names)}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-4">
                  {open ? (
                    <Button kind={pre ? "primary" : "secondary"} className="w-full" busy={busyKey === c.optionId} disabled={!!busyKey} onClick={() => onChoose(c.optionId)}>
                      Get a fixed price for this
                    </Button>
                  ) : isChosen ? (
                    <p className="flex min-h-11 items-center gap-2 font-semibold">
                      <Target size={20} tone="ink" /> Chosen{step.chosen?.by ? ` by ${step.chosen.by.replace(/^agent .*/, "the agent")}` : ""}
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
      {step.notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-[0.98rem]">
          {step.notes.map((n) => (
            <li key={n}>{humanize(n, names)}</li>
          ))}
        </ul>
      )}
      {(step.signOffNotes ?? []).length > 0 && (
        <div className="mt-3">
          <p className="font-semibold">For the person who signs off</p>
          <ul className="mt-1 space-y-1 text-[0.98rem]">
            {step.signOffNotes!.map((n) => (
              <li key={n}>– {humanize(n, names)}</li>
            ))}
          </ul>
        </div>
      )}
      <Excluded step={step} names={names} />
    </div>
  );
}

function Excluded({ step, names }: { step: Step; names: Names }) {
  if (!step.excluded.length) return null;
  return (
    <details className="mt-2 text-[0.95rem]">
      <summary className="cursor-pointer py-2 font-semibold underline decoration-2 underline-offset-4">Why {step.excluded.length} other product{step.excluded.length === 1 ? " is" : "s are"} not offered</summary>
      <ul className="mt-1 space-y-0.5 text-ink-soft">
        {step.excluded.map((e, i) => (
          <li key={`${e.productId}-${i}`}>
            {names[e.productId] ? shortProduct(names[e.productId]) : `Product ${e.productId}`}: {humanize(e.reason, names)}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function NoOptions({ step, names, onNew }: { step: Step; names: Names; onNew: () => void }) {
  return (
    <Paper>
      <div className="p-4 sm:p-5">
        <p className="font-display text-[1.45rem] font-bold leading-tight">{step.state === "cancelled" ? "The request was cancelled. Nothing was ordered." : humanize(step.notes[0] ?? "Nothing fits.", names)}</p>
        {step.notes.slice(1).map((n) => (
          <p key={n} className="mt-1 text-ink-soft">
            {humanize(n, names)}
          </p>
        ))}
        <Excluded step={step} names={names} />
        <div className="mt-3">
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
  const left = Math.max(0, Date.parse(q.quote.expiresAt) - now);
  const mm = Math.floor(left / 60_000);
  const ss = Math.floor((left % 60_000) / 1000);
  const expired = left === 0;
  const preview = q.policyPreview;
  const lead =
    preview.outcome === "auto_approve"
      ? "The gate's preview: within the mandate, the agent may place this alone."
      : preview.outcome === "needs_human_approval"
        ? `The gate's preview: ${preview.approver.name} (${roleLabel(preview.approver.role)}) will have to sign off.`
        : "The gate's preview: this would be refused.";
  return (
    <Paper>
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[0.85rem] font-medium text-ink-soft">Total, signed by the wholesaler</p>
            <p className="font-display text-[3.2rem] font-bold leading-none tabular">{eur(q.quote.totalCents)}</p>
          </div>
          <div className="text-right" aria-live="off">
            <p className="text-[0.85rem] font-medium text-ink-soft">{expired ? "Price expired" : "Price holds for"}</p>
            <p className={`font-display text-[2.2rem] font-bold leading-none tabular ${expired ? "text-ink-soft line-through" : ""}`}>
              {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
            </p>
            <p className="text-[0.85rem] text-ink-soft">until {clock(q.quote.expiresAt)}</p>
          </div>
        </div>
        <table className="mt-4 w-full border-t border-ink/15 text-left text-[0.98rem]">
          <caption className="sr-only">Quoted lines</caption>
          <thead className="text-[0.82rem] text-ink-soft">
            <tr>
              <th className="py-1.5 pr-2 font-medium">Product</th>
              <th className="py-1.5 pr-2 text-right font-medium">Packs</th>
              <th className="hidden py-1.5 pr-2 text-right font-medium sm:table-cell">Per pack</th>
              <th className="py-1.5 pr-2 text-right font-medium">Line</th>
              <th className="py-1.5 text-right font-medium">Arrives</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/10">
            {q.quote.lines.map((l) => (
              <tr key={l.productId}>
                <td className="py-1.5 pr-2">
                  {shortProduct(l.name)}
                  {l.substituteFor && <span className="block text-[0.85rem] text-ink-soft">swap for {shortProduct(l.substituteFor.name)}</span>}
                </td>
                <td className="py-1.5 pr-2 text-right tabular">{l.quantity}</td>
                <td className="hidden py-1.5 pr-2 text-right tabular sm:table-cell">{eur(l.unitPriceCents)}</td>
                <td className="py-1.5 pr-2 text-right tabular">{eur(l.lineTotalCents)}</td>
                <td className="py-1.5 text-right">{day(l.deliveryDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[0.98rem]">{lead}</p>
        {preview.outcome !== "auto_approve" && (
          <ul className="mt-1 space-y-0.5 text-[0.95rem] text-ink-soft">
            {preview.reasons.filter((r) => !r.startsWith("Sent to ")).map((r) => (
              <li key={r}>– {humanize(r, names)}</li>
            ))}
          </ul>
        )}
        {!decided && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button kind="primary" busy={busy} onClick={onPlace} className="px-6">
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

export function Gate({ order, refusal, kitchen, names, streaming, byHand = false }: { order?: Order; refusal?: ApiError; kitchen: KitchenInfo; names: Names; streaming: boolean; byHand?: boolean }) {
  if (!order) {
    return (
      <Paper safety>
        <div className="p-4 sm:p-6">
          <Verdict tone="safety" title="Refused" sub={ruleTitle(refusal?.rule)} />
          <p className="mt-3 text-[1.05rem]">{humanize(refusal?.message ?? "The order was refused.", names)}</p>
        </div>
      </Paper>
    );
  }
  const d = order.decision;
  const rules = d.rules;
  const passed = rules.filter((r) => r.outcome === "pass").length;
  const a = order.approval;

  let body: React.ReactNode;
  if (order.status === "rejected") {
    const failed = rules.filter((r) => r.outcome === "fail");
    body = (
      <>
        <Verdict tone="safety" title={a ? "Refused at the re-check" : "Refused"} sub={failed.map((r) => ruleTitle(r.rule)).join(", ") || ruleTitle(refusal?.rule)} />
        <ul className="mt-3 space-y-1 text-[1.05rem] leading-snug">
          {failed.map((r) => (
            <li key={r.rule}>{humanize(r.reason, names)}</li>
          ))}
        </ul>
        <p className="mt-2 text-[0.95rem] text-ink-soft">Nothing was ordered. The refusal and its reason are in the ledger.</p>
      </>
    );
  } else if (a) {
    const escalated = rules.filter((r) => r.outcome === "escalate");
    const who = `${a.approver.name}, ${roleLabel(a.approver.role)}`;
    const how = a.signOff?.method === "passkey" ? "with their passkey" : a.signOff?.method === "link_token" ? "with the one-time link sent to their phone" : a.signOff?.method === "demo_tap" ? "with a demo tap (not verified)" : "";
    body = (
      <div className="grid gap-5 md:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          {a.status === "pending" ? (
            <Verdict tone="safety" title={`Waiting for ${a.approver.name}`} sub={`${roleLabel(a.approver.role)}, may sign up to ${eur(a.approver.maxApprovalCents)}`} spin />
          ) : a.status === "approved" ? (
            <Verdict tone="safety" title={`Signed off by ${a.approver.name}`} sub={`${who}, at ${clock(a.decidedAt ?? order.updatedAt)} ${how}`} />
          ) : (
            <Verdict tone="safety" title={`Declined by ${a.approver.name}`} sub={`${who}, at ${clock(a.decidedAt ?? order.updatedAt)}`} />
          )}
          <h3 className="mt-4 font-semibold">{a.status === "pending" ? "Why a person has to decide" : "Why a person had to decide"}</h3>
          <ul className="mt-1 space-y-1.5 leading-snug">
            {escalated.map((r) => (
              <li key={r.rule}>
                <strong>{ruleTitle(r.rule)}.</strong> {humanize(r.reason, names)}
              </li>
            ))}
          </ul>
          {a.note && <p className="mt-2 text-ink-soft">Note from {a.approver.name}: “{a.note}”</p>}
          {a.status === "pending" && (
            <p className="mt-3 flex items-center gap-2 text-[0.95rem] text-ink-soft">
              <span aria-hidden className="inline-block size-2.5 rounded-full bg-ink" />
              {streaming ? "Live: this updates the moment they decide." : "Checking every second for their decision."} The agent cannot approve its own order.
            </p>
          )}
        </div>
        {a.status === "pending" && <ApprovalPanel kitchen={kitchen} approvalId={a.approvalId} />}
      </div>
    );
  } else {
    body = (
      <>
        <Verdict tone="ink" title={byHand ? "Approved within the kitchen's mandate" : "Approved on the agent's own authority"} sub={`All ${rules.length} checks passed${byHand ? ", the same checks as an agent's order" : ""}`} />
        <p className="mt-3 text-[1.05rem]">{humanize(d.reasons[0] ?? "", names)}</p>
      </>
    );
  }

  return (
    <Paper safety={order.status !== "committed" || !!a}>
      <div className="p-4 sm:p-6">
        {body}
        <details className="mt-4 text-[0.95rem]">
          <summary className="cursor-pointer py-2 font-semibold underline decoration-2 underline-offset-4">
            All {rules.length} checks ({passed} passed)
          </summary>
          <ul className="mt-1 divide-y divide-ink/10">
            {rules.map((r) => (
              <li key={r.rule} className="grid gap-x-3 py-1.5 sm:grid-cols-[16rem_7rem_1fr]">
                <span className="font-semibold">{ruleTitle(r.rule)}</span>
                <span className={r.outcome === "pass" ? "text-ink-soft" : "font-semibold"}>{OUTCOME_WORD[r.outcome]}</span>
                <span className="text-ink-soft">
                  {humanize(r.reason, names)} <code className="font-mono text-[0.75rem]">{r.rule}</code>
                </span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </Paper>
  );
}

function Verdict({ tone, title, sub, spin }: { tone: "ink" | "safety"; title: string; sub: string; spin?: boolean }) {
  return (
    <div className="flex items-start gap-4">
      <Target size={64} tone={tone} spin={spin} className="shrink-0 [animation-duration:6s]" />
      <div className="min-w-0">
        <p className="font-display text-[2.1rem] font-bold leading-[1.05] tracking-tight sm:text-[2.6rem]">{title}</p>
        <p className="mt-1 text-[1.05rem] text-ink-soft">{sub}</p>
      </div>
    </div>
  );
}

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
    <figure className="w-full max-w-[15rem] md:w-60">
      <div className="aspect-square w-full bg-paper p-2 ring-[3px] ring-ink">
        {qr ? <div className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qr.qrSvg }} /> : <div className={`size-full ${error ? "" : "animate-pulse"} bg-concrete`} />}
      </div>
      <figcaption className="mt-2 text-[0.92rem] leading-snug">
        {error && <span className="text-ink-soft">No code: {error}</span>}
        {qr?.mode === "passkey" && <>Scan with {name}&apos;s phone. Approving needs their passkey.</>}
        {qr?.mode === "demo_link" && <>{name} is made up for this demo kitchen. Scan to sign off in their place, with the one-time link Dock sent to their phone.</>}
        {qr?.mode === "view_only" && <>{name} signs off with the link Dock sent to their phone.</>}
        {qr && (
          <a href={qr.url} target="_blank" rel="noreferrer" className="mt-1 block font-semibold underline decoration-2 underline-offset-4">
            Open the sign-off screen
          </a>
        )}
      </figcaption>
    </figure>
  );
}

// ---------- 7. signed order ----------

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
        <div className="p-4 sm:p-5">
          <p className="font-display text-[1.45rem] font-bold">Nothing was ordered: {order.approval?.approver.name ?? "the approver"} declined.</p>
          <div className="mt-3">
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
      <div aria-hidden className="h-[3px] bg-ink" />
      <div aria-hidden className="mt-[3px] h-[3px] bg-ink" />
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-display text-[1.6rem] font-bold leading-tight">Order placed with the wholesaler</p>
            <p className="text-ink-soft">
              Committed at {clock(order.updatedAt)}, at the quoted price. Authorised by {by}.
            </p>
          </div>
          <p className="font-display text-[2.8rem] font-bold leading-none tabular">{eur(order.totalCents)}</p>
        </div>
        <ul className="mt-3 divide-y divide-ink/10 border-t border-ink/15">
          {order.lines.map((l) => (
            <li key={l.productId} className="flex justify-between gap-3 py-1.5">
              <span>
                {l.quantity} × {shortProduct(l.name)}
                {l.substituteFor && <span className="text-ink-soft"> (swap for {shortProduct(l.substituteFor.name)})</span>}
              </span>
              <span className="shrink-0 tabular">{eur(l.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <Field label="Delivery">{day(latest)}</Field>
          <Field label="Confirmation">{order.confirmation ? "Signed by the wholesaler" : <Missing>Not signed</Missing>}</Field>
          {seq !== undefined && <Field label="Anchored in the ledger">at entry {seq}</Field>}
        </dl>
        <p className="mt-3 text-[0.92rem] text-ink-soft">{humanize("Anyone can check the confirmation against the wholesaler's published key at /.well-known/jwks.json.", names)}</p>
        <div className="mt-3">
          <Button kind="secondary" onClick={onNew}>
            New request
          </Button>
        </div>
      </div>
    </div>
  );
}
