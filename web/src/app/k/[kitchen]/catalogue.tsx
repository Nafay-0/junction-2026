"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { attr, num } from "../../_ui/plain";
import { usePortal, type Lang } from "./portal";
import { CLAIM_LABEL, TEMP, Tile } from "./shop";
import { Button, ErrorPlate } from "./ui";
import { Empty, Skeleton } from "../../_ui/kit";
import { DEPARTMENT_GLYPH, Glyph, TempGlyph } from "../../_ui/glyphs";
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
  const [, setQ] = useState(applied);
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

  const glyph = current ? DEPARTMENT_GLYPH[current.dept.id] : undefined;
  const filtered = applied || category !== (defaultCat ?? "") || claims.length > 0 || free.length > 0;

  return (
    <div className="mt-5 grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <nav aria-label="Departments" className="lg:sticky lg:top-3 lg:max-h-[calc(100dvh-1.5rem)] lg:overflow-y-auto">
        <h2 className="display text-[1.5rem] text-ink">Departments</h2>
        {!depts && <Skeleton className="mt-2 h-64" />}
        <ul className="mt-2 bg-paper">
          {depts?.map((d) => {
            const open = shownDept === d.id;
            const g = DEPARTMENT_GLYPH[d.id];
            return (
              <li key={d.id} className="border-b border-line last:border-b-0">
                <button type="button" aria-expanded={open} onClick={() => setOpenDept(open ? "" : d.id)} className={`flex min-h-11 w-full items-center gap-2.5 px-3 py-1.5 text-left ${open ? "bg-petrol-deep font-semibold text-paper" : "hover:bg-mist"}`}>
                  {g ? <Glyph kind={g} size={22} className={`shrink-0 ${open ? "text-lime" : "text-petrol"}`} strokeWidth={3} /> : <span className="w-[22px]" />}
                  <span className="min-w-0 flex-1 leading-tight">{d.name}</span>
                  <span className={`text-[0.8rem] font-normal tabular ${open ? "text-paper/70" : "text-ink-soft"}`}>{num(d.count, 0)}</span>
                </button>
                {open && (
                  <ul className="space-y-px py-1.5">
                    {d.categories.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          aria-current={c.id === current?.cat.id ? "true" : undefined}
                          onClick={() => set({ c: c.id, q: undefined })}
                          className={`flex min-h-9 w-full items-center justify-between gap-2 py-0.5 pl-10 pr-3 text-left text-[0.92rem] ${c.id === current?.cat.id ? "bg-petrol-soft font-semibold text-petrol-deep shadow-[inset_4px_0_0_var(--color-petrol)]" : "hover:bg-mist"}`}
                        >
                          <span className="flex items-center gap-1.5">
                            {c.temperature && TEMP[c.temperature] && (
                              <span style={{ color: TEMP[c.temperature].color }} title={TEMP[c.temperature].label}>
                                <TempGlyph t={c.temperature} size={11} />
                              </span>
                            )}
                            {c.label}
                          </span>
                          <span className="text-[0.8rem] text-ink-soft tabular">{c.count}</span>
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
        <header className="on-dark relative overflow-hidden bg-petrol-deep px-5 py-6 text-paper sm:px-7 sm:py-8">
          {glyph && !applied && <Glyph kind={glyph} size={220} strokeWidth={1.2} className="pointer-events-none absolute -right-6 -top-6 text-paper/10 sm:right-6" />}
          <p className="relative text-[0.95rem] text-paper/75">{applied ? "Search" : current ? current.dept.name : "Catalogue"}</p>
          <h1 id="shop-title" className="display relative mt-1 text-[2.6rem] text-paper sm:text-[3.4rem]">
            {title}
          </h1>
          <p className="relative mt-2 text-[0.95rem] text-paper/80" aria-live="polite">
            {loading ? "Searching…" : data ? `${data.products.length}${data.products.length === limit ? "+" : ""} products from the product files in ${data.ms} ms. No live call for the list.` : ""}
          </p>
          <div className="relative mt-4 flex flex-wrap items-end justify-between gap-4">
            <p className="flex items-center gap-2" aria-live="polite">
              <span className="display text-[2.4rem] text-lime tabular">{pageCalls}</span>
              <span className="text-[0.9rem] leading-tight text-paper/85">
                live price check{pageCalls === 1 ? "" : "s"} on this page
                <span className="block text-paper/65">
                  for {pageProducts} product{pageProducts === 1 ? "" : "s"} you opened or added, of {total ? num(total, 0) : "all"}
                </span>
              </span>
            </p>
            <div role="group" aria-label="Product names in" className="flex">
              {LANGS.map((l) => (
                <button key={l.id} type="button" aria-pressed={lang === l.id} onClick={() => setLang(l.id)} className={`-ml-[2px] min-h-10 border-2 border-paper/60 px-3 text-[0.92rem] first:ml-0 ${lang === l.id ? "bg-paper font-semibold text-petrol-deep" : "text-paper hover:bg-paper/10"}`}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 bg-paper px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Must be">
            <span className="mr-1 text-[0.9rem] font-semibold">Must be</span>
            {CLAIMS.map((c) => (
              <Chip key={c} on={claims.includes(c)} onClick={() => set({ claim: toggle(claims, c) })}>
                {CLAIM_LABEL[c]}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Leave out allergens">
            <span className="mr-1 text-[0.9rem] font-semibold">Without</span>
            {ALLERGENS.map((a) => (
              <Chip key={a} on={free.includes(a)} onClick={() => set({ free: toggle(free, a) })}>
                {attr(a)}
              </Chip>
            ))}
          </div>
          {filtered && (
            <button
              type="button"
              className="ml-auto min-h-9 font-semibold text-petrol underline decoration-2 underline-offset-4"
              onClick={() => {
                setQ("");
                router.replace(pathname, { scroll: false });
              }}
            >
              Clear
            </button>
          )}
        </div>
        {free.length > 0 && <p className="mt-1 text-[0.85rem] text-ink-soft">Products with no allergen data are left out too: unknown is not safe.</p>}

        {error && <ErrorPlate title="The catalogue did not load" message={`${error} Try again, or search for the product by name.`} />}
        {!loading && data?.products.length === 0 && (
          <div className="mt-3">
            <Empty title="Nothing matches" action={filtered ? <Button kind="secondary" onClick={() => router.replace(pathname, { scroll: false })}>Clear the filters</Button> : undefined}>
              Remove a filter, or search in another language: “maito”, “mjölk”. Or ask the agent: it finds products by what they are for.
            </Empty>
          </div>
        )}
        <ul className={`mt-3 grid gap-3 ${loading ? "opacity-60" : ""}`} style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 13.5rem), 1fr))" }}>
          {data?.products.map((p) => <Tile key={p.id} p={p} />)}
          {!data && loading && Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[22rem]" />)}
        </ul>
        {data && data.products.length === limit && limit < 100 && (
          <Button kind="secondary" className="mt-4" onClick={() => setLimit(100)}>
            Show more
          </Button>
        )}
        {live.error && <ErrorPlate title="The live check failed" message={live.error} />}
      </section>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`min-h-9 border-2 px-2.5 text-[0.9rem] ${on ? "border-petrol bg-petrol font-semibold text-paper" : "border-line bg-paper hover:border-petrol"}`}>
      {on && <span aria-hidden>✓ </span>}
      {children}
    </button>
  );
}

function findCategory(depts: ShopDepartment[] | undefined, id: string) {
  for (const d of depts ?? []) for (const c of d.categories) if (c.id === id || c.slug === id) return { dept: d, cat: c };
  return undefined;
}
