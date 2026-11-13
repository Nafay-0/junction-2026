"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { attr, day, helsinkiToday, money, num } from "../../_ui/plain";
import { Target } from "../../_ui/target";
import { usePortal, type Lang } from "./portal";
import { Quantity } from "./qty";
import { Button, Missing } from "./ui";
import { quantityText, stepOf, unitWord } from "./units";
import type { LiveResult, Product } from "./types";
import { cutoffText } from "./when";

/**
 * The storefront's shared pieces: product tiles (no images in the data, so type, pack and brand carry the tile,
 * with a band in the colour of its storage temperature), the live box and the claim and allergen words.
 */

export const TEMP: Record<string, { label: string; color: string }> = {
  frozen: { label: "Frozen", color: "#2f5f86" },
  chilled: { label: "Chilled", color: "#3f7d6e" },
  ambient: { label: "Ambient", color: "#8a6a3c" },
};

export const CLAIM_LABEL: Record<string, string> = {
  lactose_free: "Lactose-free",
  low_lactose: "Low lactose",
  gluten_free: "Gluten-free",
  vegan: "Vegan",
  vegetarian: "Vegetarian",
  organic: "Organic",
  egg_free: "Egg-free",
  soy_free: "Soy-free",
  milk_free: "Milk-free",
  fat_free: "Fat-free",
  fat_1_5: "1.5 % fat",
  fat_3_5: "3.5 % fat",
};

export const PROBLEM: Record<string, string> = {
  unknown_product: "not in the catalogue",
  no_price: "no price from the wholesaler",
  price_not_valid: "the price is not valid today",
  sales_block: "sales block: cannot be ordered now",
  not_deliverable: "cannot be delivered on any date now",
  out_of_stock: "out of stock",
  stock_unknown: "stock not confirmed",
  later_than_requested: "arrives later than asked",
  cutoff_passed: "the order cut-off for the next delivery has passed",
  unit_mismatch: "sold in another unit than listed",
};

export function nameIn(p: Product, lang: Lang): string {
  return (p.names?.[lang] ?? p.names?.en ?? p.name).replace(/[®™]/g, "").replace(/\s+/g, " ").trim();
}

/** The partner's names are often upper case: show them in sentence case for reading. */
export function readable(name: string): string {
  if (name !== name.toUpperCase()) return name;
  const lower = name.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function labelText(l: string): string {
  const t = l.replaceAll("_", " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function claimsOf(p: Product): string[] {
  return p.attributes.filter((a) => CLAIM_LABEL[a]);
}

const ORIGIN: Record<string, string> = { fi: "Finland", se: "Sweden", ee: "Estonia", dk: "Denmark", de: "Germany", nl: "Netherlands", es: "Spain", it: "Italy", fr: "France", pl: "Poland", no: "Norway", be: "Belgium", il: "Israel", us: "USA", gb: "UK", lt: "Lithuania", lv: "Latvia", at: "Austria", ie: "Ireland", gr: "Greece", pt: "Portugal", cn: "China", th: "Thailand", vn: "Vietnam", in: "India", br: "Brazil", cl: "Chile", za: "South Africa", nz: "New Zealand", ma: "Morocco", tr: "Turkey", ec: "Ecuador", cr: "Costa Rica", co: "Colombia", pe: "Peru" };
export function originText(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  return ORIGIN[code.toLowerCase()] ?? code.toUpperCase();
}

export function Tile({ p }: { p: Product }) {
  const { base, lang, live, basket } = usePortal();
  const t = TEMP[p.temperatureClass ?? ""];
  const r = live.results[p.id];
  const line = basket.lines.find((l) => l.productId === p.id);
  const href = `${base}/catalogue/${encodeURIComponent(p.id)}`;
  return (
    <li className="flex flex-col bg-paper">
      <div aria-hidden className="h-1.5" style={{ background: t?.color ?? "var(--color-ink)" }} />
      <div className="flex flex-1 flex-col p-3.5">
        <p className="flex items-baseline justify-between gap-2 text-[0.8rem] text-ink-soft">
          <span className="truncate">{p.brand !== "unknown" ? p.brand : (p.vendor ?? "")}</span>
          <span className="shrink-0" style={{ color: t?.color }}>
            {t?.label ?? "Storage: no data"}
          </span>
        </p>
        <Link href={href} className="mt-1 line-clamp-3 font-display text-[1.18rem] font-bold leading-[1.15] hover:underline">
          {readable(nameIn(p, lang))}
        </Link>
        <p className="mt-1 text-[0.88rem] text-ink-soft">
          {quantityText(p, 1)}
          {originText(p.countryOfOrigin) ? `, from ${originText(p.countryOfOrigin)}` : ""}
        </p>
        {claimsOf(p).length > 0 && (
          <p className="mt-1.5 flex flex-wrap gap-1">
            {claimsOf(p)
              .slice(0, 4)
              .map((c) => (
                <span key={c} className="border border-ink/40 px-1.5 text-[0.78rem]">
                  {CLAIM_LABEL[c]}
                </span>
              ))}
          </p>
        )}
        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <span className="text-[0.88rem] leading-tight">
            {r?.offer ? (
              <>
                <span className="font-display text-[1.3rem] font-bold tabular">{money(r.offer.unitPriceCents)}</span>
                <span className="text-ink-soft"> / {unitWord(p, 1)}</span>
              </>
            ) : r ? (
              <span className="text-ink-soft">Not orderable now</span>
            ) : (
              <span className="text-ink-soft">Price when opened</span>
            )}
          </span>
          {line ? (
            <Link href={`${base}/basket`} className="min-h-10 border-2 border-ink px-2.5 py-1.5 text-[0.92rem] font-semibold">
              In basket: {line.packs}
            </Link>
          ) : (
            <Button
              kind="primary"
              className="min-h-10 whitespace-nowrap px-3 text-[0.92rem]"
              onClick={() => {
                basket.add(p, stepOf(p));
                void live.check([p.id]);
              }}
            >
              {stepOf(p) > 1 || p.salesUnit === "KG" ? `Add ${stepOf(p)} ${unitWord(p, stepOf(p))}` : `Add a ${unitWord(p, 1)}`}
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

export function LiveBox({ r, busy, p }: { r?: LiveResult & { checkedAt: string }; busy: boolean; p: Product }) {
  if (busy && !r)
    return (
      <p className="flex items-center gap-2 text-ink-soft">
        <Target size={18} tone="hollow" spin /> Asking the wholesaler for today&apos;s price and stock…
      </p>
    );
  if (!r) return null;
  const o = r.offer;
  if (!o)
    return (
      <div className="border-l-[6px] border-ink bg-concrete/60 px-3 py-2">
        <p className="font-semibold">Not orderable right now</p>
        <p className="text-[0.95rem] text-ink-soft">{r.problems.length ? r.problems.map((x) => PROBLEM[x] ?? x).join("; ") : r.message}</p>
        <p className="mt-1 text-[0.82rem] text-ink-soft">Checked live, {day(helsinkiToday(new Date(r.checkedAt)))}</p>
      </div>
    );
  return (
    <div>
      <p className="font-display text-[2.2rem] font-bold leading-none tabular">
        {money(o.unitPriceCents)} <span className="text-[1rem] font-semibold text-ink-soft">per {unitWord(p, 1)}, VAT 0 %</span>
      </p>
      <dl className="mt-2 grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-0.5 text-[0.95rem]">
        {o.comparisonPriceCents !== undefined && o.comparisonUnit && (
          <>
            <dt className="text-ink-soft">Unit price</dt>
            <dd className="tabular">
              {money(o.comparisonPriceCents)} per {o.comparisonUnit.toLowerCase() === "l" ? "litre" : o.comparisonUnit.toLowerCase()}
            </dd>
          </>
        )}
        <dt className="text-ink-soft">Earliest delivery</dt>
        <dd>{day(o.deliveryDate)}</dd>
        <dt className="text-ink-soft">Order by</dt>
        <dd>{o.orderBy ? (cutoffText(o.orderBy) ?? o.orderBy) : "no cut-off stated"}</dd>
        <dt className="text-ink-soft">Stock</dt>
        <dd>{o.stockKnown === false ? "not confirmed by the wholesaler" : `${num(o.availablePacks, 0)} ${unitWord(p, o.availablePacks)}`}</dd>
      </dl>
      <p className="mt-1 text-[0.82rem] text-ink-soft">Checked live with the wholesaler, {day(helsinkiToday(new Date(r.checkedAt)))}</p>
    </div>
  );
}

/** Product facts as a waybill: every field present, "no data" where the data does not say. */
export function Facts({ p, lang }: { p: Product; lang: Lang }) {
  const a = p.allergenInfo;
  return (
    <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1.5 text-[0.98rem]">
      <dt className="text-ink-soft">Product code</dt>
      <dd className="font-mono text-[0.9rem]">{p.id}</dd>
      <dt className="text-ink-soft">Sold per</dt>
      <dd>
        {unitWord(p, 1)}: {quantityText(p, 1).split(" = ")[1] ?? "content: no data"}
        {p.packContent && !p.packContent.certain && <span className="block text-[0.88rem] text-ink-soft">The pack content is not certain in the data.</span>}
      </dd>
      <dt className="text-ink-soft">Brand</dt>
      <dd>{p.brand !== "unknown" ? p.brand : <Missing>No data</Missing>}</dd>
      <dt className="text-ink-soft">Supplier</dt>
      <dd>{p.vendor ?? <Missing>No data</Missing>}</dd>
      <dt className="text-ink-soft">Origin</dt>
      <dd>{originText(p.countryOfOrigin) ?? <Missing>No data</Missing>}</dd>
      <dt className="text-ink-soft">Storage</dt>
      <dd>{TEMP[p.temperatureClass ?? ""]?.label ?? <Missing>No data</Missing>}</dd>
      <dt className="text-ink-soft">Dietary claims</dt>
      <dd>{claimsOf(p).length ? claimsOf(p).map((c) => CLAIM_LABEL[c]).join(", ") : "none stated"}</dd>
      <dt className="text-ink-soft">Labels</dt>
      <dd>{p.certificates.length ? p.certificates.map(labelText).join(", ") : "none stated"}</dd>
      <dt className="text-ink-soft">Allergens</dt>
      <dd>
        {!a || !a.declared ? (
          <>
            <Missing>No data</Missing>
            <span className="block text-[0.88rem] text-ink-soft">The manufacturer sent no allergen data: every allergen is unknown, not absent.</span>
          </>
        ) : (
          <>
            {a.contains.length ? `Contains ${a.contains.map(attr).join(", ")}` : "Contains none of the declared allergens"}
            {a.mayContain.length > 0 && <span className="block">May contain {a.mayContain.map(attr).join(", ")}</span>}
            {a.freeFrom.length > 0 && <span className="block text-ink-soft">Stated free from {a.freeFrom.map(attr).join(", ")}</span>}
          </>
        )}
      </dd>
      <dt className="text-ink-soft">Delivered in full</dt>
      <dd>{p.deliveryReliabilityKnown === false || (p.source === "valio" && p.deliveryReliabilityKnown === undefined) ? <Missing>No data</Missing> : `${Math.round(p.deliveryReliability * 100)} % of past deliveries`}</dd>
      <dt className="text-ink-soft">Carbon</dt>
      <dd>
        {p.carbonGroupAvgKgCo2ePerKg != null ? (
          <>
            {num(p.carbonGroupAvgKgCo2ePerKg, 2)} kg CO2e per kg
            <span className="block text-[0.88rem] text-ink-soft">The average of the product group, not a measurement of this product.</span>
          </>
        ) : p.source === "valio" ? (
          <Missing>No data</Missing>
        ) : (
          `${p.carbonKgPerUnit} kg CO2e per ${p.unit}`
        )}
      </dd>
      {(["fi", "sv", "en"] as const)
        .filter((l) => l !== lang && p.names?.[l])
        .map((l) => (
          <div key={l} className="contents">
            <dt className="text-ink-soft">{l === "fi" ? "Suomeksi" : l === "sv" ? "På svenska" : "In English"}</dt>
            <dd>{p.names![l]}</dd>
          </div>
        ))}
    </dl>
  );
}

/** The buy box on a product page: live price on open, quantity in the sales unit, basket or agent. */
export function BuyBox({ p }: { p: Product }) {
  const { live, basket, agent } = usePortal();
  const [n, setN] = useState(stepOf(p));
  const check = live.check;
  useEffect(() => {
    void check([p.id]);
  }, [p.id, check]);
  const r = live.results[p.id];
  const line = basket.lines.find((l) => l.productId === p.id);
  return (
    <div className="bg-paper">
      <div aria-hidden className="h-[3px] bg-petrol" />
      <div className="space-y-4 p-4">
        <LiveBox r={r} busy={live.busy.includes(p.id)} p={p} />
        {live.error && !r && <p className="text-ink-soft">The live check failed: {live.error}</p>}
        <Quantity p={p} value={n} onChange={setN} id={`qty-${p.id}`} />
        {r?.offer && <p className="font-semibold tabular">{money(r.offer.unitPriceCents * n)} for {quantityText(p, n)}</p>}
        <div className="flex flex-wrap gap-2">
          <Button kind="primary" onClick={() => basket.add(p, n)}>
            Add to basket
          </Button>
          <Button
            kind="secondary"
            onClick={() => {
              agent.setProduct(p);
              agent.setFollowUp(undefined);
              agent.open();
            }}
          >
            Order with the agent
          </Button>
        </div>
        {line && <p className="text-[0.95rem]">In the basket: {quantityText(p, line.packs)}.</p>}
      </div>
    </div>
  );
}
