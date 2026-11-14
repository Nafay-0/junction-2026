"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Check, Copy, MessageSquareText, Sparkles } from "lucide-react";
import { api } from "../../_client/api";
import { useFormat, useText } from "../../_i18n/provider";
import { Badge, Button, Card, ErrorPlate, PageHeader, Skeleton } from "../../_ui/kit";
import { usePortal } from "./portal";
import { GUIDE_TEXT } from "./guide.text";
import { guideWords } from "@/server/demo/words";
import type { Guide, GuideRow, Staged } from "@/server/demo/service";

/**
 * "Try everything": a demo account's own guide (server/demo/service.ts decides the rows, their order and the ticks).
 * One row per capability: what it shows, the exact words (copy them, or send them to the agent), a "Set it up" for
 * what has to exist first (staged for this kitchen only), and a tick once the kitchen's record shows it happened.
 * Calm: no tour, nothing that takes over the screen.
 */
export function TryEverything() {
  const { kitchen, base, agent, account } = usePortal();
  const tx = useText(GUIDE_TEXT);
  const f = useFormat();
  const [g, setG] = useState<Guide>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [staged, setStaged] = useState<Record<string, Staged>>({});
  const [copied, setCopied] = useState<string>();
  const own = !!account && account.kitchen === kitchen.slug;

  const load = useCallback(async () => {
    const r = await api<{ guide: Guide }>("GET", `/ui-api/kitchens/${encodeURIComponent(kitchen.slug)}/demo`);
    if (!r.ok) return setError(r.error.message);
    setError(undefined);
    setG(r.data.guide);
  }, [kitchen.slug]);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    // A row ticks itself while the guide is open: the agent's work lands in the record as it happens.
    const t = setInterval(() => void load(), 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  async function setUp(row: GuideRow) {
    if (!row.setup || busy) return;
    setBusy(row.id);
    const r = await api<{ staged: Staged }>("POST", `/ui-api/kitchens/${encodeURIComponent(kitchen.slug)}/demo`, { action: "stage", kind: row.setup.action });
    setBusy(undefined);
    if (!r.ok) return setError(r.error.message);
    setStaged((s) => ({ ...s, [row.id]: r.data.staged }));
    void load();
  }
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? undefined : c)), 1500);
    } catch {
      // no clipboard here: the words are on the screen to type
    }
  }

  if (!own) return <div className="mt-8"><ErrorPlate title={tx.title} message={tx.notDemo} /></div>;
  if (!g) return <div className="mt-8 space-y-3">{error ? <ErrorPlate title={tx.title} message={error} onRetry={() => void load()} /> : <><Skeleton className="h-24" /><Skeleton className="h-40" /><Skeleton className="h-40" /></>}</div>;

  const fx = g.facts;
  const words = guideWords(fx, f.lang, staged.backup);
  const links: Partial<Record<GuideRow["id"], { href: string; label: string; external?: boolean }[]>> = {
    signoff: [{ href: `${base}/agent#devices`, label: tx.openPhone }],
    email: [{ href: `${base}/agent#mail`, label: tx.openRules }],
    receipt: fx.orderId ? [{ href: `${base}/orders/${fx.orderId}`, label: tx.openOrder }] : [],
    outside: [
      { href: `${base}/agent#connect`, label: tx.openConnect },
      { href: "/try", label: tx.openTry, external: true },
    ],
    ops: [{ href: "/ops", label: tx.openOps, external: true }],
  };

  return (
    <div className="mt-6 space-y-6 sm:mt-8">
      <PageHeader title={tx.title} lead={tx.lead} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-[12rem] flex-1 items-center gap-3" role="progressbar" aria-valuemin={0} aria-valuemax={g.of} aria-valuenow={g.done} aria-valuetext={tx.progress(g.done, g.of)}>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-lavender-mid">
            <span className="block h-full rounded-full bg-petrol transition-[width] duration-300" style={{ width: `${Math.round((g.done / Math.max(1, g.of)) * 100)}%` }} />
          </span>
          <span className="shrink-0 text-[0.9rem] font-semibold tabular" data-testid="guide-progress">
            {tx.progress(g.done, g.of)}
          </span>
        </div>
        <p className="w-full text-[0.9rem] leading-snug text-ink-soft">{fx.sample ? tx.sampleNote : tx.emptyNote}</p>
      </div>
      {error && <ErrorPlate title={tx.title} message={error} />}
      <ol className="space-y-3">
        {g.rows.map((row, i) => {
          const t = tx.rows[row.id];
          const say = t.say?.(words) ?? [];
          const isNext = g.next === row.id;
          const result = staged[row.id];
          const setupShown = row.setup && !["phone", "connect", "ops"].includes(row.setup.action);
          return (
            <li key={row.id} id={`try-${row.id}`} data-row={row.id} data-done={row.done ? "1" : "0"}>
              <Card pad className={`space-y-3 ${isNext ? "ring-2 ring-petrol/40" : ""}`}>
                <div className="flex items-start gap-3">
                  <span aria-hidden className={`display mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-[0.9rem] tabular ${row.done ? "bg-good text-paper" : "bg-petrol-soft text-petrol-deep"}`}>
                    {row.done ? <Check size={17} strokeWidth={2.6} /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[1.05rem] font-semibold leading-snug">
                      <span>{t.title}</span>
                      {row.done && <Badge tone="good">{tx.done}</Badge>}
                      {!row.done && isNext && <Badge tone="info">{tx.next}</Badge>}
                      {(row.staged || result) && <Badge tone="waiting">{tx.staged}</Badge>}
                    </h2>
                    <p className="mt-0.5 text-[0.95rem] leading-snug text-ink-soft">{t.shows(words)}</p>
                  </div>
                </div>
                {setupShown && (
                  <div className="flex flex-wrap items-center gap-2.5 pl-11">
                    {row.setup!.ready ? (
                      <Button kind="secondary" size="sm" busy={busy === row.id} disabled={!!busy} onClick={() => void setUp(row)}>
                        {busy !== row.id && <Sparkles aria-hidden size={15} />}
                        {busy === row.id ? tx.settingUp : tx.setUp}
                      </Button>
                    ) : (
                      <p className="text-[0.88rem] leading-snug text-ink-soft">{row.setup!.why === "not_demo" ? tx.notDemo : tx.needsRecurring}</p>
                    )}
                    {result && <p role="status" className="text-[0.88rem] leading-snug text-ink">{result.summary}</p>}
                  </div>
                )}
                {row.needs === "history" && <p className="pl-11 text-[0.88rem] leading-snug text-ink-soft">{tx.needsHistory}</p>}
                {say.length > 0 && (
                  <div className="space-y-1.5 pl-11">
                    <p className="text-[0.8rem] font-medium uppercase tracking-wide text-ink-faint">{tx.say}</p>
                    <ul className="space-y-1.5">
                      {say.map((s, j) => {
                        const key = `${row.id}:${j}`;
                        return (
                          <li key={key} className="flex flex-col gap-1.5 rounded-lg bg-surface px-3 py-2 sm:flex-row sm:items-center">
                            <q className="min-w-0 flex-1 text-[0.95rem] leading-snug [overflow-wrap:anywhere]" data-words>
                              {s}
                            </q>
                            <span className="flex shrink-0 gap-1.5">
                              <Button kind="quiet" size="sm" onClick={() => void copy(key, s)} ariaLabel={`${tx.copy}: ${s}`}>
                                {copied === key ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
                                {copied === key ? tx.copied : tx.copy}
                              </Button>
                              <Button kind="quiet" size="sm" onClick={() => agent.send({ kind: "ask", text: s })} ariaLabel={`${tx.ask}: ${s}`}>
                                <MessageSquareText aria-hidden size={14} />
                                {tx.ask}
                              </Button>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {(t.do || (links[row.id]?.length ?? 0) > 0) && (
                  <div className="space-y-1.5 pl-11">
                    {t.do && <p className="text-[0.92rem] leading-snug">{t.do}</p>}
                    {row.id === "ops" && <p className="text-[0.88rem] leading-snug text-ink-soft">{tx.opsPass}</p>}
                    {(links[row.id] ?? []).length > 0 && (
                      <p className="flex flex-wrap gap-x-4 gap-y-1">
                        {links[row.id]!.map((l) =>
                          l.external ? (
                            <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 font-semibold text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
                              {l.label}
                              <ArrowUpRight aria-hidden size={15} />
                            </a>
                          ) : (
                            <Link key={l.href} href={l.href} className="inline-flex min-h-11 items-center font-semibold text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
                              {l.label}
                            </Link>
                          ),
                        )}
                      </p>
                    )}
                  </div>
                )}
                {(row.id === "receipt" || row.id === "ops") && <p className="pl-11 text-[0.82rem] text-ink-faint">{tx.look}</p>}
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
