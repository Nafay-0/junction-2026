"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { attr, num } from "../../_ui/plain";
import { usePortal, type Lang } from "./portal";
import { CLAIM_LABEL, TEMP, Tile } from "./shop";
import { ErrorPlate } from "./ui";
import type { CatalogReply, ShopDepartment } from "./types";

/**
 * The storefront: departments and categories across the whole assortment, search in English, Finnish or
 * Swedish, dietary and allergen filters, and a product grid. Master data only; live price and stock come
 * when a product is opened or added, and the page counts those calls.
 */

const CLAIMS = ["lactose_free", "low_lactose", "gluten_free", "vegan", "vegetarian", "organic"] as const;
const ALLERGENS = ["milk", "gluten", "eggs", "nuts", "peanuts", "soy", "fish", "sesame", "celery", "mustard"] as const;
const LANGS: { id: Lang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "fi", label: "Suomi" },
  { id: "sv", label: "Svenska" },
];

export function Catalogue() {
  const { kitchen, ui, lang, setLang, live } = usePortal();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const applied = params.get("q") ?? "";
  const claims = params.getAll("claim");
  const free = params.getAll("free");
  const defaultCat = kitchen.mandate.allowedCategories[0];
  const category = params.get("c") ?? (applied ? "" : (defaultCat ?? ""));
  const [q, setQ] = useState(applied);
  const [depts, setDepts] = useState<ShopDepartment[]>();
  const [data, setData] = useState<CatalogReply>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(36);
  const [startCalls] = useState(live.calls);
  const [startProducts] = useState(live.products);

  const set = (patch: Record<string, string | string[] | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      next.delete(k);
      if (Array.isArray(v)) v.forEach((x) => next.append(k, x));
      else if (v !== undefined) next.set(k, v);
    }
    setLimit(36);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  useEffect(() => {
    void ui<{ departments: ShopDepartment[] }>("GET", "catalog/categories").then((r) => r.ok && setDepts(r.data.departments));
  }, [ui]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (applied) p.set("q", applied);
    if (category) p.set("category", category);
    claims.forEach((c) => p.append("claim", c));
    free.forEach((a) => p.append("free", a));
    p.set("limit", String(limit));
    return p.toString();
  }, [applied, category, claims, free, limit]);

  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      setLoading(true);
      setError(undefined);
    });
    void ui<CatalogReply>("GET", `catalog?${query}`).then((r) => {
      if (!alive) return;
      setLoading(false);
      if (r.ok) setData(r.data);
      else setError(r.error.message);
    });
    return () => {
      alive = false;
    };
  }, [query, ui]);

  const current = findCategory(depts, category);
  const [openDept, setOpenDept] = useState<string>();
  const shownDept = openDept ?? current?.dept.id;
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const pageCalls = live.calls - startCalls;
  const pageProducts = live.products - startProducts;
  const total = data?.source.products;
  const title = applied ? `“${applied}”` : current ? current.cat.label : category ? attr(category) : "All products";

  return (
    <div className="mt-5 grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="Departments" className="lg:sticky lg:top-3 lg:max-h-[calc(100dvh-1.5rem)] lg:overflow-y-auto">
        <h2 className="text-[0.95rem] font-semibold">Departments</h2>
        {!depts && <div className="mt-2 h-64 animate-pulse bg-paper/60" />}
        <ul className="mt-1">
          {depts?.map((d) => {
            const open = shownDept === d.id;
            return (
              <li key={d.id} className="border-b border-line">
                <button type="button" aria-expanded={open} onClick={() => setOpenDept(open ? "" : d.id)} className={`flex min-h-10 w-full items-baseline justify-between gap-2 py-1.5 text-left ${open ? "font-bold" : ""}`}>
                  <span>{d.name}</span>
                  <span className="text-[0.82rem] font-normal text-ink-soft tabular">{num(d.count, 0)}</span>
                </button>
                {open && (
                  <ul className="mb-2 space-y-px">
                    {d.categories.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          aria-current={c.id === current?.cat.id ? "true" : undefined}
                          onClick={() => {
                            setQ("");
                            set({ c: c.id, q: undefined });
                          }}
                          className={`flex min-h-8 w-full items-baseline justify-between gap-2 py-0.5 pl-3 pr-1 text-left text-[0.92rem] ${c.id === current?.cat.id ? "bg-ink font-semibold text-paper" : "hover:bg-paper"}`}
                        >
                          <span className="flex items-center gap-1.5">
                            <span aria-hidden className="inline-block size-2 shrink-0" style={{ background: TEMP[c.temperature ?? ""]?.color ?? "transparent" }} />
                            {c.label}
                          </span>
                          <span className="text-[0.8rem] tabular opacity-70">{c.count}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        {depts && depts.length > 1 && <p className="mt-2 text-[0.8rem] leading-snug text-ink-soft">The wholesaler publishes category numbers only; these names are derived from the products in each.</p>}
      </nav>

      <section aria-labelledby="shop-title" className="min-w-0">
        <form
          role="search"
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            set({ q: q.trim() || undefined, c: q.trim() ? undefined : category || undefined });
          }}
        >
          <div className="min-w-[16rem] flex-1">
            <label htmlFor="cat-q" className="text-[0.95rem] font-semibold">
              Search {total ? `${num(total, 0)} products` : "products"}
            </label>
            <div className="mt-1 flex border-2 border-ink bg-paper">
              <input id="cat-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="oat drink, kaurajuoma, havredryck…" className="min-h-12 min-w-0 flex-1 bg-transparent px-3 text-[1.05rem] focus:outline-none" />
              <button type="submit" className="bg-ink px-4 font-semibold text-paper">
                Search
              </button>
            </div>
          </div>
          <div role="group" aria-label="Product names in" className="flex">
            {LANGS.map((l) => (
              <button key={l.id} type="button" aria-pressed={lang === l.id} onClick={() => setLang(l.id)} className={`min-h-12 border-2 border-ink px-3 text-[0.92rem] ${lang === l.id ? "bg-ink font-semibold text-paper" : "bg-paper"} -ml-[2px] first:ml-0`}>
                {l.label}
              </button>
            ))}
          </div>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Must be">
            <span className="text-[0.9rem] font-semibold">Must be</span>
            {CLAIMS.map((c) => (
              <Chip key={c} on={claims.includes(c)} onClick={() => set({ claim: toggle(claims, c) })}>
                {CLAIM_LABEL[c]}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Leave out allergens">
            <span className="text-[0.9rem] font-semibold">Without</span>
            {ALLERGENS.map((a) => (
              <Chip key={a} on={free.includes(a)} onClick={() => set({ free: toggle(free, a) })}>
                {attr(a)}
              </Chip>
            ))}
          </div>
        </div>
        {free.length > 0 && <p className="mt-1 text-[0.85rem] text-ink-soft">Products with no allergen data are left out too: unknown is not safe.</p>}

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-b-[3px] border-ink pb-2">
          <div>
            {current && !applied && <p className="text-[0.88rem] text-ink-soft">{current.dept.name}</p>}
            <h1 id="shop-title" className="font-display text-[1.9rem] font-bold leading-tight tracking-tight">
              {title}
            </h1>
            <p className="text-[0.92rem] text-ink-soft" aria-live="polite">
              {loading ? "Searching…" : data ? `${data.products.length}${data.products.length === limit ? "+" : ""} products from the product files in ${data.ms} ms. No live call for the list.` : ""}
              {(applied || category !== (defaultCat ?? "") || claims.length > 0 || free.length > 0) && (
                <button
                  type="button"
                  className="ml-2 font-semibold text-ink underline decoration-2 underline-offset-4"
                  onClick={() => {
                    setQ("");
                    router.replace(pathname, { scroll: false });
                  }}
                >
                  Clear
                </button>
              )}
            </p>
          </div>
          <p className="flex items-center gap-2" aria-live="polite">
            <span className="font-display text-[1.9rem] font-bold leading-none tabular">{pageCalls}</span>
            <span className="text-[0.88rem] leading-tight">
              live price check{pageCalls === 1 ? "" : "s"} on this page
              <span className="block text-ink-soft">
                for {pageProducts} product{pageProducts === 1 ? "" : "s"} you opened or added
              </span>
            </span>
          </p>
        </div>

        {error && <ErrorPlate title="The catalogue did not load" message={error} />}
        {!loading && data?.products.length === 0 && <p className="mt-3 bg-paper p-4 text-ink-soft">Nothing matches. Remove a filter, or search in another language: “maito”, “mjölk”.</p>}
        <ul className={`mt-3 grid gap-3 ${loading ? "opacity-60" : ""}`} style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 14.5rem), 1fr))" }}>
          {data?.products.map((p) => <Tile key={p.id} p={p} />)}
        </ul>
        {data && data.products.length === limit && limit < 100 && (
          <button type="button" onClick={() => setLimit(100)} className="mt-4 min-h-11 border-2 border-ink bg-paper px-4 font-semibold">
            Show more
          </button>
        )}
        {live.error && <ErrorPlate title="The live check failed" message={live.error} />}
      </section>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`min-h-9 border-2 px-2.5 text-[0.9rem] ${on ? "border-ink bg-ink font-semibold text-paper" : "border-ink/30 bg-paper hover:border-ink"}`}>
      {children}
    </button>
  );
}

function findCategory(depts: ShopDepartment[] | undefined, id: string) {
  for (const d of depts ?? []) for (const c of d.categories) if (c.id === id || c.slug === id) return { dept: d, cat: c };
  return undefined;
}
