"use client";

import { useState } from "react";
import type { PlanEdit } from "@/server/agent/menu/service";
import type { PlanWire } from "@/server/agent/menu/wire";
import { money } from "../_ui/plain";
import { dayL } from "../_i18n/format";
import type { Lang } from "../_i18n/lang";
import { useFormat, useText } from "../_i18n/provider";
import { SHEET_TEXT } from "./sheet.text";
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
      <div className="p-4 sm:p-5">
        <blockquote className="display text-[1.5rem] sm:text-[1.8rem]">“{plan.text}”</blockquote>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-3 sm:grid-cols-4">
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
                <input aria-label={tx.covers} inputMode="numeric" value={covers} onChange={(e) => setCovers(e.target.value.replace(/[^0-9]/g, ""))} className={`w-24 border-2 px-2 py-1 tabular ${plan.settings.covers ? "border-line" : "border-petrol bg-lavender"}`} placeholder={tx.howMany} />
                {String(plan.settings.covers ?? "") !== covers && (
                  <Btn type="submit" busy={busy} kind="primary" className="min-h-9 px-2 text-[0.9rem]">
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
              <span className="flex items-center gap-2">
                <input aria-label={tx.deliveredBy} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border-2 border-line px-2 py-1" />
                {date && date !== (plan.settings.deliverBy ?? "") && (
                  <Btn onClick={() => onEdit([{ op: "deliverBy", date }])} busy={busy} kind="primary" className="min-h-9 px-2 text-[0.9rem]">
                    {tx.set}
                  </Btn>
                )}
              </span>
            )}
          </Field>
          <Field label={tx.rulesLabel}>
            <span className="text-[0.95rem] font-medium">
              {[...plan.kitchen.rules.map((r) => r.text), ...plan.draft.requiredClaims.map((c) => tx.claimRequest(c)), ...plan.draft.forbiddenAllergens.map((a) => tx.noAllergen(a))].join("; ")}
            </span>
          </Field>
          <Field label={tx.howMade}>
            <span className="text-[0.95rem] font-medium">{tx.made(!!plan.model.recorded, plan.model.id.replace(/^anthropic:/, ""), plan.timings.totalMs, plan.live.calls, plan.live.products)}</span>
          </Field>
        </dl>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {plan.draft.dishes.map((d) => (
            <li key={d.id} className="border-l-4 border-petrol pl-3">
              <p className="font-semibold">
                <span className="mr-2 text-[0.8rem] text-ink-soft">{tx.course[d.course] ?? d.course}</span>
                {d.name}
                {d.nameFi && d.nameFi.toLowerCase() !== d.name.toLowerCase() ? <span className="text-ink-soft"> · {d.nameFi}</span> : null}
                {d.serviceDate ? <span className="text-ink-soft"> · {f.day(d.serviceDate)}</span> : null}
              </p>
              <p className="text-[0.95rem] text-ink-soft">
                {d.portion}. {d.method}
              </p>
            </li>
          ))}
        </ul>
        {(plan.draft.assumptions.length > 0 || plan.notes.length > 0) && (
          <details className="mt-3 text-[0.95rem]">
            <summary className="min-h-10 cursor-pointer py-2 font-semibold text-petrol underline decoration-2 underline-offset-4">{tx.assumptions(plan.draft.assumptions.length + plan.notes.length)}</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-soft">
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
    <Sheet agent>
      <div className="p-4 sm:p-5">
        <h2 className="display text-[1.8rem]">{tx.toDecide(open.length)}</h2>
        <p className="text-[0.95rem] text-ink-soft">{tx.everythingElse}</p>
        {plan.totals.allLate && (
          <div className="mt-3 border-l-[6px] border-lavender-deep bg-paper px-3 py-2.5">
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
        <ul className="mt-3 space-y-4">
          {open.map(({ line, doubt }) => (
            <DoubtItem key={doubt.doubtId} line={line} doubt={doubt} pending={plan.pending} refused={plan.live.refused} onEdit={onEdit} busy={busy} />
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

function DoubtItem({ line, doubt, pending, refused, onEdit, busy }: { line: Line; doubt: Doubt; pending: boolean; refused?: string; onEdit: (e: PlanEdit[]) => void; busy: boolean }) {
  const offerFixes = ["cannot_arrive", "no_safe_product", "no_product", "rule_conflict"].includes(doubt.kind);
  const tx = useText(SHEET_TEXT);
  const f = useFormat();
  return (
    <li className="border-l-[6px] border-lavender-deep bg-paper px-3 py-2.5">
      <p className="font-semibold">
        {line.name}
        <span className="ml-2 font-normal text-ink-soft">{[...new Set(line.uses.map((u) => u.dish))].join(", ")}</span>
      </p>
      <p className="mt-0.5 leading-snug">{doubt.text}</p>
      {offerFixes && line.fixes.length === 0 && pending && (
        <div className="mt-2">
          <Spinner label={tx.workingOut} />
        </div>
      )}
      {offerFixes && line.fixes.length > 0 && (
        <ul className="mt-2 grid gap-2 md:grid-cols-3">
          {line.fixes.map((fix) => {
            const c = fix.check;
            return (
              <li key={fix.fixId} className={`flex flex-col justify-between border-2 bg-paper p-2.5 ${c?.ok ? "border-petrol" : "border-line text-ink-soft"}`}>
                <div>
                  <p className="font-semibold">
                    {fix.title} {fix.changesDish ? <Chip tone="agent">{tx.changesDish}</Chip> : <Chip tone="muted">{tx.sameDish}</Chip>}
                  </p>
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
                  <Btn kind="primary" busy={busy} className="mt-2 min-h-10" onClick={() => onEdit([{ op: "applyFix", lineId: line.lineId, fixId: fix.fixId }])}>
                    {tx.useThis}
                  </Btn>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {doubt.kind === "not_priced" && refused && <p className="mt-1 text-[0.92rem] text-ink-soft">{refused}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
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
    <Sheet>
      <div className="p-4 sm:p-5">
        <h2 className="display text-[1.6rem]">{tx.purchaseLines}</h2>
        <p className="text-[0.95rem] text-ink-soft">{tx.amountsHelp}</p>
        <ol className="mt-3 divide-y divide-line">
          {buying.map((l, i) => (
            <LineRow key={l.lineId} n={i + 1} line={l} locked={plan.state !== "planned"} onEdit={onEdit} busy={busy} />
          ))}
        </ol>
        {aside.length > 0 && (
          <details className="mt-3" open={plan.settings.covers !== null && aside.some((l) => l.status === "struck" && !l.pantry)}>
            <summary className="min-h-10 cursor-pointer py-2 font-semibold text-petrol underline decoration-2 underline-offset-4">{tx.notOrdered(aside.length)}</summary>
            <ul className="mt-1 divide-y divide-line">
              {aside.map((l) => (
                <li key={l.lineId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-semibold">{l.name}</span> <span className="text-ink-soft">{l.working || ""}</span>
                    <span className="block text-[0.9rem] text-ink-soft">{l.status === "merged" ? known(tx, l.statusText) : `${known(tx, l.statusText)}: ${l.struckReason ? known(tx, l.struckReason) : ""}`}</span>
                  </span>
                  {l.status === "struck" && plan.state === "planned" && (
                    <Btn busy={busy} className="min-h-9 text-[0.9rem]" onClick={() => onEdit([{ op: "strike", lineId: l.lineId, struck: false }])}>
                      {tx.orderIt}
                    </Btn>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Sheet>
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
    <li className="grid gap-x-4 gap-y-1.5 py-3 md:grid-cols-[minmax(11rem,1.1fr)_minmax(12rem,1.2fr)_minmax(14rem,1.6fr)]">
      <div className="min-w-0">
        <p className="font-semibold">
          <span className="mr-1.5 text-ink-soft tabular">{n}</span>
          {line.name}
          {line.replaces ? <span className="block text-[0.85rem] font-normal text-ink-soft">{tx.insteadOf(line.replaces.name, line.replaces.fixTitle)}</span> : null}
        </p>
        <p className="text-[0.9rem] leading-snug text-ink-soft">{line.roles.join("; ")}</p>
      </div>
      <div className="min-w-0 text-[0.95rem]">
        {line.gross ? (
          <button type="button" disabled={locked} onClick={() => setEditing((x) => !x)} className="text-left leading-snug underline decoration-ink/30 decoration-1 underline-offset-4 hover:decoration-ink disabled:no-underline">
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
            <p className="mt-1 flex flex-wrap gap-1.5">
              <Chip tone={line.timing?.ok ? "ok" : "warn"} title={line.timing?.text}>
                {line.timing?.ok ? tx.arrives(f.day(c.deliveryDate)) : tx.late}
              </Chip>
              {c.orderBy && <Chip tone="muted">{tx.orderBy(cutoff(c.orderBy, f.lang))}</Chip>}
              <Chip tone={c.match === "full" ? "plain" : "warn"}>{tx.rank[c.rank] ?? c.rank}</Chip>
              {c.safety.map((s, i) => (
                <Chip key={i} tone={s.verdict === "ok" ? "ok" : "warn"} title={`${s.rule}: ${s.reason}`}>
                  {s.verdict === "ok" ? "✓" : "?"} {s.rule.replace(/ \(.*\)$/, "")}
                </Chip>
              ))}
              {c.products.some((p) => p.stockKnown === false) && <Chip tone="muted">{tx.stockNotReported}</Chip>}
              {c.leftover.amount > 0 && <Chip tone="muted">{tx.over(Math.round(c.leftover.amount * 1000) / 1000, c.leftover.unit)}</Chip>}
            </p>
            {line.alternatives.length > 0 && (
              <div className="mt-1">
                <Btn kind="quiet" className="min-h-8 text-[0.9rem]" onClick={() => setAlts((x) => !x)}>
                  {tx.otherOptions(alts, line.alternatives.length)}
                </Btn>
                {alts && (
                  <ul className="mt-1 space-y-1.5">
                    {line.alternatives.map((a) => (
                      <li key={a.optionId} className="flex flex-wrap items-center justify-between gap-2 border border-line px-2 py-1.5 text-[0.92rem]">
                        <span className="min-w-0">
                          <Chip>{tx.rank[a.rank] ?? a.rank}</Chip> {a.products.map((p) => `${p.name}, ${p.packText}`).join(" + ")} = <strong className="tabular">{money(a.totalCents)}</strong>
                          {a.cons[0] ? <span className="block text-ink-soft">{a.cons[0]}</span> : null}
                        </span>
                        {!locked && (
                          <Btn busy={busy} className="min-h-9 text-[0.9rem]" onClick={() => onEdit([{ op: "choose", lineId: line.lineId, optionId: a.optionId }])}>
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
            <p key={d.doubtId} className="mt-1 text-[0.85rem] text-ink-soft">
              ✓ {d.accepted!.by}: {d.acceptLabel ? known(tx, d.acceptLabel).toLowerCase() : undefined}
            </p>
          ))}
        {!locked && (
          <Btn kind="quiet" className="min-h-8 text-[0.85rem]" onClick={() => onEdit([{ op: "strike", lineId: line.lineId, struck: true }])}>
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
      className="mt-2 space-y-2 border-2 border-ink/30 p-2"
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
          <input inputMode="decimal" value={per[u.dishId]} onChange={(e) => setPer({ ...per, [u.dishId]: e.target.value })} className="w-20 border-2 border-line px-1.5 py-0.5 tabular" />
          <span>{tx.perCover(u.perCover.unit)}</span>
        </label>
      ))}
      <label className="flex items-center gap-2 text-[0.9rem]">
        <span className="w-28 text-ink-soft">{tx.usableShare}</span>
        <input inputMode="numeric" value={yieldPct} onChange={(e) => setYield(e.target.value)} className="w-20 border-2 border-line px-1.5 py-0.5 tabular" />
        <span>%</span>
      </label>
      <Btn type="submit" kind="primary" busy={busy} className="min-h-9 text-[0.9rem]">
        {tx.recalculate}
      </Btn>
    </form>
  );
}
