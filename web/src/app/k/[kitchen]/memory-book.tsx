"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../../_client/api";
import { Button, ErrorPlate, Skeleton, Tag } from "../../_ui/kit";
import { dayL } from "../../_i18n/format";
import type { Lang } from "../../_i18n/lang";
import { useFormat, useText } from "../../_i18n/provider";
import { clock, helsinkiToday } from "../../_ui/plain";
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

  if (view === undefined) return <Skeleton className="h-72" label={tx.loading} />;
  if (view === null) return <>{fallback}</>;

  const active = view.items.filter((i) => i.status === "active" || i.status === "faded");
  const groups: { id: Item["strength"]; title: string; note: string }[] = (["rule", "habit", "one_off"] as const).map((id) => ({ id, ...tx.groups[id] }));
  const shared = active.filter((i) => i.audience === "shared").length;
  const lastRead = view.staffReads[0];
  const openProposals = view.proposals.filter((p) => p.status === "open");

  return (
    <section aria-labelledby="knows" className="space-y-4">
      <div className="on-dark bg-lavender-deep p-5 text-paper sm:p-7">
        <h2 id="knows" className="display text-[2.2rem] sm:text-[2.8rem]">
          {tx.title(kitchen.agentName, kitchen.name)}
        </h2>
        <p className="mt-2 max-w-[70ch] text-[1.05rem] leading-snug text-paper/90">
          {active.length === 0 ? tx.nothing : tx.summary(active.length, groups.map((g) => tx.count[g.id](active.filter((i) => i.strength === g.id).length)).join(", "))}
        </p>
        <dl className="mt-5 grid gap-px bg-paper/15 sm:grid-cols-3">
          <div className="bg-lavender-deep py-2 pr-3">
            <dt className="text-[0.85rem] text-paper/70">{tx.shared}</dt>
            <dd className="display text-[2rem] tabular">
              {shared} <span className="font-sans text-[0.95rem] font-medium text-paper/80">{tx.of(active.length)}</span>
            </dd>
          </div>
          <div className="bg-lavender-deep py-2 sm:px-3">
            <dt className="text-[0.85rem] text-paper/70">{tx.staffRead}</dt>
            <dd className="text-[1.05rem] font-semibold leading-snug">{lastRead ? tx.readAt(lastRead.by, when(lastRead.at, lang), clock(lastRead.at)) : tx.notRead}</dd>
          </div>
          <div className="bg-lavender-deep py-2 sm:px-3">
            <dt className="text-[0.85rem] text-paper/70">{tx.forgotten}</dt>
            <dd className="text-[1.05rem] font-semibold leading-snug">{view.forgotten.length ? tx.forgottenN(view.forgotten.length) : tx.nothingForgotten}</dd>
          </div>
        </dl>
      </div>

      {problem && <ErrorPlate title={tx.changeFailed} message={tx.changeFailedMsg(problem)} />}

      {(view.pending.length > 0 || openProposals.length > 0) && (
        <div className="space-y-2">
          {view.pending.map((p) => (
            <div key={p.itemId} className="flex flex-wrap items-center justify-between gap-3 bg-lavender p-4">
              <p className="text-[1.1rem] font-semibold">{p.question}</p>
              <div className="flex gap-2">
                <Button kind="primary" busy={busy === `c:${p.itemId}`} disabled={!!busy} onClick={() => void act(`c:${p.itemId}`, { action: "confirm", itemId: p.itemId, answer: "yes" })}>
                  {tx.yesRemember}
                </Button>
                <Button kind="secondary" disabled={!!busy} onClick={() => void act(`c:${p.itemId}`, { action: "confirm", itemId: p.itemId, answer: "no" })}>
                  {tx.no}
                </Button>
              </div>
            </div>
          ))}
          {openProposals.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 bg-lavender p-4">
              <div>
                <p className="text-[0.88rem] font-semibold text-lavender-deep">
                  {tx.suggested(p.by, when(p.at, lang))}
                </p>
                <p className="text-[1.1rem] font-semibold">{p.text}</p>
              </div>
              <div className="flex gap-2">
                <Button kind="primary" busy={busy === `p:${p.id}`} disabled={!!busy} onClick={() => void act(`p:${p.id}`, { action: "proposal", proposalId: p.id, accept: true })}>
                  {tx.accept}
                </Button>
                <Button kind="secondary" disabled={!!busy} onClick={() => void act(`p:${p.id}`, { action: "proposal", proposalId: p.id, accept: false })}>
                  {tx.decline}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-6">
        {groups.map((g) => {
          const items = active.filter((i) => i.strength === g.id);
          if (g.id === "one_off" && items.length === 0) return null;
          return (
            <div key={g.id}>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
                <h3 className="display text-[1.7rem] text-ink">{g.title}</h3>
                <p className="text-[0.95rem] text-ink-soft">{g.note}</p>
              </div>
              {items.length === 0 ? (
                <p className="bg-paper p-4 leading-snug text-ink-soft">{g.id === "rule" ? tx.noRules : tx.noHabits}</p>
              ) : (
                <ul className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 21rem), 1fr))" }}>
                  {items.map((it) => (
                    <MemoryCard key={it.id} it={it} now={now} busy={busy} act={act} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <TellIt busy={busy === "note"} onSave={(text) => act("note", { action: "note", text })} />
      <p className="text-[0.92rem] text-ink-soft">
        {view.deliveryWeekdays?.length ? tx.deliveries(weekdaysText(view.deliveryWeekdays, lang)) : ""}
        {tx.ledger(kitchen.by)}
      </p>
    </section>
  );
}

function MemoryCard({ it, now, busy, act }: { it: Item; now: number; busy?: string; act: (key: string, body: Record<string, unknown>) => Promise<boolean> }) {
  const tx = useText(MEMORY_BOOK_TEXT);
  const { lang } = useFormat();
  const [mode, setMode] = useState<"view" | "correct" | "forget">("view");
  const [text, setText] = useState(it.text);
  const mine = busy?.endsWith(it.id);
  const faded = it.status === "faded";
  return (
    <li className={`flex flex-col bg-paper ${faded ? "opacity-70" : ""}`}>
      <div aria-hidden className={it.safety ? "h-1.5 bg-ink" : it.strength === "rule" ? "h-1.5 bg-lavender-deep" : "h-[3px] bg-lavender-deep/50"} />
      <div className="flex flex-1 flex-col p-4">
        <p className="flex flex-wrap items-center gap-1.5">
          <Tag tone="agent">{it.kindLabel}</Tag>
          {it.safety && <Tag tone="plain">{tx.safety}</Tag>}
          {it.family && <Tag tone="muted">{familyL(it.family, lang)}</Tag>}
          {it.scope?.site && <Tag tone="muted">{it.scope.site}</Tag>}
          {faded && <Tag tone="muted">{tx.faded}</Tag>}
        </p>
        {mode === "correct" ? (
          <form
            className="mt-2"
            onSubmit={(e) => {
              e.preventDefault();
              void act(`x:${it.id}`, { action: "correct", itemId: it.id, text: text.trim() }).then((ok) => ok && setMode("view"));
            }}
          >
            <label className="text-[0.88rem] font-semibold" htmlFor={`fix-${it.id}`}>
              {tx.sayIt}
            </label>
            <input id={`fix-${it.id}`} autoFocus value={text} onChange={(e) => setText(e.target.value)} className="mt-1 min-h-11 w-full border-2 border-petrol px-2 text-[1.05rem]" />
            <div className="mt-2 flex flex-wrap gap-3">
              <Button type="submit" kind="primary" busy={mine} disabled={!text.trim() || text.trim() === it.text}>
                {tx.save}
              </Button>
              <Button kind="quiet" onClick={() => setMode("view")}>
                {tx.cancel}
              </Button>
            </div>
            <p className="mt-1 text-[0.85rem] text-ink-soft">{tx.oldKept}</p>
          </form>
        ) : (
          <p className="mt-2 text-[1.2rem] font-semibold leading-snug">{it.text}</p>
        )}
        <p className="mt-1.5 text-[0.92rem] leading-snug text-ink-soft">{provenance(it, lang)}</p>
        {it.strength === "habit" && (
          <div className="mt-2 flex items-center gap-2" title={tx.strengthTitle}>
            <span className="text-[0.82rem] text-ink-soft">{tx.strength}</span>
            <span aria-hidden className="h-1.5 w-24 bg-lavender">
              <span className="block h-full bg-lavender-deep" style={{ width: `${Math.round(it.weight * 100)}%` }} />
            </span>
            <span className="text-[0.82rem] text-ink-soft tabular">{Math.round(it.weight * 100)} %</span>
          </div>
        )}
        <p className="mt-1 text-[0.85rem] text-ink-soft">{sinceText(it.lastUsedAt, now, lang)}</p>

        {it.mandate?.status === "offered" && (
          <div className="mt-3 border-l-4 border-ink bg-mist px-3 py-2">
            <p className="text-[0.95rem] font-semibold">{tx.addAsk}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button kind="primary" size="sm" busy={busy === `m:${it.id}`} disabled={!!busy} onClick={() => void act(`m:${it.id}`, { action: "mandate", itemId: it.id, decision: "added" })}>
                {tx.add}
              </Button>
              <Button kind="quiet" disabled={!!busy} onClick={() => void act(`m:${it.id}`, { action: "mandate", itemId: it.id, decision: "declined" })}>
                {tx.keepMemory}
              </Button>
            </div>
          </div>
        )}
        {it.mandate?.status === "added" && <p className="mt-2 text-[0.88rem] font-semibold">{tx.inMandate}</p>}
        {it.mandate?.status === "intake_only" && <p className="mt-2 text-[0.88rem] text-ink-soft">{tx.intakeOnly}</p>}

        {mode === "forget" ? (
          <div className="mt-3 bg-mist p-3" role="alertdialog" aria-label={tx.forgetLabel(it.text)}>
            <p className="font-semibold">{tx.forgetAsk}</p>
            <p className="text-[0.92rem] leading-snug text-ink-soft">{tx.forgetNote}</p>
            <div className="mt-2 flex flex-wrap gap-3">
              <Button kind="dark" busy={mine} onClick={() => void act(`f:${it.id}`, { action: "forget", itemId: it.id })}>
                {tx.forgetIt}
              </Button>
              <Button kind="quiet" onClick={() => setMode("view")}>
                {tx.keepIt}
              </Button>
            </div>
          </div>
        ) : (
          mode === "view" && (
            <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
              <button
                type="button"
                role="switch"
                aria-checked={it.audience === "shared"}
                disabled={!!busy}
                onClick={() => void act(`a:${it.id}`, { action: "audience", itemId: it.id, audience: it.audience === "shared" ? "private" : "shared" })}
                className="flex min-h-10 items-center gap-2 text-[0.92rem]"
              >
                <span aria-hidden className={`flex h-6 w-11 items-center p-0.5 ${it.audience === "shared" ? "justify-end bg-petrol" : "justify-start bg-line"}`}>
                  <span className="size-5 bg-paper" />
                </span>
                {it.audience === "shared" ? tx.sharedWith : tx.private}
              </button>
              <span className="ml-auto flex gap-4">
                <Button kind="quiet" disabled={!!busy} onClick={() => setMode("correct")}>
                  {tx.correct}
                </Button>
                <Button kind="quiet" disabled={!!busy} onClick={() => setMode("forget")}>
                  {tx.forget}
                </Button>
              </span>
            </div>
          )
        )}
      </div>
    </li>
  );
}

function TellIt({ busy, onSave }: { busy: boolean; onSave: (text: string) => Promise<boolean> }) {
  const tx = useText(MEMORY_BOOK_TEXT);
  const [text, setText] = useState("");
  return (
    <form
      className="bg-lavender p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) void onSave(text.trim()).then((ok) => ok && setText(""));
      }}
    >
      <label htmlFor="tell" className="font-semibold text-lavender-deep">
        {tx.tell}
      </label>
      <div className="mt-1 flex flex-wrap gap-2">
        <input id="tell" value={text} onChange={(e) => setText(e.target.value)} placeholder={tx.tellPlaceholder} className="min-h-11 min-w-0 flex-1 border-2 border-lavender-deep bg-paper px-3 text-[1.02rem]" />
        <Button type="submit" kind="primary" busy={busy} disabled={!text.trim()}>
          {tx.remember}
        </Button>
      </div>
      <p className="mt-1 text-[0.85rem] text-ink-soft">{tx.tellNote}</p>
    </form>
  );
}
