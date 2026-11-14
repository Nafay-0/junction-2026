"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../../_client/api";
import { ChevronDown, PenLine, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { Button, Card, ErrorPlate, Input, Panel, Skeleton, Switch, Tag } from "../../_ui/kit";
import { dayL } from "../../_i18n/format";
import type { Lang } from "../../_i18n/lang";
import { useFormat, useText } from "../../_i18n/provider";
import { clock, helsinkiToday, say } from "../../_ui/plain";
import { categoryCodesL } from "./groups";
import { familyL } from "./family.text";
import { MEMORY_BOOK_TEXT } from "./memory-book.text";
import { usePortal, weekdaysText } from "./portal";

/**
 * What the kitchen's agent knows about the kitchen, from GET /ui-api/memory/kitchens/{kitchen}: typed items, each
 * with its strength (rule, habit, one-off), where it came from (who said it, when, the exact words), whether the
 * wholesaler's staff can see it, and when it was last used. Correct, forget and share are one tap each and say what
 * they will do before they do it. Every change goes to the ledger as made by the person the console relays for.
 */

type Source = { door: string; at: string; by?: string; orderId?: string; requestId?: string; quote?: string };
type Item = {
  id: string;
  kind: string;
  kindLabel: string;
  text: string;
  label: string;
  family?: string;
  scope?: { site?: string; person?: string };
  strength: "rule" | "habit" | "one_off";
  origin: "stated" | "learned" | "inferred";
  status: "active" | "pending_confirmation" | "faded" | "superseded";
  audience: "shared" | "private";
  safety: boolean;
  weight: number;
  confirmations: number;
  sources: Source[];
  createdAt: string;
  lastUsedAt?: string;
  confirmedBy?: { by: string; at: string };
  mandate?: { status: "offered" | "added" | "declined" | "intake_only"; at: string; by?: string; mandateId?: string };
};
type View = {
  items: Item[];
  pending: { itemId: string; question: string }[];
  proposals: { id: string; by: string; at: string; text: string; status: "open" | "accepted" | "declined" }[];
  staffReads: { by: string; at: string; items: number }[];
  forgotten: { kind: string; at: string; by: string }[];
  deliveryWeekdays?: number[];
};

const when = (iso: string, lang: Lang = "en") => dayL(helsinkiToday(new Date(iso)), lang);

function sinceText(iso: string | undefined, now: number, lang: Lang): string {
  const tx = MEMORY_BOOK_TEXT[lang];
  if (!iso) return tx.notUsed;
  const d = Math.floor((now - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? tx.usedToday(clock(iso)) : d === 1 ? tx.usedYesterday : tx.usedDays(d);
}

/** Where an item came from, in a sentence a buyer reads. */
function provenance(it: Item, lang: Lang): ReactNode {
  const tx = MEMORY_BOOK_TEXT[lang];
  const s = it.sources.at(-1);
  if (!s) return it.origin === "learned" ? tx.learnedOrders : tx.statedShop;
  if (it.origin === "learned") {
    const orders = new Set(it.sources.map((x) => x.orderId).filter(Boolean)).size;
    return tx.learnedFrom(orders || it.sources.length, when(s.at, lang));
  }
  return (
    <>
      {it.origin === "inferred" ? tx.readFrom : tx.saidBy}
      {s.by ? <strong className="font-semibold text-ink">{s.by.replace(/\s*\(.*\)$/, "")}</strong> : tx.theKitchen}
      {tx.onIn(when(s.at, lang), tx.door[s.door] ?? s.door)}
      {s.quote && (
        <>
          : <q className="italic">{s.quote}</q>
        </>
      )}
    </>
  );
}

export function MemoryBook({ fallback }: { fallback: ReactNode }) {
  const { kitchen } = usePortal();
  const tx = useText(MEMORY_BOOK_TEXT);
  const { lang } = useFormat();
  const base = `/ui-api/memory/kitchens/${encodeURIComponent(kitchen.slug)}`;
  const [view, setView] = useState<View | null>();
  const [busy, setBusy] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [now] = useState(() => Date.now());
  // Each group shows its first three; the rest one tap away, so the page stays short on a phone.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const load = useCallback(() => {
    void api<View>("GET", base).then((r) => setView(r.ok && Array.isArray(r.data.items) ? r.data : null));
  }, [base]);
  useEffect(load, [load]);

  const act = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    setProblem(undefined);
    const r = await api<unknown>("POST", base, body);
    setBusy(undefined);
    if (!r.ok) setProblem(r.error.message);
    load();
    return r.ok;
  };

  if (view === undefined)
    return (
      <div className="space-y-4" role="status" aria-label={tx.loading}>
        <Skeleton className="h-52 !rounded-[28px]" />
        <Skeleton className="h-64 !rounded-[20px]" />
      </div>
    );
  if (view === null) return <>{fallback}</>;

  const active = view.items.filter((i) => i.status === "active" || i.status === "faded");
  const groups: { id: Item["strength"]; title: string; note: string }[] = (["rule", "habit", "one_off"] as const).map((id) => ({ id, ...tx.groups[id] }));
  const shared = active.filter((i) => i.audience === "shared").length;
  const lastRead = view.staffReads[0];
  const openProposals = view.proposals.filter((p) => p.status === "open");

  return (
    <section aria-labelledby="knows" className="space-y-8">
      {/* The agent's own colour: what it remembered, in lavender. */}
      <div className="rounded-2xl bg-lavender p-5 sm:p-7">
        <p className="flex items-center gap-2 text-[0.9rem] font-medium text-lavender-deep">
          <Sparkles aria-hidden size={16} />
          {kitchen.agentName}
        </p>
        <h2 id="knows" className="display mt-1.5 max-w-[30ch] break-words text-[1.75rem] leading-[1.1] text-ink hyphens-manual sm:text-[2.1rem]">
          {tx.title(kitchen.agentName, kitchen.name)}
        </h2>
        <p className="mt-2.5 max-w-[66ch] leading-relaxed text-ink">{active.length === 0 ? tx.nothing : tx.summary(active.length, groups.map((g) => tx.count[g.id](active.filter((i) => i.strength === g.id).length)).join(", "))}</p>
        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-lavender-mid pt-5 sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-[0.85rem] text-lavender-deep">{tx.shared}</dt>
            <dd className="mt-0.5 flex items-baseline gap-1.5">
              <span className="display text-[1.9rem] tabular">{shared}</span>
              <span className="text-[0.95rem] text-ink-soft">{tx.of(active.length)}</span>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[0.85rem] text-lavender-deep">{tx.staffRead}</dt>
            <dd className="mt-1 font-semibold leading-snug">{lastRead ? tx.readAt(lastRead.by, when(lastRead.at, lang), clock(lastRead.at)) : tx.notRead}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[0.85rem] text-lavender-deep">{tx.forgotten}</dt>
            <dd className="mt-1 font-semibold leading-snug">{view.forgotten.length ? tx.forgottenN(view.forgotten.length) : tx.nothingForgotten}</dd>
          </div>
        </dl>
      </div>

      {problem && <ErrorPlate title={tx.changeFailed} message={tx.changeFailedMsg(problem)} />}

      {(view.pending.length > 0 || openProposals.length > 0) && (
        <ul className="space-y-3">
          {view.pending.map((p) => (
            <li key={p.itemId} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-lavender-mid bg-paper p-5">
              <p className="flex min-w-0 flex-1 basis-60 items-start gap-2.5 text-[1.08rem] font-semibold leading-snug">
                <Sparkles aria-hidden size={17} className="mt-1 shrink-0 text-lavender-deep" />
                {p.question}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button kind="primary" busy={busy === `c:${p.itemId}`} disabled={!!busy} onClick={() => void act(`c:${p.itemId}`, { action: "confirm", itemId: p.itemId, answer: "yes" })}>
                  {tx.yesRemember}
                </Button>
                <Button kind="secondary" disabled={!!busy} onClick={() => void act(`c:${p.itemId}`, { action: "confirm", itemId: p.itemId, answer: "no" })}>
                  {tx.no}
                </Button>
              </div>
            </li>
          ))}
          {openProposals.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-lavender-mid bg-paper p-5">
              <div className="min-w-0 flex-1 basis-60">
                <p className="text-[0.88rem] font-medium text-lavender-deep">{tx.suggested(p.by, when(p.at, lang))}</p>
                <p className="mt-0.5 text-[1.08rem] font-semibold leading-snug">{say(categoryCodesL(p.text, lang))}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button kind="primary" busy={busy === `p:${p.id}`} disabled={!!busy} onClick={() => void act(`p:${p.id}`, { action: "proposal", proposalId: p.id, accept: true })}>
                  {tx.accept}
                </Button>
                <Button kind="secondary" disabled={!!busy} onClick={() => void act(`p:${p.id}`, { action: "proposal", proposalId: p.id, accept: false })}>
                  {tx.decline}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {groups.map((g) => {
        const items = active.filter((i) => i.strength === g.id);
        if (g.id === "one_off" && items.length === 0) return null;
        return (
          <div key={g.id}>
            <div className="mb-3">
              <h3 className="display text-[1.4rem] text-ink">
                {g.title} <span className="font-sans text-[1rem] font-medium text-ink-soft tabular">{items.length}</span>
              </h3>
              <p className="mt-0.5 max-w-[66ch] text-[0.95rem] leading-snug text-ink-soft">{g.note}</p>
            </div>
            {items.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line-strong bg-paper/60 px-5 py-4 leading-snug text-ink-soft">{g.id === "rule" ? tx.noRules : tx.noHabits}</p>
            ) : (
              <>
                <Card>
                  <ul className="divide-y divide-line">
                    {(openGroups[g.id] ? items : items.slice(0, 3)).map((it) => (
                      <MemoryRow key={it.id} it={it} now={now} busy={busy} act={act} />
                    ))}
                  </ul>
                </Card>
                {items.length > 3 && (
                  <button type="button" aria-expanded={!!openGroups[g.id]} onClick={() => setOpenGroups((o) => ({ ...o, [g.id]: !o[g.id] }))} className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 text-[0.95rem] font-semibold text-petrol hover:underline">
                    <ChevronDown aria-hidden size={17} className={`transition-transform duration-150 motion-reduce:transition-none ${openGroups[g.id] ? "rotate-180" : ""}`} />
                    {openGroups[g.id] ? tx.showFewer : tx.showAll(items.length)}
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}

      <TellIt busy={busy === "note"} onSave={(text) => act("note", { action: "note", text })} />
      <p className="text-[0.9rem] text-ink-soft">
        {view.deliveryWeekdays?.length ? tx.deliveries(weekdaysText(view.deliveryWeekdays, lang)) : ""}
        {tx.ledger(kitchen.by)}
      </p>
    </section>
  );
}

function MemoryRow({ it, now, busy, act }: { it: Item; now: number; busy?: string; act: (key: string, body: Record<string, unknown>) => Promise<boolean> }) {
  const tx = useText(MEMORY_BOOK_TEXT);
  const { lang } = useFormat();
  const [mode, setMode] = useState<"view" | "correct" | "forget">("view");
  const [text, setText] = useState(it.text);
  const mine = busy?.endsWith(it.id);
  const faded = it.status === "faded";
  const pct = Math.round(it.weight * 100);
  return (
    <li className={`px-5 py-5 sm:px-6 ${faded ? "opacity-70" : ""}`}>
      <p className="flex flex-wrap items-center gap-1.5">
        <Tag tone="agent">{it.kindLabel}</Tag>
        {it.safety && (
          <Tag tone="petrol">
            <ShieldCheck aria-hidden size={13} />
            {tx.safety}
          </Tag>
        )}
        {it.family && <Tag tone="muted">{familyL(it.family, lang)}</Tag>}
        {it.scope?.site && <Tag tone="muted">{it.scope.site}</Tag>}
        {faded && <Tag tone="muted">{tx.faded}</Tag>}
      </p>
      {mode === "correct" ? (
        <form
          className="mt-3 max-w-xl"
          onSubmit={(e) => {
            e.preventDefault();
            void act(`x:${it.id}`, { action: "correct", itemId: it.id, text: text.trim() }).then((ok) => ok && setMode("view"));
          }}
        >
          <Input id={`fix-${it.id}`} label={tx.sayIt} hint={tx.oldKept} autoFocus value={text} onChange={setText} />
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Button type="submit" kind="primary" busy={mine} disabled={!text.trim() || text.trim() === it.text}>
              {tx.save}
            </Button>
            <Button kind="quiet" onClick={() => setMode("view")}>
              {tx.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-2.5 text-[1.12rem] font-semibold leading-snug">{say(categoryCodesL(it.text, lang))}</p>
      )}
      <p className="mt-1 text-[0.92rem] leading-snug text-ink-soft">{provenance(it, lang)}</p>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.85rem] text-ink-soft">
        {it.strength === "habit" && (
          <span className="flex items-center gap-2" title={tx.strengthTitle}>
            {tx.strength}
            <span aria-hidden className="h-1.5 w-20 overflow-hidden rounded-full bg-lavender-mid">
              <span className="block h-full rounded-full bg-lavender-deep" style={{ width: `${pct}%` }} />
            </span>
            <span className="tabular">{pct} %</span>
          </span>
        )}
        <span>{sinceText(it.lastUsedAt, now, lang)}</span>
      </p>

      {it.mandate?.status === "offered" && (
        <Panel className="mt-4 p-4">
          <p className="text-[0.95rem] font-semibold leading-snug">{tx.addAsk}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Button kind="primary" size="sm" busy={busy === `m:${it.id}`} disabled={!!busy} onClick={() => void act(`m:${it.id}`, { action: "mandate", itemId: it.id, decision: "added" })}>
              {tx.add}
            </Button>
            <Button kind="quiet" disabled={!!busy} onClick={() => void act(`m:${it.id}`, { action: "mandate", itemId: it.id, decision: "declined" })}>
              {tx.keepMemory}
            </Button>
          </div>
        </Panel>
      )}
      {it.mandate?.status === "added" && (
        <p className="mt-2 flex items-center gap-1.5 text-[0.88rem] font-semibold text-good">
          <ShieldCheck aria-hidden size={15} />
          {tx.inMandate}
        </p>
      )}
      {it.mandate?.status === "intake_only" && <p className="mt-2 text-[0.88rem] text-ink-soft">{tx.intakeOnly}</p>}

      {mode === "forget" ? (
        <div className="mt-4 rounded-lg bg-surface p-4" role="alertdialog" aria-label={tx.forgetLabel(it.text)}>
          <p className="font-semibold">{tx.forgetAsk}</p>
          <p className="mt-0.5 text-[0.92rem] leading-snug text-ink-soft">{tx.forgetNote}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Button kind="dark" size="sm" busy={mine} onClick={() => void act(`f:${it.id}`, { action: "forget", itemId: it.id })}>
              {tx.forgetIt}
            </Button>
            <Button kind="quiet" onClick={() => setMode("view")}>
              {tx.keepIt}
            </Button>
          </div>
        </div>
      ) : (
        mode === "view" && (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
            <Switch on={it.audience === "shared"} disabled={!!busy} onChange={(on) => void act(`a:${it.id}`, { action: "audience", itemId: it.id, audience: on ? "shared" : "private" })}>
              {it.audience === "shared" ? tx.sharedWith : tx.private}
            </Switch>
            <span className="flex gap-5 sm:ml-auto">
              <Button kind="quiet" disabled={!!busy} onClick={() => setMode("correct")}>
                <PenLine aria-hidden size={15} />
                {tx.correct}
              </Button>
              <Button kind="quiet" disabled={!!busy} onClick={() => setMode("forget")}>
                <Trash2 aria-hidden size={15} />
                {tx.forget}
              </Button>
            </span>
          </div>
        )
      )}
    </li>
  );
}

function TellIt({ busy, onSave }: { busy: boolean; onSave: (text: string) => Promise<boolean> }) {
  const tx = useText(MEMORY_BOOK_TEXT);
  const [text, setText] = useState("");
  return (
    <form
      className="rounded-xl bg-lavender p-5 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) void onSave(text.trim()).then((ok) => ok && setText(""));
      }}
    >
      <div className="flex flex-wrap items-start gap-3">
        <Input id="tell" className="min-w-0 flex-1 basis-64" label={tx.tell} hint={tx.tellNote} value={text} onChange={setText} placeholder={tx.tellPlaceholder} enterKeyHint="done" />
        <Button type="submit" kind="primary" busy={busy} disabled={!text.trim()} className="sm:mt-[1.85rem]">
          {tx.remember}
        </Button>
      </div>
    </form>
  );
}
