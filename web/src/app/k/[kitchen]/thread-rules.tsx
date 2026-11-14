"use client";

import { useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { useFormat, useLang, useText } from "../../_i18n/provider";
import { Chip, buttonClass } from "../../_ui/kit";
import { ThreadCard } from "../../_ui/thread";
import { Stepper as KitStepper } from "../../_ui/widgets";
import { RuleChange, RulesSheet, type RuleRow } from "../../_ui/widgets-more";
import type {
  RulesCard as RulesCardT,
  RulesChange,
  RulesSnapshot,
  ThreadAction,
} from "@/server/thread/types";
import { DEPARTMENT_NAME } from "./catalogue.text";
import { familyL } from "./family.text";
import { DOOR_TEXT } from "../door.text";
import { THREAD_RULES_TEXT } from "./thread-rules.text";

/**
 * "Your rules" in the thread (docs/agent-thread.md "Widgets": rules), drawn with the design kit: the rules as a sheet a
 * person reads in ten seconds (`RulesSheet`), and one rule changed at a time (`RuleChange`) whose button says what the
 * rule becomes. That button is the kitchen's signed-in person confirming: the change is signed through the mandate
 * reissue (narrower) or the account's own terms (wider) on the server, which decides what this browser may sign.
 * A change typed to the agent ("raise my limit to 800") arrives as an open proposal and is confirmed the same way.
 */

type Tap = (action: ThreadAction, label: string) => void;
type Tx = (typeof THREAD_RULES_TEXT)["en"];
type RowId =
  "limit" | "budget" | "buy" | "always" | "never" | "who" | "ahead" | "subs";

const FIELD_ROW: Record<string, RowId> = {
  perOrderLimitEur: "limit",
  weeklyBudgetEur: "budget",
  forbiddenAllergens: "never",
  requiredAttributes: "always",
  signer: "who",
  maxLeadDays: "ahead",
  substitution: "subs",
  groups: "buy",
};

export function RulesCardView({
  card,
  busy,
  tap,
}: {
  card: RulesCardT;
  busy: boolean;
  tap: Tap;
}) {
  const p = card.proposal;
  if (p?.state === "open" && p.canSign)
    return <Proposal card={card} busy={busy} tap={tap} />;
  if (p?.state === "open")
    return <CannotSign card={card} busy={busy} tap={tap} />;
  if (p?.state === "signed") return <Signed card={card} />;
  return <Sheet card={card} busy={busy} tap={tap} />;
}

// ---------- words ----------

function useWords() {
  const { lang } = useLang();
  const tx = useText(THREAD_RULES_TEXT);
  const dx = useText(DOOR_TEXT);
  const f = useFormat();
  const eur = (n: number) => `${f.num(n)} €`;
  const allergens = (xs: string[]) =>
    xs.map((a) => dx.allergens[a] ?? a).join(", ");
  const claims = (xs: string[]) =>
    xs.map((c) => dx.claims[c] ?? f.attr(c)).join(", ");
  const groups = (card: RulesCardT, names: string[]) =>
    f.lang === "en"
      ? names.join(", ")
      : names
          .map(
            (n) =>
              DEPARTMENT_NAME[f.lang as "fi" | "sv"][
                card.vocabulary.groups.find((g) => g.name === n)?.id ?? ""
              ] ?? n,
          )
          .join(", ");
  /** A diff value (the server's plain string for a field) in the kitchen's words. */
  const value = (card: RulesCardT, field: string, v: string): string => {
    if (v === "") return tx.none;
    if (field === "perOrderLimitEur") return tx.kit.perOrder(eur(Number(v)));
    if (field === "weeklyBudgetEur") return eur(Number(v));
    if (field === "maxLeadDays") return tx.days(v);
    if (field === "forbiddenAllergens") return allergens(v.split(", "));
    if (field === "requiredAttributes") return claims(v.split(", "));
    if (field === "substitution") return dx.subs[v] ?? v;
    if (field === "groups") return groups(card, v.split(", "));
    if (field === "autoRenew") return v.split(", ").map((x) => familyL(x, lang).toLowerCase()).join(", ");
    return v;
  };
  return { tx: tx as Tx, dx, f, eur, allergens, claims, groups, value };
}

function rowsOf(
  card: RulesCardT,
  s: RulesSnapshot,
  w: ReturnType<typeof useWords>,
): RuleRow[] {
  const { tx, eur } = w;
  const who = s.approvers.map((a) => a.name).join(", ");
  const rows: RuleRow[] = [
    {
      id: "limit",
      label: tx.kit.rows.limit,
      value: tx.kit.perOrder(eur(Math.round(s.perOrderLimitCents / 100))),
      ...(who ? { detail: tx.kit.above(who) } : {}),
    },
    {
      id: "budget",
      label: tx.kit.rows.budget,
      value: eur(Math.round(s.weeklyBudgetCents / 100)),
    },
    ...(s.groups?.length
      ? [
          {
            id: "buy",
            label: tx.kit.rows.buy,
            value: w.groups(
              card,
              s.groups.map((g) => g.name),
            ),
          },
        ]
      : []),
    {
      id: "always",
      label: tx.kit.rows.always,
      value: s.requiredAttributes.length
        ? w.claims(s.requiredAttributes)
        : tx.none,
    },
    {
      id: "never",
      label: tx.kit.rows.never,
      value: s.forbiddenAllergens.length
        ? w.allergens(s.forbiddenAllergens)
        : tx.none,
    },
    { id: "who", label: tx.kit.rows.who, value: who || tx.kit.nobody },
  ];
  return rows;
}

// ---------- the rules as they stand, and one changed in place ----------

function Sheet({
  card,
  busy,
  tap,
}: {
  card: RulesCardT;
  busy: boolean;
  tap: Tap;
}) {
  const w = useWords();
  const { tx } = w;
  const [editing, setEditing] = useState<RowId | undefined>(undefined);
  const [blocked, setBlocked] = useState<RowId | undefined>(undefined);
  const rows = [
    ...rowsOf(card, card.current, w),
    // A rule the kitchen stated is its own memory: one that came through the memory (pref_mem_<item>) is changed or
    // forgotten there by the signed-in person; any other has no Change button rather than one that cannot change it.
    ...card.stated.map((r) => ({
      id: `said:${r.id}`,
      label: tx.kit.saidRow,
      value: r.text,
      ...(memoryItemOf(r.id) && card.editable.narrow ? {} : { fixed: true }),
    })),
  ];
  const [saying, setSaying] = useState<{ id: string; text: string } | undefined>(undefined);
  const canEdit = (id: RowId) =>
    id === "never" || id === "always"
      ? card.editable.narrow
      : id === "limit" || id === "budget" || id === "who"
        ? card.editable.terms
        : false;
  const anyEditable = card.editable.narrow || card.editable.terms;
  return (
    <>
      <RulesSheet
        kind={tx.kind}
        rows={rows}
        {...(anyEditable
          ? {
              onChange: (id: string) => {
                if (id.startsWith("said:")) {
                  const r = card.stated.find((x) => `said:${x.id}` === id);
                  if (r) setSaying({ id: r.id, text: r.text });
                  setEditing(undefined);
                  setBlocked(undefined);
                  return;
                }
                setSaying(undefined);
                const r = id as RowId;
                if (canEdit(r)) {
                  setEditing(r);
                  setBlocked(undefined);
                } else {
                  setBlocked(r);
                  setEditing(undefined);
                }
              },
            }
          : {})}
      />
      {card.proposal?.state === "cancelled" && (
        <p className="px-1 text-[0.86rem] text-ink-soft">{tx.kit.left}</p>
      )}
      {!anyEditable && card.editable.why && (
        <p className="px-1 text-[0.86rem] leading-snug text-ink-soft">
          {tx.why[card.editable.why] ?? tx.why.terms_fixed}
        </p>
      )}
      {blocked && (
        <p className="px-1 text-[0.86rem] leading-snug text-ink-soft">
          {(card.editable.why && tx.why[card.editable.why]) || tx.kit.notHere}
        </p>
      )}
      {saying && <StatedEditor key={saying.id} rule={saying} busy={busy} tap={tap} onDone={() => setSaying(undefined)} />}
      {editing && (
        <Editor
          key={editing}
          id={editing}
          card={card}
          busy={busy}
          tap={tap}
          onCancel={() => setEditing(undefined)}
        />
      )}
    </>
  );
}

/** The memory item behind a stated rule (`pref_mem_<itemId>`), or undefined for one that did not come through it. */
const memoryItemOf = (id: string) => (id.startsWith("pref_mem_") ? id.slice("pref_mem_".length) : undefined);

/**
 * A rule the kitchen stated, changed in its own words or forgotten: through the memory, by the kitchen's signed-in
 * person, recorded as theirs (memory_edit, memory_forget). The intake applies the new wording from the next request.
 */
function StatedEditor({ rule, busy, tap, onDone }: { rule: { id: string; text: string }; busy: boolean; tap: Tap; onDone: () => void }) {
  const { tx } = useWords();
  const [text, setText] = useState(rule.text);
  const itemId = memoryItemOf(rule.id)!;
  const next = text.trim();
  return (
    <>
      <RuleChange
        kind={tx.kind}
        title={tx.kit.saidRow}
        before={rule.text}
        after={next}
        changed={next.length >= 2 && next !== rule.text}
        confirm={tx.kit.saidSave}
        onConfirm={() => {
          if (busy) return;
          tap({ type: "memory_edit", itemId, text: next }, `${tx.kit.saidSave}: ${next}`);
          onDone();
        }}
        onCancel={onDone}
      >
        <label className="block text-[0.82rem] text-ink-soft">
          {tx.kit.saidLabel}
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={500} className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[0.92rem] text-ink" />
        </label>
      </RuleChange>
      <p className="px-1">
        <button
          type="button"
          disabled={busy}
          className={buttonClass("secondary", "sm")}
          onClick={() => {
            tap({ type: "memory_forget", itemId }, `${tx.kit.saidForget}: ${rule.text}`);
            onDone();
          }}
        >
          {tx.kit.saidForget}
        </button>
      </p>
    </>
  );
}

/** One rule, changed with its own control; confirming is the kitchen's person signing it (propose and sign, one tap). */
function Editor({
  id,
  card,
  busy,
  tap,
  onCancel,
}: {
  id: RowId;
  card: RulesCardT;
  busy: boolean;
  tap: Tap;
  onCancel: () => void;
}) {
  const w = useWords();
  const { tx, eur } = w;
  const s = card.current;
  const limitNow = Math.round(s.perOrderLimitCents / 100);
  const budgetNow = Math.round(s.weeklyBudgetCents / 100);
  const whoNow = s.approvers[0]?.name ?? "";
  const [limit, setLimit] = useState(limitNow);
  const [budget, setBudget] = useState(budgetNow);
  const [picked, setPicked] = useState<string[]>([]);
  const [who, setWho] = useState(whoNow);
  const commit = (change: RulesChange, words: string) =>
    !busy && tap({ type: "rules_propose", change, sign: true }, words);

  let body: ReactNode;
  let before: string;
  let after: string;
  let confirm: string;
  let note: string | undefined;
  let changed: boolean;
  let change: RulesChange;
  const approver = whoNow || tx.kit.nobody;
  if (id === "limit") {
    before = tx.kit.perOrder(eur(limitNow));
    after = tx.kit.perOrder(eur(limit));
    confirm = tx.kit.confirm.limit(eur(limit));
    changed = limit !== limitNow;
    note =
      limit > limitNow
        ? tx.kit.note.limit(eur(limit), approver)
        : tx.kit.note.limitDown(eur(limit), approver);
    change = { perOrderLimitEur: limit };
    body = (
      <Amount
        value={limit}
        onChange={setLimit}
        step={50}
        max={50_000}
        unit={tx.kit.euroPerOrder}
        picks={[300, 500, 800, 1000].filter((v) => v !== limitNow)}
      />
    );
  } else if (id === "budget") {
    before = eur(budgetNow);
    after = eur(budget);
    confirm = tx.kit.confirm.budget(eur(budget));
    changed = budget !== budgetNow;
    note = tx.kit.note.budget;
    change = { weeklyBudgetEur: budget };
    body = (
      <Amount
        value={budget}
        onChange={setBudget}
        step={250}
        max={200_000}
        unit={tx.kit.euroWeek}
        picks={[2500, 5000, 10000].filter((v) => v !== budgetNow)}
      />
    );
  } else if (id === "never" || id === "always") {
    const never = id === "never";
    const have = never ? s.forbiddenAllergens : s.requiredAttributes;
    const offer = (
      never ? card.vocabulary.forbid : card.vocabulary.require
    ).filter((x) => !have.includes(x));
    const name = (xs: string[]) => (never ? w.allergens(xs) : w.claims(xs));
    before = have.length ? name(have) : tx.none;
    after = name([...have, ...picked]);
    confirm = never
      ? tx.kit.confirm.never(name(picked))
      : tx.kit.confirm.always(name(picked));
    changed = picked.length > 0;
    note = never ? tx.kit.note.never : tx.kit.note.always;
    change = never ? { forbidAdd: picked } : { requireAdd: picked };
    body = (
      <div className="flex flex-wrap gap-1.5">
        {offer.map((x) => (
          <Chip
            key={x}
            on={picked.includes(x)}
            onClick={() =>
              setPicked((p) =>
                p.includes(x) ? p.filter((y) => y !== x) : [...p, x],
              )
            }
          >
            {name([x])}
          </Chip>
        ))}
      </div>
    );
  } else {
    before = whoNow || tx.kit.nobody;
    after = who.trim() || tx.kit.nobody;
    confirm = tx.kit.confirm.who(who.trim());
    changed = !!who.trim() && who.trim() !== whoNow;
    note = tx.kit.note.who(who.trim());
    change = { signer: who.trim() };
    body = (
      <label className="flex flex-col gap-1 text-[0.86rem] text-ink-soft">
        {tx.kit.name}
        <input
          value={who}
          onChange={(e) => setWho(e.target.value)}
          maxLength={60}
          autoComplete="name"
          className="min-h-11 rounded-lg border border-line-strong bg-paper px-3 text-[1rem] text-ink"
        />
      </label>
    );
  }
  return (
    <RuleChange
      kind={tx.kit.changeKind}
      title={tx.kit.title[id] ?? tx.kind}
      before={before}
      after={after}
      note={note}
      changed={changed && !busy}
      confirm={confirm}
      onConfirm={() => {
        commit(change, confirm);
        onCancel(); // the confirmed change continues below, as the agent's answer; this editor closes
      }}
      onCancel={onCancel}
    >
      {body}
    </RuleChange>
  );
}

function Amount({
  value,
  onChange,
  step,
  max,
  unit,
  picks,
}: {
  value: number;
  onChange: (n: number) => void;
  step: number;
  max: number;
  unit: string;
  picks: number[];
}) {
  const { tx, eur } = useWords();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <KitStepper
        value={value}
        onChange={onChange}
        min={0}
        max={max}
        step={step}
        less={tx.kit.less(eur(step))}
        more={tx.kit.more(eur(step))}
        label={tx.kit.amount}
        size="lg"
      >
        {unit}
      </KitStepper>
      <span className="flex flex-wrap gap-2">
        {picks.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`inline-flex min-h-11 items-center rounded-full border px-3.5 text-[0.86rem] font-medium tabular transition-colors duration-150 ${v === value ? "border-petrol bg-petrol-soft text-petrol-deep" : "border-line-strong bg-paper hover:border-petrol hover:bg-petrol-soft"}`}
          >
            {eur(v)}
          </button>
        ))}
      </span>
    </div>
  );
}

// ---------- a change asked for in words ----------

/** What the server worked out from the buyer's words, before and after; the button is the person's confirmation. */
function Proposal({
  card,
  busy,
  tap,
}: {
  card: RulesCardT;
  busy: boolean;
  tap: Tap;
}) {
  const w = useWords();
  const { tx } = w;
  const p = card.proposal!;
  const one = card.diff.length === 1 ? card.diff[0] : undefined;
  const row = one ? FIELD_ROW[one.field] : undefined;
  const before = card.diff
    .map((d) => w.value(card, d.field, d.before))
    .join("; ");
  const after = card.diff
    .map((d) => w.value(card, d.field, d.after))
    .join("; ");
  const approver = card.current.approvers[0]?.name ?? tx.kit.nobody;
  let confirm = tx.kit.confirm.many;
  let note: string | undefined;
  if (one && row === "limit") {
    const eur = w.eur(Number(one.after));
    confirm = tx.kit.confirm.limit(eur);
    note =
      Number(one.after) > Number(one.before)
        ? tx.kit.note.limit(eur, approver)
        : tx.kit.note.limitDown(eur, approver);
  } else if (one && row === "budget") {
    confirm = tx.kit.confirm.budget(w.eur(Number(one.after)));
    note = tx.kit.note.budget;
  } else if (one && row === "never") {
    const added = one.after
      .split(", ")
      .filter((x) => !one.before.split(", ").includes(x));
    confirm = tx.kit.confirm.never(
      w.allergens(added.length ? added : one.after.split(", ")),
    );
    note = tx.kit.note.never;
  } else if (one && row === "always") {
    const added = one.after
      .split(", ")
      .filter((x) => !one.before.split(", ").includes(x));
    confirm = tx.kit.confirm.always(
      w.claims(added.length ? added : one.after.split(", ")),
    );
    note = tx.kit.note.always;
  } else if (one && row === "who") {
    confirm = tx.kit.confirm.who(one.after);
    note = tx.kit.note.who(one.after);
  }
  return (
    <RuleChange
      kind={tx.kit.changeKind}
      title={(row && tx.kit.title[row]) || tx.kind}
      before={before}
      after={after}
      note={note}
      changed={!busy}
      confirm={confirm}
      onConfirm={() =>
        !busy && tap({ type: "rules_sign", proposalId: p.proposalId }, confirm)
      }
      onCancel={() =>
        !busy &&
        tap({ type: "rules_cancel", proposalId: p.proposalId }, tx.drop)
      }
    >
      {null}
    </RuleChange>
  );
}

/** Confirmed: the rule as it is now, settled. */
function Signed({ card }: { card: RulesCardT }) {
  const w = useWords();
  const { tx } = w;
  const one = card.diff.length === 1 ? card.diff[0] : undefined;
  const row = one ? FIELD_ROW[one.field] : undefined;
  return (
    <RuleChange
      kind={tx.kind}
      title={(row && tx.kit.rows[row]) || tx.kind}
      before={card.diff.map((d) => w.value(card, d.field, d.before)).join("; ")}
      after={card.diff.map((d) => w.value(card, d.field, d.after)).join("; ")}
      note={tx.kit.done}
      changed
      done
      confirm=""
      onConfirm={() => undefined}
      onCancel={() => undefined}
    >
      {null}
    </RuleChange>
  );
}

/** A change this browser cannot confirm (a demo kitchen's fixed limits, nobody signed in): what it would be, and why not. */
function CannotSign({
  card,
  busy,
  tap,
}: {
  card: RulesCardT;
  busy: boolean;
  tap: Tap;
}) {
  const w = useWords();
  const { tx } = w;
  const p = card.proposal!;
  return (
    <ThreadCard
      kind={tx.kind}
      mark={<ShieldCheck aria-hidden size={15} />}
      actions={
        <button
          type="button"
          disabled={busy}
          className="inline-flex min-h-11 items-center rounded-full px-3 text-[0.9rem] font-medium text-petrol hover:bg-petrol-soft"
          onClick={() =>
            tap({ type: "rules_cancel", proposalId: p.proposalId }, tx.drop)
          }
        >
          {tx.drop}
        </button>
      }
    >
      <dl className="space-y-1 rounded-lg bg-surface px-3 py-2.5 text-[0.92rem] leading-snug">
        {card.diff.map((d) => (
          <div
            key={d.field}
            className="flex items-baseline justify-between gap-3"
          >
            <dt className="shrink-0 text-ink-soft">
              {tx.field[d.field] ?? d.field}
            </dt>
            <dd className="text-right">
              <span className="text-ink-soft line-through decoration-ink-soft/50">
                {w.value(card, d.field, d.before)}
              </span>{" "}
              <span className="font-semibold">
                {w.value(card, d.field, d.after)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[0.88rem] leading-snug text-ink-soft">
        <span className="font-semibold text-ink">{tx.kit.cannot}.</span>{" "}
        {tx.why[p.why ?? ""] ?? tx.why.terms_fixed}
      </p>
    </ThreadCard>
  );
}

/** The set-up interview's euro stepper (k/signup/thread-interview.tsx). */
export function Stepper({
  label,
  value,
  step,
  min,
  max,
  onChange,
  unit = "€",
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  unit?: string;
}) {
  const f = useFormat();
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <div className="flex items-center justify-between gap-3 text-[0.9rem]">
      <span>{label}</span>
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          aria-label={`${label} −${step}`}
          className={buttonClass("quiet", "sm", "min-w-10")}
          onClick={() => set(value - step)}
        >
          −
        </button>
        <span className="min-w-20 text-center font-semibold tabular">
          {f.num(value)} {unit}
        </span>
        <button
          type="button"
          aria-label={`${label} +${step}`}
          className={buttonClass("quiet", "sm", "min-w-10")}
          onClick={() => set(value + step)}
        >
          +
        </button>
      </span>
    </div>
  );
}
