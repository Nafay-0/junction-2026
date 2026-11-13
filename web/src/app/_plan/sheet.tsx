"use client";

import { useState } from "react";
import type { PlanEdit } from "@/server/agent/menu/service";
import type { PlanWire } from "@/server/agent/menu/wire";
import { day, money } from "../_ui/plain";
import { Btn, Chip, Field, Sheet, Spinner } from "./ui";

type Line = PlanWire["lines"][number];
type Doubt = Line["doubts"][number];

const COURSE: Record<string, string> = { starter: "Starter", soup: "Soup", salad: "Salad", main: "Main", side: "Side", dessert: "Dessert", bread: "Bread", drink: "Drink", snack: "Snack", other: "Dish" };
const RANK: Record<string, string> = { best: "Best", better: "Better", good: "Good" };

/** "2026-11-15T17:00:00+0200" as "Sun 15.11. 17.00". */
export function cutoff(orderBy: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(orderBy) ? `${day(orderBy.slice(0, 10))} ${orderBy.slice(11, 13)}.${orderBy.slice(14, 16)}` : orderBy;
}

export function PlanHeader({ plan, onEdit, busy }: { plan: PlanWire; onEdit: (e: PlanEdit[]) => void; busy: boolean }) {
  const [covers, setCovers] = useState(plan.settings.covers ? String(plan.settings.covers) : "");
  const [date, setDate] = useState(plan.settings.deliverBy ?? "");
  const locked = plan.state !== "planned";
  const n = Number(covers);
  return (
    <Sheet>
      <div className="p-4 sm:p-5">
        <blockquote className="font-display text-[1.5rem] font-semibold leading-tight sm:text-[1.8rem]">“{plan.text}”</blockquote>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-3 sm:grid-cols-4">
          <Field label="Covers">
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
                <input aria-label="Covers" inputMode="numeric" value={covers} onChange={(e) => setCovers(e.target.value.replace(/[^0-9]/g, ""))} className={`w-24 border-2 px-2 py-1 tabular ${plan.settings.covers ? "border-ink/40" : "border-ink bg-safety/40"}`} placeholder="how many?" />
                {String(plan.settings.covers ?? "") !== covers && (
                  <Btn type="submit" busy={busy} kind="primary" className="min-h-9 px-2 text-[0.9rem]">
                    Set
                  </Btn>
                )}
              </form>
            )}
          </Field>
          <Field label="Delivered by">
            {locked ? (
              plan.settings.deliverBy ? day(plan.settings.deliverBy) : "earliest"
            ) : (
              <span className="flex items-center gap-2">
                <input aria-label="Delivered by" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border-2 border-ink/40 px-2 py-1" />
                {date && date !== (plan.settings.deliverBy ?? "") && (
                  <Btn onClick={() => onEdit([{ op: "deliverBy", date }])} busy={busy} kind="primary" className="min-h-9 px-2 text-[0.9rem]">
                    Set
                  </Btn>
                )}
              </span>
            )}
          </Field>
          <Field label="Rules on every line">
            <span className="text-[0.95rem] font-medium">
              {[...plan.kitchen.rules.map((r) => r.text), ...plan.draft.requiredClaims.map((c) => `${c.replace(/_/g, "-")} (request)`), ...plan.draft.forbiddenAllergens.map((a) => `no ${a} (request)`)].join("; ")}
            </span>
          </Field>
          <Field label="How it was made">
            <span className="text-[0.95rem] font-medium">
              {plan.model.recorded ? "Recorded output of " : ""}
              {plan.model.id.replace(/^anthropic:/, "")}, {(plan.timings.totalMs / 1000).toFixed(1)} s; {plan.live.calls} live call{plan.live.calls === 1 ? "" : "s"} for {plan.live.products} products
            </span>
          </Field>
        </dl>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {plan.draft.dishes.map((d) => (
            <li key={d.id} className="border-l-4 border-ink pl-3">
              <p className="font-semibold">
                <span className="mr-2 text-[0.8rem] uppercase tracking-wide text-ink-soft">{COURSE[d.course] ?? d.course}</span>
                {d.name}
                {d.nameFi && d.nameFi.toLowerCase() !== d.name.toLowerCase() ? <span className="text-ink-soft"> · {d.nameFi}</span> : null}
                {d.serviceDate ? <span className="text-ink-soft"> · {day(d.serviceDate)}</span> : null}
              </p>
              <p className="text-[0.95rem] text-ink-soft">
                {d.portion}. {d.method}
              </p>
            </li>
          ))}
        </ul>
        {(plan.draft.assumptions.length > 0 || plan.notes.length > 0) && (
          <details className="mt-3 text-[0.95rem]">
            <summary className="cursor-pointer py-1 font-semibold underline decoration-2 underline-offset-4">Assumptions ({plan.draft.assumptions.length + plan.notes.length})</summary>
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
  if (!open.length || plan.state !== "planned") return null;
  return (
    <Sheet safety>
      <div className="p-4 sm:p-5">
        <h2 className="font-display text-[1.6rem] font-bold leading-tight">
          {open.length} thing{open.length > 1 ? "s" : ""} for you to decide
        </h2>
        <p className="text-[0.95rem] text-ink-soft">Everything else on the plan goes through as it is. Each choice is recorded in the ledger with your name.</p>
        {plan.totals.allLate && (
          <div className="mt-3 border-l-[6px] border-ink bg-safety/30 px-3 py-2.5">
            <p className="font-semibold">Nothing on this plan can arrive by {day(plan.totals.allLate.neededBy)}{plan.totals.allLate.earliest ? `: the earliest delivery is ${day(plan.totals.allLate.earliest)}` : ""}.</p>
            <p className="text-[0.95rem]">One decision for the whole plan: move the day, or take the later delivery for every line that has one. Lines with no product at all stay below.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {plan.totals.allLate.earliest && (
                <Btn kind="primary" busy={busy} onClick={() => onEdit([{ op: "deliverBy", date: plan.totals.allLate!.earliest! }])}>
                  Plan for {day(plan.totals.allLate.earliest)} instead
                </Btn>
              )}
              <Btn
                kind="safety"
                busy={busy}
                onClick={() => onEdit(open.filter(({ doubt }) => doubt.kind === "cannot_arrive" && doubt.acceptLabel).map(({ doubt }) => ({ op: "accept" as const, doubtId: doubt.doubtId })))}
              >
                Accept the later delivery for all
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
  return (
    <li className="border-l-[6px] border-ink bg-concrete/50 px-3 py-2.5">
      <p className="font-semibold">
        {line.name}
        <span className="ml-2 font-normal text-ink-soft">{[...new Set(line.uses.map((u) => u.dish))].join(", ")}</span>
      </p>
      <p className="mt-0.5 leading-snug">{doubt.text}</p>
      {offerFixes && line.fixes.length === 0 && pending && (
        <div className="mt-2">
          <Spinner label="Working out what a cook would do instead…" />
        </div>
      )}
      {offerFixes && line.fixes.length > 0 && (
        <ul className="mt-2 grid gap-2 md:grid-cols-3">
          {line.fixes.map((f) => {
            const c = f.check;
            return (
              <li key={f.fixId} className={`flex flex-col justify-between border-2 bg-paper p-2.5 ${c?.ok ? "border-ink" : "border-ink/20 text-ink-soft"}`}>
                <div>
                  <p className="font-semibold">
                    {f.title} {f.changesDish ? <Chip tone="warn">changes the dish</Chip> : <Chip tone="muted">same dish</Chip>}
                  </p>
                  <p className="mt-0.5 text-[0.92rem] leading-snug">{f.effect}</p>
                  {c?.ok ? (
                    <p className="mt-1 text-[0.92rem] leading-snug">
                      {c.product}: {c.packs}, <strong className="tabular">{money(c.totalCents)}</strong>
                      {c.deltaCents !== null ? <span className="tabular"> ({c.deltaCents >= 0 ? "+" : "−"}{money(Math.abs(c.deltaCents))})</span> : null}, arrives {c.deliveryDate === "-" ? "-" : day(c.deliveryDate)}
                      {c.orderBy ? `, order by ${cutoff(c.orderBy)}` : ""}.{c.note ? ` ${c.note}` : ""}
                    </p>
                  ) : (
                    <p className="mt-1 text-[0.9rem] leading-snug">Not offered: {c?.reason ?? "not checked yet"}.</p>
                  )}
                </div>
                {c?.ok && (
                  <Btn kind="primary" busy={busy} className="mt-2 min-h-10" onClick={() => onEdit([{ op: "applyFix", lineId: line.lineId, fixId: f.fixId }])}>
                    Use this
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
            Check price and delivery
          </Btn>
        )}
        {doubt.acceptLabel && (
          <Btn kind="safety" busy={busy} onClick={() => onEdit([{ op: "accept", doubtId: doubt.doubtId }])}>
            {doubt.acceptLabel}
          </Btn>
        )}
        <Btn busy={busy} onClick={() => onEdit([{ op: "strike", lineId: line.lineId, struck: true }])}>
          Strike it: we have it or buy it elsewhere
        </Btn>
      </div>
    </li>
  );
}

/** The lines, as a chef reads a purchase sheet: what, for which dish, how much and why, which product, when. */
export function Lines({ plan, onEdit, busy }: { plan: PlanWire; onEdit: (e: PlanEdit[]) => void; busy: boolean }) {
  const buying = plan.lines.filter((l) => l.status !== "struck" && l.status !== "merged");
  const aside = plan.lines.filter((l) => l.status === "struck" || l.status === "merged");
  return (
    <Sheet>
      <div className="p-4 sm:p-5">
        <h2 className="font-display text-[1.6rem] font-bold leading-tight">Purchase lines</h2>
        <p className="text-[0.95rem] text-ink-soft">Amounts are per cover × covers ÷ usable share, then whole packs. Tap an amount to change it.</p>
        <ol className="mt-3 divide-y divide-line">
          {buying.map((l, i) => (
            <LineRow key={l.lineId} n={i + 1} line={l} locked={plan.state !== "planned"} onEdit={onEdit} busy={busy} />
          ))}
        </ol>
        {aside.length > 0 && (
          <details className="mt-3" open={plan.settings.covers !== null && aside.some((l) => l.status === "struck" && !l.pantry)}>
            <summary className="cursor-pointer py-1 font-semibold underline decoration-2 underline-offset-4">Not ordered ({aside.length})</summary>
            <ul className="mt-1 divide-y divide-line">
              {aside.map((l) => (
                <li key={l.lineId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-semibold">{l.name}</span> <span className="text-ink-soft">{l.working || ""}</span>
                    <span className="block text-[0.9rem] text-ink-soft">{l.status === "merged" ? l.statusText : `${l.statusText}: ${l.struckReason ?? ""}`}</span>
                  </span>
                  {l.status === "struck" && plan.state === "planned" && (
                    <Btn busy={busy} className="min-h-9 text-[0.9rem]" onClick={() => onEdit([{ op: "strike", lineId: l.lineId, struck: false }])}>
                      Order it
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
  return (
    <li className="grid gap-x-4 gap-y-1.5 py-3 md:grid-cols-[minmax(11rem,1.1fr)_minmax(12rem,1.2fr)_minmax(14rem,1.6fr)]">
      <div className="min-w-0">
        <p className="font-semibold">
          <span className="mr-1.5 text-ink-soft tabular">{n}</span>
          {line.name}
          {line.replaces ? <span className="block text-[0.85rem] font-normal text-ink-soft">instead of {line.replaces.name}: {line.replaces.fixTitle}</span> : null}
        </p>
        <p className="text-[0.9rem] leading-snug text-ink-soft">{line.roles.join("; ")}</p>
      </div>
      <div className="min-w-0 text-[0.95rem]">
        {line.gross ? (
          <button type="button" disabled={locked} onClick={() => setEditing((x) => !x)} className="text-left leading-snug underline decoration-ink/30 decoration-1 underline-offset-4 hover:decoration-ink disabled:no-underline">
            {line.working}
          </button>
        ) : (
          <span className="text-ink-soft">{line.statusText}</span>
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
                {line.timing?.ok ? `arrives ${day(c.deliveryDate)}` : "late"}
              </Chip>
              {c.orderBy && <Chip tone="muted">order by {cutoff(c.orderBy)}</Chip>}
              <Chip tone={c.match === "full" ? "plain" : "warn"}>{RANK[c.rank] ?? c.rank}</Chip>
              {c.safety.map((s, i) => (
                <Chip key={i} tone={s.verdict === "ok" ? "ok" : "warn"} title={`${s.rule}: ${s.reason}`}>
                  {s.verdict === "ok" ? "✓" : "?"} {s.rule.replace(/ \(.*\)$/, "")}
                </Chip>
              ))}
              {c.products.some((p) => p.stockKnown === false) && <Chip tone="muted">stock not reported</Chip>}
              {c.leftover.amount > 0 && <Chip tone="muted">+{Math.round(c.leftover.amount * 1000) / 1000} {c.leftover.unit} over</Chip>}
            </p>
            {line.alternatives.length > 0 && (
              <div className="mt-1">
                <Btn kind="quiet" className="min-h-8 text-[0.9rem]" onClick={() => setAlts((x) => !x)}>
                  {alts ? "Hide" : "Show"} {line.alternatives.length} other option{line.alternatives.length > 1 ? "s" : ""}
                </Btn>
                {alts && (
                  <ul className="mt-1 space-y-1.5">
                    {line.alternatives.map((a) => (
                      <li key={a.optionId} className="flex flex-wrap items-center justify-between gap-2 border border-ink/20 px-2 py-1.5 text-[0.92rem]">
                        <span className="min-w-0">
                          <Chip>{RANK[a.rank] ?? a.rank}</Chip> {a.products.map((p) => `${p.name}, ${p.packText}`).join(" + ")} = <strong className="tabular">{money(a.totalCents)}</strong>
                          {a.cons[0] ? <span className="block text-ink-soft">{a.cons[0]}</span> : null}
                        </span>
                        {!locked && (
                          <Btn busy={busy} className="min-h-9 text-[0.9rem]" onClick={() => onEdit([{ op: "choose", lineId: line.lineId, optionId: a.optionId }])}>
                            Take this
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
          <p className="text-[0.95rem]">{open.length ? <Chip tone="warn">needs you</Chip> : null} <span className="text-ink-soft">{open[0]?.text.slice(0, 160) ?? line.statusText}</span></p>
        )}
        {line.doubts
          .filter((d) => d.accepted)
          .map((d) => (
            <p key={d.doubtId} className="mt-1 text-[0.85rem] text-ink-soft">
              ✓ {d.accepted!.by}: {d.acceptLabel?.toLowerCase()}
            </p>
          ))}
        {!locked && (
          <Btn kind="quiet" className="min-h-8 text-[0.85rem]" onClick={() => onEdit([{ op: "strike", lineId: line.lineId, struck: true }])}>
            Strike: we have it
          </Btn>
        )}
      </div>
    </li>
  );
}

function AmountEditor({ line, onEdit, busy, onDone }: { line: Line; onEdit: (e: PlanEdit[]) => void; busy: boolean; onDone: () => void }) {
  const [per, setPer] = useState<Record<string, string>>(Object.fromEntries(line.uses.map((u) => [u.dishId, String(u.perCover.amount)])));
  const [yieldPct, setYield] = useState(String(line.uses[0]?.yieldPct ?? 100));
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
          <input inputMode="decimal" value={per[u.dishId]} onChange={(e) => setPer({ ...per, [u.dishId]: e.target.value })} className="w-20 border-2 border-ink/40 px-1.5 py-0.5 tabular" />
          <span>{u.perCover.unit} per cover</span>
        </label>
      ))}
      <label className="flex items-center gap-2 text-[0.9rem]">
        <span className="w-28 text-ink-soft">Usable share</span>
        <input inputMode="numeric" value={yieldPct} onChange={(e) => setYield(e.target.value)} className="w-20 border-2 border-ink/40 px-1.5 py-0.5 tabular" />
        <span>%</span>
      </label>
      <Btn type="submit" kind="primary" busy={busy} className="min-h-9 text-[0.9rem]">
        Recalculate
      </Btn>
    </form>
  );
}
