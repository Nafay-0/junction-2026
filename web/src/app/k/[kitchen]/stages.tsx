"use client";

import { useEffect, useState } from "react";
import type { ApiError } from "../../_client/api";
import { api } from "../../_client/api";
import type { Interpretation } from "../../_client/interpret";
import type { NeedInput } from "@/core/need";
import type { Incomplete } from "./console";
import { money, moneyShort, num, say, shortProduct } from "../../_ui/plain";
import { useFormat, useText } from "../../_i18n/provider";
import { STAGES_TEXT } from "./stages.text";
import { Target } from "../../_ui/target";
import { Spinner, Tag, Working } from "../../_ui/kit";
import { Button, Field, MemoryNote, Missing, Paper } from "./ui";
import { cutoffText } from "./when";
import { SecondReadingLine } from "./second-reading";
import type { ApprovalQr, KitchenInfo, Order, Step } from "./types";
import { useProductName } from "./names";

type Names = Record<string, string>;

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
  const tx = useText(STAGES_TEXT);
  const f = useFormat();
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
              <Field label={tx.item}>{need.item.text}</Field>
              <Field label={tx.amount}>
                {need.quantity ? f.measure(need.quantity.amount, need.quantity.unit) : need.sameAsLastTime ? tx.sameAsLast : <Missing>{tx.notSaid}</Missing>}
                {corrected && original?.quantity && <span className="block text-[0.9rem] font-medium text-ink-soft">{tx.correctedFrom(f.measure(original.quantity.amount, original.quantity.unit))}</span>}
              </Field>
              <Field label={tx.deliverBy}>
                {need.deliverBy ? f.day(need.deliverBy) : <Missing>{tx.notSaid}</Missing>}
                {dateChanged && original?.deliverBy && <span className="block text-[0.9rem] font-medium text-ink-soft">{tx.changedFrom(f.day(original.deliverBy))}</span>}
              </Field>
              <Field label={tx.mattersMost}>{tx.optimise(need.optimise ?? "unstated")}</Field>
              {musts.length > 0 && <Field label={tx.mustBe}>{musts.map(f.attr).join(", ")}</Field>}
              {(need.item.excludedAttributes?.length ?? 0) > 0 && <Field label={tx.mustNotBe}>{need.item.excludedAttributes!.map(f.attr).join(", ")}</Field>}
              {(need.forbiddenAllergens?.length ?? 0) > 0 && <Field label={tx.noAllergens}>{need.forbiddenAllergens!.map(f.attr).join(", ")}</Field>}
              {need.sameAsLastTime && need.quantity && <Field label={tx.sameAsLast}>{tx.yes}</Field>}
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
              <>{tx.readNoModel}</>
            ) : interp.offline ? (
              <>
                <Tag>{tx.offlineTag}</Tag>
                {tx.readOffline(interp.model, interp.ms)}
              </>
            ) : interp.addedByBuyer?.length ? (
              <>{tx.readAdded(interp.model, interp.addedByBuyer)}</>
            ) : (
              <>{tx.readModel(interp.model, interp.ms)}</>
            )}
          </p>
        )}
        {interp && !interp.offline && !interp.noModel && <SecondReadingLine reading={step?.secondReading} />}
        {busy && need && <Working className="mt-2 text-[0.95rem]">{busy}</Working>}
      </div>
    </Paper>
  );
}

/** The reader understood part of the request: show that, and ask for exactly what is missing, as fields. */
function CompleteNeed({ text, incomplete, onComplete }: { text: string; incomplete: Incomplete; onComplete: (need: NeedInput) => void }) {
  const tx = useText(STAGES_TEXT);
  const f = useFormat();
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
        <p className="mt-2 text-[1.02rem]">
          {incomplete.message} {tx.addHere}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-3 sm:grid-cols-3">
          <div>
            <dt className="text-[0.8rem] font-medium text-ink-soft">
              <label htmlFor="fix-item">{tx.item}</label>
            </dt>
            <dd className="mt-0.5">
              {needItem ? (
                <input id="fix-item" autoFocus value={item} onChange={(e) => setItem(e.target.value)} placeholder={tx.itemPlaceholder} className={`${input} w-full`} />
              ) : (
                <span className="text-[1.05rem] font-semibold">{p.item?.text}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[0.8rem] font-medium text-ink-soft">
              <label htmlFor="fix-qty">{tx.amount}</label>
            </dt>
            <dd className="mt-0.5">
              {needQty ? (
                <span className="flex gap-1">
                  <input id="fix-qty" autoFocus={!needItem} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="100" className={`${input} w-24 tabular`} />
                  <select aria-label={tx.unit} value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)} className={`${input} px-1`}>
                    <option value="L">{tx.units.L}</option>
                    <option value="kg">{tx.units.kg}</option>
                    <option value="pack">{tx.units.pack}</option>
                    <option value="pcs">{tx.units.pcs}</option>
                  </select>
                </span>
              ) : (
                <span className="text-[1.05rem] font-semibold">{p.quantity ? f.measure(p.quantity.amount, p.quantity.unit) : tx.sameAsLast}</span>
              )}
            </dd>
          </div>
          <Field label={tx.deliverBy}>{p.deliverBy ? f.day(p.deliverBy) : <Missing>{tx.notSaid}</Missing>}</Field>
          {[...(p.requiredClaims ?? []), ...(p.item?.attributes ?? [])].length > 0 && <Field label={tx.mustBe}>{[...(p.requiredClaims ?? []), ...(p.item?.attributes ?? [])].map(f.attr).join(", ")}</Field>}
        </dl>
        <div className="mt-4">
          <Button type="submit" kind="go" disabled={!ready}>
            {tx.continue}
          </Button>
        </div>
      </form>
    </Paper>
  );
}

// ---------- 2. lookup: the mistake check, and what memory answered ----------

export function Concerns({ step, seen, onRespond, busyKey, names, remembered }: { step: Step; seen: Step["concerns"]; onRespond: (key: string, choice: string) => void; busyKey?: string; names: Names; remembered?: { text: string }[] }) {
  const tx = useText(STAGES_TEXT);
  const memory = remembered && remembered.length > 0 && (
    <div className="bg-lavender px-4 py-3 sm:px-5">
      <p className="text-[0.88rem] font-semibold text-lavender-deep">{tx.remembered}</p>
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
              <strong>{tx.nothingUnusual}</strong> <span className="text-ink-soft">{tx.nothingUnusualWhy}</span>
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
        const title = tx.concernTitle(c.code);
        return (
          <article key={c.key} className={`bg-paper ${open ? "outline-[3px] outline-petrol" : ""}`}>
            <div aria-hidden className={open ? "h-1.5 bg-lime" : "h-[3px] bg-petrol"} />
            <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <p className="text-[0.88rem] font-semibold text-petrol">{open ? (c.severity === "error" ? tx.cannotGoAhead : tx.didYouMean) : tx.checked}</p>
                <p className="mt-1 max-w-[52ch] text-[1.35rem] font-semibold leading-snug sm:text-[1.5rem]">{title ?? message}</p>
                {title && (
                  <p lang="en" className="mt-1 max-w-[60ch] text-[1.02rem] leading-snug text-ink-soft">
                    {message}
                  </p>
                )}
                {!open && (
                  <p className="mt-2 flex items-center gap-2 text-[1.02rem]">
                    <span aria-hidden className="flex size-5 items-center justify-center bg-petrol text-[0.75rem] font-bold text-paper">
                      ✓
                    </span>
                    {ack?.action === "corrected" ? tx.corrected(fix?.label) : ack?.action === "confirmed" ? tx.confirmedBy(ack.by) : ack?.action === "cancelled" ? tx.cancelledAck : tx.settled}
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
                      {tx.yesMeant}
                    </Button>
                  )}
                  {c.corrections.length === 0 && !c.confirmable && <p className="text-ink-soft">{tx.startNew}</p>}
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
  const tx = useText(STAGES_TEXT);
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
                  {tx.rememberAnswer}
                </label>
              ) : (
                given && (
                  <p className="mt-2 text-[0.98rem] text-ink-soft">{tx.answered(given.label, given.remember)}</p>
                )
              )}
            </fieldset>
          );
        })}
        {!hideMemory && (fromMemory.length > 0 || stated.length > 0) && (
          <div className="space-y-1.5 bg-lavender p-4 sm:p-6">
            <h3 className="font-semibold text-lavender-deep">{asked.length ? tx.notAskedMemory : tx.nothingToAsk}</h3>
            {stated.map((r) => {
              const m = /^Stated by (.+?): (.*)$/.exec(r.text);
              const who = m?.[1].replace(/\s*\(.*\)$/, "") ?? tx.aPerson;
              return (
                <MemoryNote key={r.text}>
                  <strong>{m?.[2] ?? r.text}</strong>
                  {tx.statedRule(who)}
                </MemoryNote>
              );
            })}
            {fromMemory
              .filter((m) => m.source === "learned")
              .map((m) => (
                <MemoryNote key={m.question.id}>
                  {m.question.text} <strong>{m.label}</strong>
                  {tx.learned(evidenceOf(m.text, tx.evidence))}
                </MemoryNote>
              ))}
          </div>
        )}
      </div>
    </Paper>
  );
}

/** " (10 of your last 10 milk orders)" out of a learned preference's text, in the buyer's language. */
function evidenceOf(text: string, say: (n: number, of: number, what: string) => string): string {
  const m = /(\d+) of your last (\d+) ([\w ]+?) orders/.exec(text);
  return m ? say(Number(m[1]), Number(m[2]), m[3]) : "";
}

// ---------- 4. options ----------

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
  // "kg CO2e" is the same in all three languages
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
  const tx = useText(STAGES_TEXT);
  const f = useFormat();
  const pn = useProductName();
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
          <p className="text-[0.95rem] text-lavender-deep">{tx.narrow}</p>
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
            <strong>{tx.preselected}</strong> {say(step.preselected.reason, names)}
          </p>
        ) : (
          <span />
        )}
        {options.length > 1 && (
          <div role="group" aria-label={tx.showAs} className="flex">
            <button type="button" aria-pressed={!compare} onClick={() => setCompare(false)} className={`min-h-10 border-2 border-petrol px-3 text-[0.92rem] font-semibold ${!compare ? "bg-petrol text-paper" : "bg-paper text-petrol"}`}>
              {tx.cards}
            </button>
            <button type="button" aria-pressed={compare} onClick={() => setCompare(true)} className={`-ml-[2px] min-h-10 border-2 border-petrol px-3 text-[0.92rem] font-semibold ${compare ? "bg-petrol text-paper" : "bg-paper text-petrol"}`}>
              {tx.compare}
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
                aria-label={`${tx.rank(c.rank)}${c.match === "compromise" ? tx.aCompromise : ""}${c.labels.length ? `: ${c.labels.map((l) => tx.label(l)).join(tx.and)}` : ""}`}
              >
                <div aria-hidden className={c.signOff.length ? "hazard-thin h-2" : top ? "h-1.5 bg-petrol-deep" : "h-[3px] bg-petrol"} />
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="display text-[1.6rem] text-ink">{tx.rank(c.rank)}</h3>
                    <RankMark rank={c.rank} />
                  </div>
                  {c.labels.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {c.labels.map((l) => (
                        <Tag key={l} tone={l === "same_as_last_time" ? "agent" : "plain"}>
                          {tx.label(l)}
                        </Tag>
                      ))}
                    </p>
                  )}
                  {c.match === "compromise" && <p className="mt-2 text-[0.95rem] font-semibold leading-snug">{tx.compromise((c.givesUp ?? []).map((g) => say(g.text, names).replace(/\.$/, "")).join("; "))}</p>}
                  <p className="mt-2 min-h-[2.75em] text-[0.95rem] leading-snug text-ink-soft">{c.lines.map((l) => `${l.packs} × ${shortProduct(pn(l.productId, l.name))}${l.substituteFor ? tx.swap : ""}`).join(" + ")}</p>
                  <p className="display mt-3 text-[2.6rem] text-ink tabular">{money(c.totalCents)}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line pt-3">
                    <Field label={tx.arrives}>{f.day(c.deliveryDate)}</Field>
                    <Field label={tx.amount}>
                      {f.measure(c.delivered.amount, c.delivered.unit)}
                      {c.leftover.amount > 0 && <span className="block text-[0.85rem] font-medium text-ink-soft">{tx.over(f.measure(c.leftover.amount, c.leftover.unit))}</span>}
                    </Field>
                    <Field label={tx.carbon}>
                      {co2Text(c) ? <span className="tabular">{co2Text(c)}</span> : <Missing>{tx.noCarbon}</Missing>}
                      {c.co2.kg !== null && <span className="block text-[0.82rem] font-medium leading-tight text-ink-soft">{tx.groupAverage}</span>}
                    </Field>
                    <Field label={tx.deliveredInFull}>{c.reliability === null ? <Missing>{tx.noData}</Missing> : <span className="tabular">{tx.pastDeliveries(Math.round(c.reliability * 100))}</span>}</Field>
                    {c.orderBy && <Field label={tx.orderBy}>{cutoffText(c.orderBy, f.lang) ?? c.orderBy}</Field>}
                    {c.stockConfirmed === false && <Field label={tx.stock}>{tx.stockNotConfirmed}</Field>}
                  </dl>
                  <ul className="mt-3 space-y-1 text-[0.95rem] leading-snug">
                    {c.pros.map((p) => (
                      <li key={p} className="grid grid-cols-[1.1rem_1fr]">
                        <span aria-label={tx.pro} className="font-bold text-petrol">
                          +
                        </span>
                        {say(p, names)}
                      </li>
                    ))}
                    {c.cons.map((p) => (
                      <li key={p} className="grid grid-cols-[1.1rem_1fr] text-ink-soft">
                        <span aria-label={tx.con} className="font-bold text-ink">
                          –
                        </span>
                        {say(p, names)}
                      </li>
                    ))}
                  </ul>
                  {c.signOff.length > 0 && <p className="mt-3 border-l-4 border-safety-ink bg-safety/25 px-2 py-1 text-[0.9rem] leading-snug">{tx.needsSignOff}</p>}
                  <div className="mt-auto pt-4">
                    {open ? (
                      <Button kind={pre ? "go" : "secondary"} className="w-full" busy={busyKey === c.optionId} disabled={!!busyKey} onClick={() => onChoose(c.optionId)}>
                        {tx.getPrice}
                      </Button>
                    ) : isChosen ? (
                      <p className="flex min-h-11 items-center gap-2 font-semibold text-petrol">
                        <span aria-hidden className="flex size-6 items-center justify-center bg-petrol text-[0.8rem] text-paper">
                          ✓
                        </span>
                        {tx.chosenBy(step.chosen?.by)}
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
          <p className="font-semibold">{tx.forSigner}</p>
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
  const pn = useProductName();
  const tx = useText(STAGES_TEXT);
  const f = useFormat();
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
      {on && <span className="sr-only">{tx.bestHere}</span>}
    </span>
  );
  const rows: { label: string; cell: (c: Card) => React.ReactNode }[] = [
    { label: tx.total, cell: (c) => mark(c.totalCents === cheapest, <span className="display text-[1.5rem] tabular">{money(c.totalCents)}</span>) },
    { label: tx.what, cell: (c) => c.lines.map((l) => `${l.packs} × ${shortProduct(pn(l.productId, l.name))}${l.substituteFor ? tx.swap : ""}`).join(" + ") },
    { label: tx.arrives, cell: (c) => mark(c.deliveryDate === earliest && options.some((o) => o.deliveryDate !== earliest), f.day(c.deliveryDate)) },
    { label: tx.amount, cell: (c) => `${f.measure(c.delivered.amount, c.delivered.unit)}${c.leftover.amount > 0 ? tx.overInline(f.measure(c.leftover.amount, c.leftover.unit)) : ""}` },
    { label: tx.carbon, cell: (c) => (co2Text(c) ? mark(c.co2.kg === greenest, co2Text(c)) : <Missing>{tx.noData}</Missing>) },
    { label: tx.deliveredInFull, cell: (c) => (c.reliability === null ? <Missing>{tx.noData}</Missing> : mark(c.reliability === surest, `${Math.round(c.reliability * 100)} %`)) },
    { label: tx.orderBy, cell: (c) => (c.orderBy ? (cutoffText(c.orderBy, f.lang) ?? c.orderBy) : tx.noCutoff) },
    { label: tx.signOff, cell: (c) => (c.signOff.length ? tx.personSigns : tx.agentMay) },
    {
      label: tx.forAgainst,
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
        <caption className="sr-only">{tx.sideBySide}</caption>
        <thead>
          <tr className="border-b border-line">
            <th className="w-40 px-4 py-3" />
            {options.map((c) => (
              <th key={c.optionId} scope="col" className={`px-3 py-3 align-bottom ${chosen === c.optionId ? "bg-petrol-soft" : ""}`}>
                <span className="flex items-center gap-2">
                  <span className="display text-[1.5rem]">{tx.rank(c.rank)}</span>
                  <RankMark rank={c.rank} />
                </span>
                <span className="block text-[0.85rem] font-medium text-ink-soft">{c.labels.map((l) => tx.label(l)).join(", ") || (c.match === "compromise" ? tx.compromiseShort : "")}</span>
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
                    {tx.fixPrice}
                  </Button>
                ) : chosen === c.optionId ? (
                  <span className="font-semibold text-petrol">{tx.chosen}</span>
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
  const tx = useText(STAGES_TEXT);
  if (!step.excluded.length) return null;
  return (
    <details className="mt-3 text-[0.95rem]">
      <summary className="min-h-10 cursor-pointer py-2 font-semibold text-petrol underline decoration-2 underline-offset-4">
        {tx.whyExcluded(step.excluded.length)}
      </summary>
      <ul className="mt-1 space-y-0.5 text-ink-soft">
        {step.excluded.map((e, i) => (
          <li key={`${e.productId}-${i}`}>
            {names[e.productId] ? shortProduct(names[e.productId]) : tx.anotherProduct}: {say(e.reason, names)}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function NoOptions({ step, names, onNew }: { step: Step; names: Names; onNew: () => void }) {
  const tx = useText(STAGES_TEXT);
  return (
    <Paper>
      <div className="p-4 sm:p-6">
        <p className="text-[1.35rem] font-semibold leading-snug">{step.state === "cancelled" ? tx.cancelledRequest : say(step.notes[0] ?? tx.nothingFits, names)}</p>
        {step.notes.slice(1).map((n) => (
          <p key={n} className="mt-1 text-ink-soft">
            {say(n, names)}
          </p>
        ))}
        <Excluded step={step} names={names} />
        <div className="mt-4">
          <Button kind="primary" onClick={onNew}>
            {tx.newRequest}
          </Button>
        </div>
      </div>
    </Paper>
  );
}

// ---------- 5. fixed price ----------

export function Quote({ q, names, decided, busy, onPlace, onNew }: { q: NonNullable<Step["quote"]>; names: Names; decided: boolean; busy: boolean; onPlace: () => void; onNew: () => void }) {
  const pn = useProductName();
  const tx = useText(STAGES_TEXT);
  const f = useFormat();
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
      ? tx.withinMandate
      : preview.outcome === "needs_human_approval"
        ? tx.beyondMandate(preview.approver.name, f.role(preview.approver.role))
        : tx.wouldRefuse;
  return (
    <Paper>
      <div className="p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <p className="text-[0.88rem] font-medium text-ink-soft">{tx.totalSigned}</p>
            <p className="display text-[3.4rem] text-ink tabular">{money(q.quote.totalCents)}</p>
          </div>
          <div className="min-w-[12rem] flex-1 sm:max-w-[18rem]" aria-live="off">
            <p className="flex items-baseline justify-between gap-3 text-[0.88rem] font-medium text-ink-soft">
              <span>{expired ? tx.priceExpired : decided ? tx.priceHeld : tx.priceHolds}</span>
              <span>{tx.until(f.clock(q.quote.expiresAt))}</span>
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
          <caption className="sr-only">{tx.quotedLines}</caption>
          <thead className="border-y border-line text-[0.82rem] text-ink-soft">
            <tr>
              <th className="py-2 pr-2 font-medium">{tx.product}</th>
              <th className="py-2 pr-2 text-right font-medium">{tx.packs}</th>
              <th className="hidden py-2 pr-2 text-right font-medium sm:table-cell">{tx.perPack}</th>
              <th className="py-2 pr-2 text-right font-medium">{tx.line}</th>
              <th className="py-2 text-right font-medium">{tx.arrives}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {q.quote.lines.map((l) => (
              <tr key={l.productId}>
                <td className="py-2 pr-2">
                  {shortProduct(pn(l.productId, l.name))}
                  {l.substituteFor && <span className="block text-[0.85rem] text-ink-soft">{tx.swapFor(shortProduct(l.substituteFor.name))}</span>}
                </td>
                <td className="py-2 pr-2 text-right tabular">{l.quantity}</td>
                <td className="hidden py-2 pr-2 text-right tabular sm:table-cell">{money(l.unitPriceCents)}</td>
                <td className="py-2 pr-2 text-right tabular">{money(l.lineTotalCents)}</td>
                <td className="py-2 text-right">{f.day(l.deliveryDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={`mt-4 flex items-start gap-3 px-3 py-2.5 ${preview.outcome === "auto_approve" ? "bg-mist" : "border-l-[6px] border-safety-ink bg-safety/20"}`}>
          {preview.outcome !== "auto_approve" && <Target size={22} tone="safety" className="mt-0.5 shrink-0" />}
          <div>
            <p className="font-semibold">{tx.preview(lead)}</p>
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
              {tx.place}
            </Button>
            {expired && <span className="text-[0.95rem] text-ink-soft">{tx.expiredHint}</span>}
            <Button kind="quiet" onClick={onNew}>
              {tx.startAgain}
            </Button>
          </div>
        )}
      </div>
    </Paper>
  );
}

// ---------- 6. the gate ----------

/**
 * The gate's decision. When it stops an order this is the loudest thing on the customer side: a black slab in a
 * hazard frame, the crash-test mark, the barrier arms closing. When it passes an order it is a quiet white plate.
 * `withSignOff` puts the sign-off (who, the QR code, the stamp) inside the same plate, for pages without a lane.
 */
export function Gate({ order, refusal, kitchen, names, streaming, byHand = false, withSignOff = true }: { order?: Order; refusal?: ApiError; kitchen: KitchenInfo; names: Names; streaming: boolean; byHand?: boolean; withSignOff?: boolean }) {
  const tx = useText(STAGES_TEXT);
  const f = useFormat();
  if (!order) {
    return (
      <GateSlab title={tx.refusedAtGate} sub={f.ruleTitle(refusal?.rule)}>
        <p className="text-[1.1rem] leading-snug text-paper">{say(refusal?.message ?? tx.orderRefused, names)}</p>
        <p className="mt-2 text-[0.95rem] text-paper/70">{tx.nothingOrdered}</p>
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
      <GateSlab title={a ? tx.refusedRecheck : tx.refusedAtGate} sub={failed.map((r) => f.ruleTitle(r.rule)).join(", ") || f.ruleTitle(refusal?.rule)}>
        <ul className="space-y-1 text-[1.08rem] leading-snug text-paper">
          {failed.map((r) => (
            <li key={r.rule}>{say(r.reason, names)}</li>
          ))}
        </ul>
        <p className="mt-2 text-[0.95rem] text-paper/70">{tx.nothingOrdered}</p>
        {checks}
      </GateSlab>
    );
  }
  if (a) {
    const escalated = rules.filter((r) => r.outcome === "escalate");
    return (
      <div className="space-y-3">
        <GateSlab title={tx.stoppedAtGate} sub={tx.mustSign(a.approver.name, f.role(a.approver.role))} closed={a.status === "pending"}>
          <ul className="space-y-2 leading-snug">
            {escalated.map((r) => (
              <li key={r.rule} className="text-paper">
                <strong className="text-safety">{f.ruleTitle(r.rule)}.</strong> <span className="text-paper/90">{say(r.reason, names)}</span>
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
            <p className="display text-[2.2rem] text-ink sm:text-[2.6rem]">{byHand ? tx.passedByHand : tx.passedAlone}</p>
            <p className="mt-1 text-[1.05rem] text-ink-soft">{tx.allPassed(rules.length, byHand)}</p>
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
            <p className="display hyphens-manual break-words text-[2.4rem] leading-[0.95] text-safety sm:text-[3.6rem]">{title}</p>
            <p className="mt-2 max-w-[60ch] text-[1.1rem] leading-snug text-paper">{sub}</p>
          </div>
        </div>
        <div className="mt-5 sm:ml-[6.5rem]">{children}</div>
      </div>
    </div>
  );
}

function ChecksList({ rules, names, dark }: { rules: Order["decision"]["rules"]; names: Names; dark: boolean }) {
  const tx = useText(STAGES_TEXT);
  const f = useFormat();
  const passed = rules.filter((r) => r.outcome === "pass").length;
  return (
    <details className={`mt-4 text-[0.95rem] ${dark ? "text-paper" : ""}`}>
      <summary className={`min-h-10 cursor-pointer py-2 font-semibold underline decoration-2 underline-offset-4 ${dark ? "text-paper" : "text-petrol"}`}>
        {tx.allChecks(rules.length, passed)}
      </summary>
      <ul className={`mt-1 divide-y ${dark ? "divide-paper/15" : "divide-line"}`}>
        {rules.map((r) => (
          <li key={r.rule} className="grid gap-x-3 py-1.5 sm:grid-cols-[16rem_8rem_1fr]">
            <span className="font-semibold">{f.ruleTitle(r.rule)}</span>
            <span className={r.outcome === "pass" ? (dark ? "text-paper/60" : "text-ink-soft") : dark ? "font-semibold text-safety" : "font-semibold"}>{tx.outcome(r.outcome)}</span>
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
  const tx = useText(STAGES_TEXT);
  const f = useFormat();
  const a = order.approval;
  const now = useNow(1000);
  if (!a) return null;
  const how = a.signOff?.method === "passkey" ? tx.howPasskey : a.signOff?.method === "link_token" ? tx.howLink : a.signOff?.method === "demo_tap" ? tx.howDemo : "";
  if (a.status === "pending") {
    const since = Math.max(0, Math.floor((now - Date.parse(a.requestedAt)) / 1000));
    return (
      <div className="border-[3px] border-safety-ink bg-paper">
        <div aria-hidden className="hazard h-3" />
        <div className="grid gap-6 p-4 sm:p-6 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[0.95rem] font-semibold">
              <span aria-hidden className="breathe inline-block size-3 bg-safety-ink" />
              {tx.waitingPerson}
            </p>
            <p className="display mt-2 text-[2.6rem] leading-[0.95] text-ink sm:text-[3.2rem]">{a.approver.name}</p>
            <p className="mt-1 text-[1.1rem]">{tx.maySign(f.role(a.approver.role), moneyShort(a.approver.maxApprovalCents))}</p>
            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:max-w-md">
              <div>
                <dt className="text-[0.8rem] font-medium text-ink-soft">{tx.asked}</dt>
                <dd className="display text-[2rem] tabular" aria-live="off">
                  {since < 60 ? `${since} s` : `${Math.floor(since / 60)} min ${String(since % 60).padStart(2, "0")} s`}
                  <span className="ml-1 font-sans text-[0.9rem] font-medium text-ink-soft">{tx.ago}</span>
                </dd>
              </div>
              <div>
                <dt className="text-[0.8rem] font-medium text-ink-soft">{tx.order}</dt>
                <dd className="display text-[2rem] tabular">{money(order.totalCents)}</dd>
              </div>
            </dl>
            <p className="mt-4 text-[0.95rem] text-ink-soft">{streaming ? tx.live : tx.polling}</p>
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
          <p className="display text-[2.4rem] leading-none">{approved ? tx.stampSigned : tx.stampDeclined}</p>
          <p className="mt-1 text-[1rem] font-semibold">{tx.stampLine(a.approver.name, f.clock(a.decidedAt ?? order.updatedAt))}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[1.1rem] leading-snug">{tx.decided(approved, a.approver.name, f.role(a.approver.role), f.clock(a.decidedAt ?? order.updatedAt), how)}</p>
          {a.note && <p className="mt-1 text-ink-soft">{tx.note(a.note)}</p>}
          {approved && <p className="mt-1 text-ink-soft">{tx.rechecked}</p>}
        </div>
      </div>
    </Paper>
  );
}

/** A phone, drawn: the code to scan sits on its screen, so the hand-off reads as "pick up your phone". */
export function ApprovalPanel({ kitchen, approvalId }: { kitchen: KitchenInfo; approvalId: string }) {
  const tx = useText(STAGES_TEXT);
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
  const name = qr?.approver.name ?? tx.theApprover;
  return (
    <figure className="mx-auto w-full max-w-[15rem] md:w-56">
      <div className="rounded-[1.6rem] bg-safety-ink p-2.5 pb-4">
        <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-paper/25" />
        <div className="overflow-hidden rounded-[0.9rem] bg-paper">
          <div aria-hidden className="hazard-thin h-2" />
          <div className="p-2.5">
            <p className="text-center text-[0.8rem] font-semibold leading-tight">{tx.phoneStopped}</p>
            <div className="mt-1.5 aspect-square w-full">
              {qr ? <div className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qr.qrSvg }} /> : <div className={`size-full ${error ? "bg-mist" : "animate-pulse bg-mist"}`} />}
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-[0.92rem] leading-snug">
        {error && <span className="text-ink-soft">{tx.noCode(error)}</span>}
        {qr?.mode === "passkey" && <>{tx.qrPasskey(name)}</>}
        {qr?.mode === "demo_link" && <>{tx.qrDemo(name)}</>}
        {qr?.mode === "view_only" && <>{tx.qrView(name)}</>}
        {qr?.mode === "enrol" && <>{tx.qrEnrol(name)}</>}
        {qr?.mode === "no_device" && (
          <>
            {tx.qrNoDevice(name)}
            <a href={`/k/${encodeURIComponent(kitchen.slug)}/agent#devices`} className="mt-1 block font-semibold text-petrol underline decoration-2 underline-offset-4">
              {tx.addDevice}
            </a>
          </>
        )}
        {qr && qr.mode !== "no_device" && (
          <a href={qr.url} target="_blank" rel="noreferrer" className="mt-1 block font-semibold text-petrol underline decoration-2 underline-offset-4">
            {qr.mode === "enrol" ? tx.becomeApprover : tx.openSignOff}
          </a>
        )}
        {qr?.orderId && qr.status === "pending" && <WithdrawButton kitchen={kitchen} orderId={qr.orderId} />}
        {!qr && !error && (
          <span className="flex items-center gap-2 text-ink-soft">
            <Spinner size={14} /> {tx.preparing}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/** The buyer takes the waiting order back: it stops holding the weekly budget, and the approver's phone shows it withdrawn. */
function WithdrawButton({ kitchen, orderId }: { kitchen: KitchenInfo; orderId: string }) {
  const tx = useText(STAGES_TEXT);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>();
  async function withdraw() {
    setBusy(true);
    const r = await api<{ order: Order }>("POST", `/ui-api/kitchens/${encodeURIComponent(kitchen.slug)}/call`, { method: "POST", path: `/api/v1/orders/${orderId}/withdraw`, body: { reason: "withdrawn from the kitchen portal" } });
    setBusy(false);
    setDone(r.ok ? tx.withdrawn : r.error.message);
  }
  if (done) return <span className="mt-2 block text-ink-soft">{done}</span>;
  return (
    <span className="mt-2 block">
      <Button kind="quiet" busy={busy} onClick={() => void withdraw()}>
        {tx.withdraw}
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
  const pn = useProductName();
  const tx = useText(STAGES_TEXT);
  const f = useFormat();
  if (order.status === "declined") {
    return (
      <Paper>
        <div className="p-4 sm:p-6">
          <p className="text-[1.35rem] font-semibold">{tx.declinedNothing(order.approval?.approver.name)}</p>
          <div className="mt-4">
            <Button kind="primary" onClick={onNew}>
              {tx.newRequest}
            </Button>
          </div>
        </div>
      </Paper>
    );
  }
  const seq = ledgerSeq(order.confirmation);
  const latest = order.lines.map((l) => l.deliveryDate).sort().at(-1)!;
  const by = order.approval?.status === "approved" ? `${order.approval.approver.name} (${f.role(order.approval.approver.role)})` : tx.byAgent;
  return (
    <div className="bg-paper">
      <div aria-hidden className="h-2 bg-petrol-deep" />
      <div className="p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="display text-[2.2rem] text-petrol-deep">{tx.placed}</p>
            <p className="mt-1 text-ink-soft">{tx.committed(f.clock(order.updatedAt), by)}</p>
          </div>
          <p className="display text-[3rem] text-ink tabular">{money(order.totalCents)}</p>
        </div>
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {order.lines.map((l) => (
            <li key={l.productId} className="flex justify-between gap-3 py-2">
              <span>
                {l.quantity} × {shortProduct(pn(l.productId, l.name))}
                {l.substituteFor && <span className="text-ink-soft">{tx.swapParen(shortProduct(l.substituteFor.name))}</span>}
              </span>
              <span className="shrink-0 tabular">{money(l.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Field label={tx.delivery}>{f.day(latest)}</Field>
          <Field label={tx.confirmation}>{order.confirmation ? tx.signedByWholesaler : <Missing>{tx.notSigned}</Missing>}</Field>
          {seq !== undefined && <Field label={tx.inLedger}>{tx.atEntry(seq)}</Field>}
        </dl>
        <p className="mt-3 text-[0.92rem] text-ink-soft">{say(tx.jwks, names)}</p>
        <div className="mt-4">
          <Button kind="secondary" onClick={onNew}>
            {tx.newRequest}
          </Button>
        </div>
      </div>
    </div>
  );
}
