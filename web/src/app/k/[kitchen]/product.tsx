"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../_client/api";
import { Plate, Skeleton, Tag, Working } from "../../_ui/kit";
import { useFormat, useText } from "../../_i18n/provider";
import { usePortal } from "./portal";
import { PRODUCT_TEXT } from "./product.text";
import { BuyBox, Facts, PackPlate, TempMark, Tile, allergenText, nameIn, readable, useProfile } from "./shop";
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
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]" aria-label={tx.loading}>
        <Skeleton className="h-[30rem]" />
        <Skeleton className="h-[24rem]" />
      </div>
    );
  const p = page.product;
  const grid = "repeat(auto-fill, minmax(min(100%, 15rem), 1fr))";
  return (
    <div className="mt-5">
      <nav aria-label={tx.breadcrumb} className="flex flex-wrap items-center gap-1.5 text-[0.95rem]">
        <Link href={`${base}/catalogue`} className="text-petrol underline decoration-1 underline-offset-4 hover:decoration-2">
          {tx.catalogue}
        </Link>
        <span aria-hidden className="text-ink-soft">
          /
        </span>
        <Link href={`${base}/catalogue?c=${encodeURIComponent(page.category.id)}`} className="text-petrol underline decoration-1 underline-offset-4 hover:decoration-2">
          {page.category.label}
        </Link>
      </nav>
      <div className="mt-3 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <article className="bg-paper">
          <PackPlate p={p} size="lg" />
          <div className="p-5 sm:p-7">
            <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[0.95rem]">
              <TempMark t={p.temperatureClass} />
              <span className="text-ink-soft">{p.brand !== "unknown" ? p.brand : p.vendor}</span>
            </p>
            <h1 className="display mt-2 max-w-[24ch] break-words text-[2.6rem] leading-[1] text-ink sm:text-[3.1rem]">{readable(nameIn(p, lang))}</h1>
            {prof && (
              <p className="mt-3 max-w-[60ch] text-[1.08rem] leading-snug">
                <strong>{prof.kind.charAt(0).toUpperCase() + prof.kind.slice(1)}</strong>
                {prof.uses.length > 0 && <span className="text-ink-soft">
                    {tx.forUses}
                    {prof.uses.map((u) => u.text).join(", ")}
                  </span>}.
              </p>
            )}
            <div className="mt-6 border-t border-line pt-5">
              <Facts p={p} lang={lang} />
            </div>
          </div>
        </article>
        <div className="lg:sticky lg:top-3">
          <BuyBox p={p} />
        </div>
      </div>

      <Alternatives productId={p.id} />

      {page.substitutes.length > 0 && (
        <section aria-labelledby="subs" className="mt-10">
          <h2 id="subs" className="display text-[1.9rem] text-ink">
            {tx.substitutes}
          </h2>
          <ul className="mt-3 grid gap-3" style={{ gridTemplateColumns: grid }}>
            {page.substitutes.map((s) => (
              <Tile key={s.id} p={s} />
            ))}
          </ul>
        </section>
      )}
      {page.similar.length > 0 && (
        <section aria-labelledby="more" className="mt-10">
          <h2 id="more" className="display text-[1.9rem] text-ink">
            {tx.moreIn(page.category.label)}
          </h2>
          <ul className="mt-3 grid gap-3" style={{ gridTemplateColumns: grid }}>
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
    <section aria-labelledby="alts" className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="alts" className="display text-[1.9rem] text-ink">
            {tx.altsTitle}
          </h2>
          <p className="max-w-[70ch] text-ink-soft">
            {tx.altsIntro}
            {rules.length ? tx.checkedAgainst(kitchen.name, rules.join(", ")) : ""}
          </p>
        </div>
      </div>
      {uses.length > 1 && (
        <div role="tablist" aria-label={tx.useTabs} className="mt-3 flex flex-wrap gap-1">
          {uses.map((u) => (
            <button
              key={u.id}
              role="tab"
              aria-selected={shownUse === u.id}
              onClick={() => setUse(u.id)}
              className={`min-h-10 px-3 text-[0.95rem] font-semibold ${shownUse === u.id ? "bg-petrol text-paper" : "bg-paper text-petrol outline-1 outline-line hover:outline-petrol"}`}
            >
              {tx.forUse(u.text)}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Plate>
          {!current && <Working className="p-4">{tx.ranking}</Working>}
          {current?.error && <p className="p-4 text-ink-soft">{tx.altsFailed(current.error)}</p>}
          {a && a.substitutes.length === 0 && (
            <div className="p-5">
              <p className="text-[1.15rem] font-semibold">{tx.noGood(shownUse ? textOfUse(shownUse) : undefined)}</p>
              <p className="mt-1 max-w-[60ch] leading-snug text-ink-soft">
                {a.none ?? tx.noneFallback}
                {tx.agentAsks}
              </p>
            </div>
          )}
          {a && a.substitutes.length > 0 && (
            <ol className="divide-y divide-line">
              {a.substitutes.map((s) => (
                <li key={s.productId} className="grid gap-x-4 gap-y-1 px-4 py-3.5 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
                  <p className="flex items-center gap-2 sm:flex-col sm:items-start">
                    <span className="display text-[1.35rem]">{tx.tier[s.tier]}</span>
                    <span aria-hidden className="flex items-end gap-0.5">
                      {[1, 2, 3].map((i) => (
                        <span key={i} className={`w-2 ${i <= (TIER[s.tier]?.n ?? 0) ? "bg-petrol" : "bg-line"}`} style={{ height: 5 + i * 4 }} />
                      ))}
                    </span>
                  </p>
                  <div className="min-w-0">
                    <Link href={`${base}/catalogue/${encodeURIComponent(s.productId)}`} className="font-semibold text-ink underline decoration-line decoration-2 underline-offset-4 hover:decoration-petrol">
                      {readable(s.name.replace(/[®™]/g, ""))}
                    </Link>
                    <p className="mt-0.5 leading-snug text-ink-soft">{s.reason}</p>
                    {(s.changes.length > 0 || s.conditions.length > 0 || s.partnerListed) && (
                      <p className="mt-1.5 flex flex-wrap gap-1">
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
                </li>
              ))}
            </ol>
          )}
        </Plate>
        <Plate>
          <div className="p-4">
            <h3 className="font-semibold">{tx.otherPacks}</h3>
            {!a && !current?.error && <Skeleton className="mt-2 h-16" />}
            {a && a.packAlternatives.length === 0 && <p className="mt-1 text-ink-soft">{tx.noOtherPacks}</p>}
            {a && a.packAlternatives.length > 0 && (
              <ul className="mt-2 space-y-2">
                {a.packAlternatives.map((s) => (
                  <li key={s.productId} className="leading-snug">
                    <Link href={`${base}/catalogue/${encodeURIComponent(s.productId)}`} className="text-petrol underline decoration-1 underline-offset-4 hover:decoration-2">
                      {readable(s.name.replace(/[®™]/g, ""))}
                    </Link>
                    {s.changes.length > 0 && <span className="block text-[0.88rem] text-ink-soft">{s.changes.map((c) => c.text).join(", ")}</span>}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[0.85rem] leading-snug text-ink-soft">{tx.packNote}</p>
          </div>
        </Plate>
      </div>
    </section>
  );
}
