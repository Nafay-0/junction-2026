"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { num } from "../../_ui/plain";
import { useFormat, useText } from "../../_i18n/provider";
import { usePortal } from "./portal";
import { CATALOGUE_TEXT, departmentName } from "./catalogue.text";
import { SHOP_TEXT } from "./shop.text";
import { TEMP, Tile, TileSkeleton, allergenText } from "./shop";
import { Button, ErrorPlate } from "./ui";
import { ChevronDown, LayoutGrid, SearchX, SlidersHorizontal } from "lucide-react";
import { Chip, Empty, IconDisc, Sheet, Skeleton, buttonClass } from "../../_ui/kit";
import { DEPARTMENT_GLYPH, Glyph, TempGlyph } from "../../_ui/glyphs";
import { Art, departmentArt } from "../../_ui/art";
import type { CatalogReply, ShopDepartment } from "./types";

/**
 * The storefront: departments and categories across the whole assortment, search in English, Finnish or
 * Swedish, dietary and allergen filters, and a product grid. Master data only; live price and stock come
 * when a product is opened or added, and the page counts those calls.
 */

const CLAIMS = ["lactose_free", "low_lactose", "gluten_free", "vegan", "vegetarian", "organic"] as const;
const ALLERGENS = ["milk", "gluten", "eggs", "nuts", "peanuts", "soy", "fish", "sesame", "celery", "mustard"] as const;

export function Catalogue() {
  const { kitchen, ui, lang, live } = usePortal();
  const tx = useText(CATALOGUE_TEXT);
  const sx = useText(SHOP_TEXT);
  const f = useFormat();
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
  const currentId = current?.cat.id;
  useEffect(() => {
    // The phone's row of category chips: bring the chosen one into view.
    const row = chipRow.current;
    const on = row?.querySelector<HTMLElement>("[aria-pressed=true]");
    if (row && on) row.scrollLeft = Math.max(0, on.offsetLeft - row.offsetLeft - 16);
  }, [currentId]);
  const [openDept, setOpenDept] = useState<string>();
  const [sheet, setSheet] = useState<"depts" | "filters">();
  const chipRow = useRef<HTMLUListElement>(null);
  const shownDept = openDept ?? current?.dept.id;
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const pageCalls = live.calls - startCalls;
  const pageProducts = live.products - startProducts;
  const total = data?.source.products;
  const title = applied ? tx.quoted(applied) : current ? current.cat.label : category ? f.attr(category) : tx.allProducts;

  const glyph = current ? DEPARTMENT_GLYPH[current.dept.id] : undefined;
  const art = current && !applied ? departmentArt(current.dept.id) : undefined;
  const filtered = applied || category !== (defaultCat ?? "") || claims.length > 0 || free.length > 0;

  const deptList = (onPick?: () => void) => (
    <DepartmentList
      depts={depts}
      shownDept={shownDept}
      currentCat={current?.cat.id}
      onDept={(id) => setOpenDept(shownDept === id ? "" : id)}
      onCat={(id) => {
        set({ c: id, q: undefined });
        onPick?.();
      }}
    />
  );
  const filterGroups = (
    <>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={tx.mustBe}>
        <span className="mr-1.5 w-full text-[0.86rem] font-medium text-ink-soft lg:w-auto">{tx.mustBe}</span>
        {CLAIMS.map((c) => (
          <Chip key={c} on={claims.includes(c)} onClick={() => set({ claim: toggle(claims, c) })}>
            {sx.claim[c]}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={tx.leaveOut}>
        <span className="mr-1.5 w-full text-[0.86rem] font-medium text-ink-soft lg:w-auto">{tx.without}</span>
        {ALLERGENS.map((a) => (
          <Chip key={a} on={free.includes(a)} onClick={() => set({ free: toggle(free, a) })}>
            {allergenText(a, lang)}
          </Chip>
        ))}
      </div>
    </>
  );
  const nFilters = claims.length + free.length;
  const clear = () => {
    setQ("");
    router.replace(pathname, { scroll: false });
  };

  return (
    <div className="mt-4 grid gap-x-8 gap-y-6 sm:mt-5 lg:mt-6 lg:grid-cols-[16.5rem_minmax(0,1fr)]">
      <section aria-labelledby="shop-title" className="min-w-0 lg:col-start-2">
        <header className={`on-dark relative overflow-hidden rounded-2xl bg-petrol-deep text-paper ${art ? "sm:min-h-[14.5rem]" : ""}`}>
          {art ? (
            <>
              {/* The department's picture: a band on phones, the right half on wider screens (its left side is quiet
                  petrol, so the type sits on it). Generated illustration, see DESIGN.md §6. */}
              <div className="relative h-28 sm:hidden">
                <Art k={art} cover sizes="100vw" priority position="70% 50%" />
                <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-petrol-deep to-transparent to-60%" />
              </div>
              <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[52%] sm:block">
                <Art k={art} cover sizes="(min-width: 1280px) 32rem, 50vw" priority position="78% 50%" />
                <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-petrol-deep via-petrol-deep/20 via-25% to-transparent" />
              </div>
            </>
          ) : (
            glyph && !applied && <Glyph kind={glyph} size={200} strokeWidth={1.2} className="pointer-events-none absolute -right-6 -top-6 text-paper/10 sm:right-6" />
          )}
          <div className={`relative px-5 pb-5 sm:px-8 sm:py-7 ${art ? "-mt-3 sm:mt-0 sm:max-w-[52%]" : "pt-5"}`}>
            <p className="text-[0.9rem] text-paper/70">{applied ? tx.search : current ? departmentName(current.dept, lang) : tx.catalogue}</p>
            <h1 id="shop-title" className="display mt-0.5 break-words text-[1.95rem] leading-[1.05] text-paper hyphens-manual sm:mt-1 sm:text-[2.7rem]">
              {title}
            </h1>
            <p className="mt-1.5 max-w-[44ch] text-[0.9rem] leading-snug text-paper/85 sm:mt-2" aria-live="polite">
              {loading ? tx.searching : data ? tx.count(data.products.length, data.products.length === limit) : ""}
            </p>
            {/* For the curious, folded: where the list came from and how often the wholesaler's live service was asked. */}
            <details className="group mt-3 max-w-full text-[0.8rem] text-paper/75 sm:text-[0.84rem]">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full py-1 underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
                <ChevronDown aria-hidden size={14} className="transition-transform group-open:rotate-180" />
                {tx.howMade}
              </summary>
              <p className="mt-1.5 leading-snug" aria-live="polite">{data ? tx.found(data.products.length, data.products.length === limit, data.ms) : ""}</p>
              <p className="mt-2 inline-flex max-w-full items-center gap-3 rounded-2xl bg-paper/8 py-1.5 pl-1.5 pr-4 ring-1 ring-inset ring-paper/15">
                <span key={pageCalls} className="display flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full bg-lime px-2 text-[1rem] text-ink tabular">
                  {pageCalls}
                </span>
                <span className="min-w-0 leading-tight text-paper/90">
                  {tx.pageChecks(pageCalls)}
                  <span className="block text-paper/65">{tx.pageProducts(pageProducts, total ? num(total, 0) : undefined)}</span>
                </span>
              </p>
            </details>
          </div>
        </header>

        {/* A phone: the department and the filters as two buttons that open sheets, the categories as a row of chips. */}
        <div className="mt-4 lg:hidden">
          <div className="flex gap-2">
            <button type="button" onClick={() => setSheet("depts")} aria-haspopup="dialog" className={buttonClass("secondary", "md", "min-w-0 flex-1 justify-start !px-4")}>
              <LayoutGrid aria-hidden size={18} className="shrink-0 text-petrol" />
              <span className="truncate">{current ? departmentName(current.dept, lang) : tx.departments}</span>
              <ChevronDown aria-hidden size={17} className="ml-auto shrink-0 text-ink-soft" />
            </button>
            <button type="button" onClick={() => setSheet("filters")} aria-haspopup="dialog" className={buttonClass(nFilters ? "primary" : "secondary", "md", "shrink-0 !px-4")}>
              <SlidersHorizontal aria-hidden size={18} />
              {tx.filters}
              {nFilters > 0 && <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-paper px-1.5 text-[0.8rem] text-petrol-deep tabular">{nFilters}</span>}
            </button>
          </div>
          {current && (
            <ul ref={chipRow} aria-label={tx.categoriesIn(departmentName(current.dept, lang))} className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6">
              {current.dept.categories.map((c) => (
                <li key={c.id}>
                  <Chip on={c.id === current.cat.id} onClick={() => set({ c: c.id, q: undefined })} count={c.count}>
                    {c.label}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* A desk: the filters in the open, two rows of chips on the page's ground. */}
        <div className="mt-5 hidden flex-wrap items-start gap-x-6 gap-y-2.5 lg:flex">
          {filterGroups}
          {filtered && (
            <Button kind="quiet" className="ml-auto" onClick={clear}>
              {tx.clear}
            </Button>
          )}
        </div>
        {free.length > 0 && <p className="mt-2 text-[0.85rem] text-ink-soft">{tx.allergenNote}</p>}

        {error && <ErrorPlate title={tx.loadFailed} message={tx.loadFailedMessage(error)} />}
        {!loading && data?.products.length === 0 && (
          <div className="mt-4">
            <Empty
              title={tx.nothing}
              glyph={
                <IconDisc tone="muted">
                  <SearchX size={20} />
                </IconDisc>
              }
              action={filtered ? <Button kind="secondary" onClick={clear}>{tx.clearFilters}</Button> : undefined}
            >
              {tx.nothingHelp}
            </Empty>
          </div>
        )}
        <ul className={`mt-4 grid grid-cols-2 gap-3 transition-opacity duration-150 sm:gap-4 md:grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] lg:mt-5 ${loading && data ? "opacity-60" : ""}`}>
          {data?.products.map((p) => <Tile key={p.id} p={p} />)}
          {!data && loading && Array.from({ length: 8 }, (_, i) => <TileSkeleton key={i} />)}
        </ul>
        {data && data.products.length === limit && limit < 100 && (
          <div className="mt-6 flex justify-center">
            <Button kind="secondary" onClick={() => setLimit(100)}>
              {tx.showMore}
            </Button>
          </div>
        )}
        {live.error && <ErrorPlate title={tx.liveFailed} message={live.error} />}
      </section>

      {/* After the products in the page's order (a phone reads the products first), beside them on a desk. */}
      <nav aria-label={tx.departments} className="hidden lg:sticky lg:top-[8.75rem] lg:col-start-1 lg:row-start-1 lg:block lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto lg:overscroll-contain lg:pb-4">
        <h2 className="display px-1 text-[1.35rem] text-ink">{tx.departments}</h2>
        {deptList()}
        {depts && depts.length > 1 && <p className="mt-3 px-1 text-[0.78rem] leading-snug text-ink-soft">{tx.categoryNote}</p>}
      </nav>

      <Sheet open={sheet === "depts"} onClose={() => setSheet(undefined)} title={tx.departments}>
        <nav aria-label={tx.departments}>{deptList(() => setSheet(undefined))}</nav>
        {depts && depts.length > 1 && <p className="mt-3 text-[0.78rem] leading-snug text-ink-soft">{tx.categoryNote}</p>}
      </Sheet>
      <Sheet
        open={sheet === "filters"}
        onClose={() => setSheet(undefined)}
        title={tx.filtersTitle}
        footer={
          <>
            {filtered && (
              <Button kind="quiet" className="mr-auto" onClick={clear}>
                {tx.clear}
              </Button>
            )}
            <Button kind="go" onClick={() => setSheet(undefined)}>
              {tx.showResults}
            </Button>
          </>
        }
      >
        <div className="space-y-5">{filterGroups}</div>
        {free.length > 0 && <p className="mt-4 text-[0.85rem] text-ink-soft">{tx.allergenNote}</p>}
      </Sheet>
    </div>
  );
}

/**
 * The departments as one card of rows; the open one shows its categories, the current category in petrol. Shared by
 * the desk's side column and the phone's sheet.
 */
function DepartmentList({ depts, shownDept, currentCat, onDept, onCat }: { depts?: ShopDepartment[]; shownDept?: string; currentCat?: string; onDept: (id: string) => void; onCat: (id: string) => void }) {
  const { lang } = usePortal();
  const sx = useText(SHOP_TEXT);
  if (!depts)
    return (
      <div className="mt-3 space-y-2">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  return (
    <ul className="mt-3 overflow-hidden rounded-xl border border-line bg-paper">
      {depts.map((d) => {
        const open = shownDept === d.id;
        const g = DEPARTMENT_GLYPH[d.id];
        return (
          <li key={d.id} className="border-b border-line last:border-b-0">
            <button type="button" aria-expanded={open} onClick={() => onDept(d.id)} className={`flex min-h-12 w-full items-center gap-2.5 rounded-none px-3.5 py-2 text-left transition-colors duration-150 ${open ? "bg-petrol-soft/60 font-semibold text-petrol-deep" : "hover:bg-mist"}`}>
              {g ? <Glyph kind={g} size={20} className="shrink-0 text-petrol" strokeWidth={2.6} /> : <span className="w-5" />}
              <span className="min-w-0 flex-1 text-[0.95rem] leading-tight hyphens-auto">{departmentName(d, lang)}</span>
              <span className="text-[0.78rem] font-normal text-ink-soft tabular">{num(d.count, 0)}</span>
              <ChevronDown aria-hidden size={15} className={`-mr-1 shrink-0 text-ink-faint transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
              <ul className="space-y-0.5 px-2 pb-2 pt-1">
                {d.categories.map((c) => {
                  const on = c.id === currentCat;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        aria-current={on ? "true" : undefined}
                        onClick={() => onCat(c.id)}
                        className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-md py-1 pl-9 pr-2.5 text-left text-[0.92rem] transition-colors duration-150 pointer-coarse:min-h-11 ${on ? "bg-petrol font-semibold text-paper" : "hover:bg-mist"}`}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          {c.temperature && TEMP[c.temperature] && (
                            <span style={{ color: on ? undefined : TEMP[c.temperature].color }} title={sx.temp[c.temperature]} className="shrink-0">
                              <TempGlyph t={c.temperature} size={11} />
                            </span>
                          )}
                          <span className="truncate">{c.label}</span>
                        </span>
                        <span className={`text-[0.78rem] tabular ${on ? "text-paper/80" : "text-ink-soft"}`}>{c.count}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function findCategory(depts: ShopDepartment[] | undefined, id: string) {
  for (const d of depts ?? []) for (const c of d.categories) if (c.id === id || c.slug === id) return { dept: d, cat: c };
  return undefined;
}
