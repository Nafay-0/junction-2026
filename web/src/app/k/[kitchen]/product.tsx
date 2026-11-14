"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../_client/api";
import { ChevronRight, SearchX } from "lucide-react";
import { Card, IconDisc, Panel, SectionTitle, Skeleton, Tabs, Tag } from "../../_ui/kit";
import { useFormat, useText } from "../../_i18n/provider";
import { usePortal } from "./portal";
import { PRODUCT_TEXT } from "./product.text";
import { BuyBox, CLAIM_LABELS, Facts, PackPlate, TempMark, Tile, allergenText, claimsOf, nameIn, readable, useProfile } from "./shop";
import { ErrorPlate } from "./ui";
import type { ProductPage as Page } from "./types";

/** A product page: the pack and the facts as the data states them, the live buy box, alternatives by kitchen use. */
export function ProductPage({ id }: { id: string }) {
  const { ui, base, lang } = usePortal();
  const tx = useText(PRODUCT_TEXT);
  const [page, setPage] = useState<Page>();
  const [error, setError] = useState<string>();
  const prof = useProfile(id);
  useEffect(() => {
    let alive = true;
    void ui<Page>("GET", `catalog/product/${encodeURIComponent(id)}`).then((r) => {
      if (!alive) return;
      if (r.ok) setPage(r.data);
      else setError(r.error.message);
    });
    return () => {
      alive = false;
    };
  }, [id, ui]);

  if (error) return <ErrorPlate title={tx.loadFailed} message={tx.loadFailedMessage(error)} />;
  if (!page)
    return (
      <div className="mt-5 grid items-start gap-6 lg:mt-6 lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-10" role="status" aria-label={tx.loading}>
        <div className="space-y-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="aspect-[4/3] w-full !rounded-[28px]" />
          <Skeleton className="h-10 w-3/4" />
        </div>
        <Skeleton className="h-[26rem] !rounded-[20px]" />
      </div>
    );
  const p = page.product;
  const brand = p.brand !== "unknown" ? p.brand : p.vendor;
  return (
    <div className="mt-4 sm:mt-5">
      <nav aria-label={tx.breadcrumb} className="flex min-w-0 flex-wrap items-center gap-x-1 text-[0.9rem]">
        <Link href={`${base}/catalogue`} className="inline-flex min-h-9 items-center rounded-full px-1 font-medium text-petrol hover:underline hover:underline-offset-4 pointer-coarse:min-h-11">
          {tx.catalogue}
        </Link>
        <ChevronRight aria-hidden size={15} className="shrink-0 text-ink-faint" />
        <Link href={`${base}/catalogue?c=${encodeURIComponent(page.category.id)}`} className="inline-flex min-h-9 min-w-0 items-center rounded-full px-1 font-medium text-petrol hover:underline hover:underline-offset-4 pointer-coarse:min-h-11">
          <span className="truncate">{page.category.label}</span>
        </Link>
      </nav>
      <div className="mt-2 grid items-start gap-x-10 gap-y-6 [grid-template-areas:'head'_'pic'_'buy'_'facts'] lg:grid-cols-[minmax(0,1fr)_25rem] lg:[grid-template-areas:'pic_buy'_'head_buy'_'facts_buy']">
        <div className="[grid-area:pic]">
          <PackPlate p={p} size="lg" />
        </div>
        <header className="min-w-0 [grid-area:head]">
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[0.92rem]">
            <TempMark t={p.temperatureClass} />
            {brand && <span className="text-ink-soft">{brand}</span>}
          </p>
          <h1 className="display mt-1.5 max-w-[26ch] break-words text-[1.95rem] leading-[1.06] text-ink hyphens-manual sm:text-[2.5rem]">{readable(nameIn(p, lang))}</h1>
          {prof ? (
            <p className="mt-3 max-w-[60ch] text-[1.02rem] leading-relaxed">
              <strong className="font-semibold">{prof.kind.charAt(0).toUpperCase() + prof.kind.slice(1)}</strong>
              {prof.uses.length > 0 && (
                <span className="text-ink-soft">
                  {tx.forUses}
                  {prof.uses.map((u) => u.text).join(", ")}
                </span>
              )}
              .
            </p>
          ) : prof === undefined ? (
            <Skeleton className="mt-3 h-5 w-64" />
          ) : null}
          {claimsOf(p).length > 0 && (
            <p className="mt-3 flex flex-wrap gap-1.5">
              {claimsOf(p).map((c) => (
                <Tag key={c}>{CLAIM_LABELS[lang][c]}</Tag>
              ))}
            </p>
          )}
        </header>
        <div className="[grid-area:buy] lg:sticky lg:top-24">
          <BuyBox p={p} />
        </div>
        <Card as="section" className="p-5 [grid-area:facts] sm:p-6">
          <h2 className="display mb-4 text-[1.3rem]">{tx.factsTitle}</h2>
          <Facts p={p} lang={lang} />
        </Card>
      </div>

      <Alternatives productId={p.id} />

      {page.substitutes.length > 0 && (
        <section aria-labelledby="subs" className="mt-12">
          <SectionTitle id="subs">{tx.substitutes}</SectionTitle>
          <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))]">
            {page.substitutes.map((s) => (
              <Tile key={s.id} p={s} />
            ))}
          </ul>
        </section>
      )}
      {page.similar.length > 0 && (
        <section aria-labelledby="more" className="mt-12">
          <SectionTitle id="more">{tx.moreIn(page.category.label)}</SectionTitle>
          <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))]">
            {page.similar.map((s) => (
              <Tile key={s.id} p={s} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---------- alternatives by use, from the knowledge map ----------

type Alt = {
  productId: string;
  name: string;
  brand: string | null;
  kindLabel: string;
  tier: "best" | "better" | "good";
  reason: string;
  changes: { kind: string; text: string }[];
  conditions: { code: string; text: string }[];
  checks: { claimsKept: string[]; allergens: string };
  otherPacks: string[];
  partnerListed: boolean;
};
type Alts = { available: true; product: { uses: string[]; kindLabel: string | null }; use: string | null; substitutes: Alt[]; packAlternatives: Alt[]; none?: string };

const TIER: Record<string, { n: number }> = { best: { n: 3 }, better: { n: 2 }, good: { n: 1 } };

/**
 * What else fits the same job in the kitchen: ranked substitutes for one use, each with why it fits and what
 * changes, checked against this kitchen's own rules; the same product in other pack sizes listed apart; and an
 * honest "no good alternative" when there is none.
 */
function Alternatives({ productId }: { productId: string }) {
  const { kitchen, base, lang } = usePortal();
  const tx = useText(PRODUCT_TEXT);
  const f = useFormat();
  const prof = useProfile(productId);
  const [use, setUse] = useState<string>();
  const [data, setData] = useState<{ key: string; alts?: Alts; error?: string }>();
  const m = kitchen.mandate;
  const key = `${productId}:${use ?? ""}`;
  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ product: productId });
    if (use) q.set("use", use);
    if (m.requiredAttributes.length) q.set("claims", m.requiredAttributes.join(","));
    if (m.forbiddenAllergens.length) q.set("allergens", m.forbiddenAllergens.join(","));
    void api<Alts>("GET", `/ui-api/knowledge/alternatives?${q.toString()}`).then((r) => {
      if (alive) setData(r.ok ? { key, alts: r.data } : { key, error: r.error.message });
    });
    return () => {
      alive = false;
    };
  }, [key, productId, use, m.requiredAttributes, m.forbiddenAllergens]);
  const current = data?.key === key ? data : undefined;
  const a = current?.alts;
  const uses = prof?.uses ?? [];
  const shownUse = use ?? a?.use ?? uses[0]?.id;
  const textOfUse = (u?: string | null) => uses.find((x) => x.id === u)?.text ?? (u ?? "").replaceAll("_", " ");
  const rules = [...m.requiredAttributes.map(f.attr), ...m.forbiddenAllergens.map((x) => tx.noAllergen(allergenText(x, lang)))];

  return (
    <section aria-labelledby="alts" className="mt-12">
      <SectionTitle id="alts">{tx.altsTitle}</SectionTitle>
      <p className="-mt-2 max-w-[68ch] leading-relaxed text-ink-soft">
        {tx.altsIntro}
        {rules.length ? tx.checkedAgainst(kitchen.name, rules.join(", ")) : ""}
      </p>
      {uses.length > 1 && <Tabs className="mt-4" label={tx.useTabs} value={shownUse ?? ""} onChange={setUse} options={uses.map((u) => ({ id: u.id, label: tx.forUse(u.text) }))} />}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          {!current && (
            <div className="space-y-3 p-5" role="status" aria-label={tx.ranking}>
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-5 w-2/5" />
            </div>
          )}
          {current?.error && <p className="p-5 text-ink-soft">{tx.altsFailed(current.error)}</p>}
          {a && a.substitutes.length === 0 && (
            <div className="flex items-start gap-4 p-5 sm:p-6">
              <IconDisc tone="muted">
                <SearchX size={20} />
              </IconDisc>
              <div className="min-w-0">
                <p className="text-[1.05rem] font-semibold leading-snug">{tx.noGood(shownUse ? textOfUse(shownUse) : undefined)}</p>
                <p className="mt-1 max-w-[60ch] leading-relaxed text-ink-soft">
                  {a.none ?? tx.noneFallback}
                  {tx.agentAsks}
                </p>
              </div>
            </div>
          )}
          {a && a.substitutes.length > 0 && (
            <ol className="divide-y divide-line">
              {a.substitutes.map((s) => (
                <li key={s.productId} className="relative flex gap-4 px-5 py-4 transition-colors hover:bg-mist">
                  <span className="w-[4.5rem] shrink-0 pt-0.5">
                    <span className="block text-[0.9rem] font-semibold text-petrol-deep">{tx.tier[s.tier]}</span>
                    <span aria-hidden className="mt-1 flex items-end gap-0.5">
                      {[1, 2, 3].map((i) => (
                        <span key={i} className={`w-2 rounded-[2px] ${i <= (TIER[s.tier]?.n ?? 0) ? "bg-petrol" : "bg-line"}`} style={{ height: 4 + i * 4 }} />
                      ))}
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={`${base}/catalogue/${encodeURIComponent(s.productId)}`} className="font-semibold leading-snug text-ink after:absolute after:inset-0 hover:text-petrol">
                      {readable(s.name.replace(/[®™]/g, ""))}
                    </Link>
                    <p className="mt-0.5 text-[0.95rem] leading-snug text-ink-soft">{s.reason}</p>
                    {(s.changes.length > 0 || s.conditions.length > 0 || s.partnerListed) && (
                      <p className="mt-2 flex flex-wrap gap-1">
                        {s.changes.map((c) => (
                          <Tag key={c.text} tone="muted">
                            {c.text}
                          </Tag>
                        ))}
                        {s.conditions.map((c) => (
                          <Tag key={c.code}>{c.text}</Tag>
                        ))}
                        {s.partnerListed && <Tag tone="petrol">{tx.alsoListed}</Tag>}
                      </p>
                    )}
                  </div>
                  <ChevronRight aria-hidden size={18} className="mt-0.5 shrink-0 text-ink-faint" />
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Panel className="p-5">
          <h3 className="font-semibold">{tx.otherPacks}</h3>
          {!a && !current?.error && <Skeleton className="mt-3 h-14" />}
          {a && a.packAlternatives.length === 0 && <p className="mt-1 text-[0.95rem] text-ink-soft">{tx.noOtherPacks}</p>}
          {a && a.packAlternatives.length > 0 && (
            <ul className="mt-2 space-y-2.5">
              {a.packAlternatives.map((s) => (
                <li key={s.productId} className="leading-snug">
                  <Link href={`${base}/catalogue/${encodeURIComponent(s.productId)}`} className="font-medium text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
                    {readable(s.name.replace(/[®™]/g, ""))}
                  </Link>
                  {s.changes.length > 0 && <span className="mt-0.5 block text-[0.86rem] text-ink-soft">{s.changes.map((c) => c.text).join(", ")}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-[0.82rem] leading-snug text-ink-soft">{tx.packNote}</p>
        </Panel>
      </div>
    </section>
  );
}
