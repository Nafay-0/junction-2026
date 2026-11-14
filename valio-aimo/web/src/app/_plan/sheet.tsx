"use client";

import { useState } from "react";
import type { PlanEdit } from "@/server/agent/menu/service";
import type { PlanWire } from "@/server/agent/menu/wire";
import { money } from "../_ui/plain";
import { dayL } from "../_i18n/format";
import type { Lang } from "../_i18n/lang";
import { useFormat, useText } from "../_i18n/provider";
import { SHEET_TEXT } from "./sheet.text";
import { Check, ChevronDown, Sparkles, UtensilsCrossed } from "lucide-react";
import { Card, IconDisc } from "../_ui/kit";
import { Btn, Chip, Field, Sheet, Spinner } from "./ui";

type Line = PlanWire["lines"][number];
type Doubt = Line["doubts"][number];

const CLOCK_PREFIX: Record<Lang, string> = { en: "", fi: "klo ", sv: "kl. " };

/** "2026-11-15T17:00:00+0200" as "Sun 15.11. 17.00" / "su 15.11. klo 17.00" / "sön 15.11. kl. 17.00". */
export function cutoff(orderBy: string, lang: Lang = "en"): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(orderBy) ? `${dayL(orderBy.slice(0, 10), lang)} ${CLOCK_PREFIX[lang]}${orderBy.slice(11, 13)}.${orderBy.slice(14, 16)}` : orderBy;
}

/** A fixed label the server wrote, in the buyer's language when it is one of the known ones; otherwise as it came. */
function known(tx: (typeof SHEET_TEXT)["en"], s: string): string {
  if (Object.hasOwn(tx.known, s)) return tx.known[s];
  const m = /^Bought together with (.+)$/.exec(s);
  return m ? tx.boughtWith(m[1]) : s;
}

export function PlanHeader({ plan, onEdit, busy }: { plan: PlanWire; onEdit: (e: PlanEdit[]) => void; busy: boolean }) {
  const [covers, setCovers] = useState(plan.settings.covers ? String(plan.settings.covers) : "");
  const [date, setDate] = useState(plan.settings.deliverBy ?? "");
  const locked = plan.state !== "planned";
  const n = Number(covers);
  const tx = useText(SHEET_TEXT);
  const f = useFormat();
  return (
    <Sheet>
      <div className="p-5 sm:p-7">
        <blockquote className="display max-w-[40ch] text-[1.45rem] leading-tight sm:text-[1.75rem]">“{plan.text}”</blockquote>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg bg-surface p-4 sm:p-5 lg:grid-cols-4">
          <Field label={tx.covers}>
            {locked ? (
              plan.settings.covers
            ) : (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (Number.isInteger(n) && n > 0) onEdit([{ op: "covers", covers: n }]);
                }}
              >
                <input aria-label={tx.covers} inputMode="numeric" value={covers} onChange={(e) => setCovers(e.target.value.replace(/[^0-9]/g, ""))} className={`field !w-24 tabular ${plan.settings.covers ? "" : "!border-lavender-deep !bg-lavender"}`} placeholder={tx.howMany} />
                {String(plan.settings.covers ?? "") !== covers && (
                  <Btn type="submit" busy={busy} kind="primary" size="sm">
                    {tx.set}
                  </Btn>
                )}
              </form>
            )}
          </Field>
          <Field label={tx.deliveredBy}>
            {locked ? (
              plan.settings.deliverBy ? f.day(plan.settings.deliverBy) : tx.earliest
            ) : (
              <span className="flex flex-wrap items-center gap-2">
                <input aria-label={tx.deliveredBy} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field !w-auto max-w-full" />
                {date && date !== (plan.settings.deliverBy ?? "") && (
                  <Btn onClick={() => onEdit([{ op: "deliverBy", date }])} busy={busy} kind="primary" size="sm">
                    {tx.set}
                  </Btn>
                )}
              </span>
            )}
          </Field>
          <Field label={tx.rulesLabel} className="col-span-2 sm:col-span-1">
            <span className="text-[0.92rem] font-medium leading-snug">
              {[...plan.kitchen.rules.map((r) => r.text), ...plan.draft.requiredClaims.map((c) => tx.claimRequest(c)), ...plan.draft.forbiddenAllergens.map((a) => tx.noAllergen(a))].join("; ")}
            </span>
          </Field>
          <Field label={tx.howMade} className="col-span-2 sm:col-span-1">
            <span className="text-[0.92rem] font-medium leading-snug">{tx.made(!!plan.model.recorded, plan.model.id.replace(/^anthropic:/, ""), plan.timings.totalMs, plan.live.calls, plan.live.products)}</span>
          </Field>
        </dl>
        <ul className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {plan.draft.dishes.map((d) => (
            <li key={d.id} className="flex min-w-0 gap-3.5">
              <IconDisc size={38} tone="muted">
                <UtensilsCrossed size={18} />
              </IconDisc>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Chip tone="muted">{tx.course[d.course] ?? d.course}</Chip>
                  {d.serviceDate ? <span className="text-[0.85rem] text-ink-soft">{f.day(d.serviceDate)}</span> : null}
                </p>
                <p className="mt-1 font-semibold leading-snug">
                  {d.name}
                  {d.nameFi && d.nameFi.toLowerCase() !== d.name.toLowerCase() ? <span className="font-normal text-ink-soft">, {d.nameFi}</span> : null}
                </p>
                <p className="mt-0.5 text-[0.92rem] leading-snug text-ink-soft">
                  {d.portion}. {d.method}
                </p>
              </div>
            </li>
          ))}
        </ul>
        {(plan.draft.assumptions.length > 0 || plan.notes.length > 0) && (
          <details className="group mt-5 text-[0.95rem]">
            <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-full font-semibold text-petrol hover:text-petrol-deep pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
              <ChevronDown aria-hidden size={17} className="transition-transform group-open:rotate-180 motion-reduce:transition-none" />
              {tx.assumptions(plan.draft.assumptions.length + plan.notes.length)}
            </summary>
            <ul className="mt-1 list-disc space-y-1 pl-6 leading-snug text-ink-soft">
              {[...plan.notes, ...plan.draft.assumptions].map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Sheet>
  );
}

/** What needs a person, gathered at the top: each with its ways out, priced and checked. Everything else goes through. */
export function NeedsYou({ plan, onEdit, busy }: { plan: PlanWire; onEdit: (e: PlanEdit[]) => void; busy: boolean }) {
  const open = plan.lines.flatMap((l) => l.doubts.filter((d) => !d.accepted).map((d) => ({ line: l, doubt: d })));
  const tx = useText(SHEET_TEXT);
  const f = useFormat();
  if (!open.length || plan.state !== "planned") return null;
  return (
    <section className="rounded-xl bg-lavender ring-1 ring-inset ring-lavender-mid">
      <div className="p-5 sm:p-7">
        <h2 className="display flex items-start gap-2.5 text-[1.5rem] sm:text-[1.7rem]">
          <Sparkles aria-hidden size={22} className="mt-1 shrink-0 text-lavender-deep" />
          {tx.toDecide(open.length)}
        </h2>
        <p className="mt-0.5 text-[0.95rem] text-ink-soft">{tx.everythingElse}</p>
        {plan.totals.allLate && (
          <div className="mt-4 rounded-lg bg-paper p-4 shadow-xs">
            <p className="font-semibold">{tx.allLate(f.day(plan.totals.allLate.neededBy), plan.totals.allLate.earliest ? f.day(plan.totals.allLate.earliest) : undefined)}</p>
            <p className="text-[0.95rem]">{tx.oneDecision}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {plan.totals.allLate.earliest && (
                <Btn kind="primary" busy={busy} onClick={() => onEdit([{ op: "deliverBy", date: plan.totals.allLate!.earliest! }])}>
                  {tx.planFor(f.day(plan.totals.allLate.earliest))}
                </Btn>
              )}
              <Btn
                kind="secondary"
                busy={busy}
                onClick={() => onEdit(open.filter(({ doubt }) => doubt.kind === "cannot_arrive" && doubt.acceptLabel).map(({ doubt }) => ({ op: "accept" as const, doubtId: doubt.doubtId })))}
              >
                {tx.acceptAllLate}
              </Btn>
            </div>
          </div>
        )}
        <ul className="mt-4 space-y-3">
          {open.map(({ line, doubt }) => (
            <DoubtItem key={doubt.doubtId} line={line} doubt={doubt} pending={plan.pending} refused={plan.live.refused} onEdit={onEdit} busy={busy} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function DoubtItem({ line, doubt, pending, refused, onEdit, busy }: { line: Line; doubt: Doubt; pending: boolean; refused?: string; onEdit: (e: PlanEdit[]) => void; busy: boolean }) {
  const offerFixes = ["cannot_arrive", "no_safe_product", "no_product", "rule_conflict"].includes(doubt.kind);
  const tx = useText(SHEET_TEXT);
  const f = useFormat();
  return (
    <li className="rounded-lg bg-paper p-4 shadow-xs sm:p-5">
      <p className="font-semibold leading-snug">
        {line.name}
        <span className="block text-[0.88rem] font-normal text-ink-soft sm:ml-2 sm:inline">{[...new Set(line.uses.map((u) => u.dish))].join(", ")}</span>
      </p>
      <p className="mt-0.5 leading-snug">{doubt.text}</p>
      {offerFixes && line.fixes.length === 0 && pending && (
        <div className="mt-2">
          <Spinner label={tx.workingOut} />
        </div>
      )}
      {offerFixes && line.fixes.length > 0 && (
        <ul className="mt-3 grid gap-3 md:grid-cols-3">
          {line.fixes.map((fix) => {
            const c = fix.check;
            return (
              <li key={fix.fixId} className={`flex flex-col justify-between rounded-lg border p-3.5 ${c?.ok ? "border-line-strong bg-paper" : "border-dashed border-line bg-mist text-ink-soft"}`}>
                <div>
                  <p className="font-semibold leading-snug">{fix.title}</p>
                  <p className="mt-1">{fix.changesDish ? <Chip tone="agent">{tx.changesDish}</Chip> : <Chip tone="muted">{tx.sameDish}</Chip>}</p>
                  <p className="mt-0.5 text-[0.92rem] leading-snug">{fix.effect}</p>
                  {c?.ok ? (
                    <p className="mt-1 text-[0.92rem] leading-snug">
                      {c.product}: {c.packs}, <strong className="tabular">{money(c.totalCents)}</strong>
                      {c.deltaCents !== null ? <span className="tabular"> ({c.deltaCents >= 0 ? "+" : "−"}{money(Math.abs(c.deltaCents))})</span> : null}
                      {tx.arrivesAfter(c.deliveryDate === "-" ? "-" : f.day(c.deliveryDate))}
                      {c.orderBy ? tx.orderByAfter(cutoff(c.orderBy, f.lang)) : ""}.{c.note ? ` ${c.note}` : ""}
                    </p>
                  ) : (
                    <p className="mt-1 text-[0.9rem] leading-snug">{tx.notOffered(c?.reason ?? tx.notChecked)}</p>
                  )}
                </div>
                {c?.ok && (
                  <Btn kind="primary" size="sm" busy={busy} className="mt-3 self-start" onClick={() => onEdit([{ op: "applyFix", lineId: line.lineId, fixId: fix.fixId }])}>
                    {tx.useThis}
                  </Btn>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {doubt.kind === "not_priced" && refused && <p className="mt-1 text-[0.92rem] text-ink-soft">{refused}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {doubt.kind === "not_priced" && (
          <Btn kind="primary" busy={busy} onClick={() => onEdit([{ op: "price" }])}>
            {tx.checkPrice}
          </Btn>
        )}
        {doubt.acceptLabel && (
          <Btn kind="secondary" busy={busy} onClick={() => onEdit([{ op: "accept", doubtId: doubt.doubtId }])}>
            {known(tx, doubt.acceptLabel)}
          </Btn>
        )}
        <Btn busy={busy} onClick={() => onEdit([{ op: "strike", lineId: line.lineId, struck: true }])}>
          {tx.strikeLong}
        </Btn>
      </div>
    </li>
  );
}

/** The lines, as a chef reads a purchase sheet: what, for which dish, how much and why, which product, when. */
export function Lines({ plan, onEdit, busy }: { plan: PlanWire; onEdit: (e: PlanEdit[]) => void; busy: boolean }) {
  const buying = plan.lines.filter((l) => l.status !== "struck" && l.status !== "merged");
  const aside = plan.lines.filter((l) => l.status === "struck" || l.status === "merged");
  const tx = useText(SHEET_TEXT);
  return (
    <section>
      <div className="mb-4 px-1">
        <h2 className="display text-[1.5rem] sm:text-[1.625rem]">{tx.purchaseLines}</h2>
        <p className="mt-0.5 max-w-[70ch] text-[0.95rem] text-ink-soft">{tx.amountsHelp}</p>
      </div>
      <Card>
        <ol className="divide-y divide-line">
          {buying.map((l, i) => (
            <LineRow key={l.lineId} n={i + 1} line={l} locked={plan.state !== "planned"} onEdit={onEdit} busy={busy} />
          ))}
        </ol>
        {aside.length > 0 && (
          <details className="group border-t border-line bg-mist/60 px-5 py-2" open={plan.settings.covers !== null && aside.some((l) => l.status === "struck" && !l.pantry)}>
            <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 font-semibold text-petrol hover:text-petrol-deep pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
              <ChevronDown aria-hidden size={17} className="transition-transform group-open:rotate-180 motion-reduce:transition-none" />
              {tx.notOrdered(aside.length)}
            </summary>
            <ul className="mt-1 divide-y divide-line">
              {aside.map((l) => (
                <li key={l.lineId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span>
                    <span className="font-semibold">{l.name}</span> <span className="text-ink-soft">{l.working || ""}</span>
                    <span className="block text-[0.9rem] text-ink-soft">{l.status === "merged" ? known(tx, l.statusText) : `${known(tx, l.statusText)}: ${l.struckReason ? known(tx, l.struckReason) : ""}`}</span>
                  </span>
                  {l.status === "struck" && plan.state === "planned" && (
                    <Btn busy={busy} size="sm" onClick={() => onEdit([{ op: "strike", lineId: l.lineId, struck: false }])}>
                      {tx.orderIt}
                    </Btn>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
    </section>
  );
}

function LineRow({ n, line, locked, onEdit, busy }: { n: number; line: Line; locked: boolean; onEdit: (e: PlanEdit[]) => void; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const [alts, setAlts] = useState(false);
  const c = line.chosen;
  const open = line.doubts.filter((d) => !d.accepted);
  const tx = useText(SHEET_TEXT);
  const f = useFormat();
  return (
    <li className="grid gap-x-6 gap-y-2 px-5 py-4 md:grid-cols-[minmax(11rem,1.1fr)_minmax(12rem,1.2fr)_minmax(14rem,1.6fr)]">
      <div className="flex min-w-0 gap-3">
        <span aria-hidden className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface text-[0.75rem] font-semibold text-ink-soft tabular">
          {n}
        </span>
        <div className="min-w-0">
        <p className="font-semibold leading-snug">
          {line.name}
          {line.replaces ? <span className="block text-[0.85rem] font-normal text-ink-soft">{tx.insteadOf(line.replaces.name, line.replaces.fixTitle)}</span> : null}
        </p>
        <p className="mt-0.5 text-[0.9rem] leading-snug text-ink-soft">{line.roles.join("; ")}</p>
        </div>
      </div>
      <div className="min-w-0 text-[0.95rem]">
        {line.gross ? (
          <button type="button" disabled={locked} onClick={() => setEditing((x) => !x)} aria-expanded={locked ? undefined : editing} className="rounded-xs text-left font-medium leading-snug underline decoration-petrol/30 decoration-1 underline-offset-4 hover:decoration-petrol disabled:font-normal disabled:no-underline">
            {line.working}
          </button>
        ) : (
          <span className="text-ink-soft">{line.status === "needs_covers" || line.status === "struck" || line.status === "merged" ? known(tx, line.statusText) : line.statusText}</span>
        )}
        {line.uses.length > 0 && <p className="text-[0.85rem] leading-snug text-ink-soft">{line.uses.map((u) => u.basis).filter(Boolean).join("; ")}</p>}
        {editing && !locked && <AmountEditor line={line} onEdit={onEdit} busy={busy} onDone={() => setEditing(false)} />}
      </div>
      <div className="min-w-0">
        {c ? (
          <>
            <p className="leading-snug">
              <span className="font-semibold">{c.products.map((p) => p.name).join(" + ")}</span>
            </p>
            <p className="text-[0.95rem] leading-snug">
              {c.products.map((p) => p.packText).join(" + ")} = <strong className="tabular">{money(c.totalCents)}</strong>
            </p>
            <p className="mt-2 flex flex-wrap gap-1.5">
              <Chip tone={line.timing?.ok ? "ok" : "warn"} title={line.timing?.text}>
                {line.timing?.ok ? tx.arrives(f.day(c.deliveryDate)) : tx.late}
              </Chip>
              {c.orderBy && <Chip tone="muted">{tx.orderBy(cutoff(c.orderBy, f.lang))}</Chip>}
              <Chip tone={c.match === "full" ? "plain" : "warn"}>{tx.rank[c.rank] ?? c.rank}</Chip>
              {c.safety.map((s, i) => (
                <Chip key={i} tone={s.verdict === "ok" ? "ok" : "warn"} title={`${s.rule}: ${s.reason}`}>
                  {s.verdict === "ok" ? <Check aria-hidden size={12} strokeWidth={2.8} /> : "?"} {s.rule.replace(/ \(.*\)$/, "")}
                </Chip>
              ))}
              {c.products.some((p) => p.stockKnown === false) && <Chip tone="muted">{tx.stockNotReported}</Chip>}
              {c.leftover.amount > 0 && <Chip tone="muted">{tx.over(Math.round(c.leftover.amount * 1000) / 1000, c.leftover.unit)}</Chip>}
            </p>
            {line.alternatives.length > 0 && (
              <div className="mt-1">
                <Btn kind="quiet" className="!min-h-9 text-[0.9rem] pointer-coarse:!min-h-11" onClick={() => setAlts((x) => !x)}>
                  {tx.otherOptions(alts, line.alternatives.length)}
                </Btn>
                {alts && (
                  <ul className="mt-1 space-y-1.5">
                    {line.alternatives.map((a) => (
                      <li key={a.optionId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-mist/50 px-3 py-2 text-[0.92rem]">
                        <span className="min-w-0">
                          <Chip>{tx.rank[a.rank] ?? a.rank}</Chip> {a.products.map((p) => `${p.name}, ${p.packText}`).join(" + ")} = <strong className="tabular">{money(a.totalCents)}</strong>
                          {a.cons[0] ? <span className="block text-ink-soft">{a.cons[0]}</span> : null}
                        </span>
                        {!locked && (
                          <Btn busy={busy} size="sm" onClick={() => onEdit([{ op: "choose", lineId: line.lineId, optionId: a.optionId }])}>
                            {tx.takeThis}
                          </Btn>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="text-[0.95rem]">{open.length ? <Chip tone="agent">{tx.needsYou}</Chip> : null} <span className="text-ink-soft">{open[0]?.text.slice(0, 160) ?? (line.status === "needs_covers" ? known(tx, line.statusText) : line.statusText)}</span></p>
        )}
        {line.doubts
          .filter((d) => d.accepted)
          .map((d) => (
            <p key={d.doubtId} className="mt-1 flex items-center gap-1.5 text-[0.85rem] text-ink-soft">
              <Check aria-hidden size={13} strokeWidth={2.6} className="text-good" /> {d.accepted!.by}: {d.acceptLabel ? known(tx, d.acceptLabel).toLowerCase() : undefined}
            </p>
          ))}
        {!locked && (
          <Btn kind="quiet" className="!min-h-9 text-[0.86rem] pointer-coarse:!min-h-11" onClick={() => onEdit([{ op: "strike", lineId: line.lineId, struck: true }])}>
            {tx.strikeShort}
          </Btn>
        )}
      </div>
    </li>
  );
}

function AmountEditor({ line, onEdit, busy, onDone }: { line: Line; onEdit: (e: PlanEdit[]) => void; busy: boolean; onDone: () => void }) {
  const [per, setPer] = useState<Record<string, string>>(Object.fromEntries(line.uses.map((u) => [u.dishId, String(u.perCover.amount)])));
  const [yieldPct, setYield] = useState(String(line.uses[0]?.yieldPct ?? 100));
  const tx = useText(SHEET_TEXT);
  return (
    <form
      className="mt-2.5 space-y-2 rounded-lg bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const edits: PlanEdit[] = [];
        for (const u of line.uses) {
          const v = Number(per[u.dishId]?.replace(",", "."));
          if (Number.isFinite(v) && v > 0 && v !== u.perCover.amount) edits.push({ op: "perCover", lineId: line.lineId, dishId: u.dishId, amount: v });
        }
        const y = Number(yieldPct);
        if (Number.isFinite(y) && y !== line.uses[0]?.yieldPct) edits.push({ op: "yield", lineId: line.lineId, yieldPct: y });
        if (edits.length) onEdit(edits);
        onDone();
      }}
    >
      {line.uses.map((u) => (
        <label key={u.dishId} className="flex items-center gap-2 text-[0.9rem]">
          <span className="w-28 truncate text-ink-soft">{u.dish}</span>
          <input inputMode="decimal" value={per[u.dishId]} onChange={(e) => setPer({ ...per, [u.dishId]: e.target.value })} className="field !min-h-10 !w-20 !px-2.5 tabular" />
          <span>{tx.perCover(u.perCover.unit)}</span>
        </label>
      ))}
      <label className="flex items-center gap-2 text-[0.9rem]">
        <span className="w-28 text-ink-soft">{tx.usableShare}</span>
        <input inputMode="numeric" value={yieldPct} onChange={(e) => setYield(e.target.value)} className="field !min-h-10 !w-20 !px-2.5 tabular" />
        <span>%</span>
      </label>
      <Btn type="submit" kind="primary" size="sm" busy={busy}>
        {tx.recalculate}
      </Btn>
    </form>
  );
}
