"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePortal } from "./portal";
import { BuyBox, Facts, TEMP, Tile, nameIn, readable } from "./shop";
import { ErrorPlate } from "./ui";
import type { ProductPage as Page } from "./types";

/** A product page: the facts as the data states them, the live buy box, and the partner's listed substitutes. */
export function ProductPage({ id }: { id: string }) {
  const { ui, base, lang } = usePortal();
  const [page, setPage] = useState<Page>();
  const [error, setError] = useState<string>();
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

  if (error) return <ErrorPlate title="This product did not load" message={error} />;
  if (!page) return <div className="mt-6 h-96 animate-pulse bg-paper/60" aria-label="Loading the product" />;
  const p = page.product;
  const t = TEMP[p.temperatureClass ?? ""];
  return (
    <div className="mt-5">
      <nav aria-label="Breadcrumb" className="text-[0.92rem]">
        <Link href={`${base}/catalogue`} className="underline decoration-1 underline-offset-4">
          Catalogue
        </Link>
        <span className="px-1.5 text-ink-soft">/</span>
        <Link href={`${base}/catalogue?c=${encodeURIComponent(page.category.id)}`} className="underline decoration-1 underline-offset-4">
          {page.category.label}
        </Link>
      </nav>
      <div className="mt-3 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <article className="bg-paper">
          <div aria-hidden className="h-2" style={{ background: t?.color ?? "var(--color-ink)" }} />
          <div className="p-5">
            <p className="text-[0.92rem] text-ink-soft">
              {p.brand !== "unknown" ? p.brand : p.vendor} <span style={{ color: t?.color }}>{t ? `, ${t.label.toLowerCase()}` : ""}</span>
            </p>
            <h1 className="mt-1 max-w-[30ch] font-display text-[2.3rem] font-bold leading-[1.05] tracking-tight">{readable(nameIn(p, lang))}</h1>
            <div className="mt-5 border-t border-ink/15 pt-4">
              <Facts p={p} lang={lang} />
            </div>
          </div>
        </article>
        <div className="lg:sticky lg:top-3">
          <BuyBox p={p} />
        </div>
      </div>
      {page.substitutes.length > 0 && (
        <section aria-labelledby="subs" className="mt-8">
          <h2 id="subs" className="font-display text-[1.5rem] font-bold">
            Substitutes the wholesaler lists for this
          </h2>
          <ul className="mt-2 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 14.5rem), 1fr))" }}>
            {page.substitutes.map((s) => (
              <Tile key={s.id} p={s} />
            ))}
          </ul>
        </section>
      )}
      {page.similar.length > 0 && (
        <section aria-labelledby="more" className="mt-8">
          <h2 id="more" className="font-display text-[1.5rem] font-bold">
            More in {page.category.label}
          </h2>
          <ul className="mt-2 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 14.5rem), 1fr))" }}>
            {page.similar.map((s) => (
              <Tile key={s.id} p={s} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
