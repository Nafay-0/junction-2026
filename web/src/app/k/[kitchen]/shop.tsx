"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { api } from "../../_client/api";
import { Glyph, TempGlyph, type GlyphKind } from "../../_ui/glyphs";
import { Spinner, Tag, Working } from "../../_ui/kit";
import { attr, clock, day, helsinkiToday, money, num } from "../../_ui/plain";
import { usePortal, type Lang } from "./portal";
import { Quantity } from "./qty";
import { Button, Missing } from "./ui";
import { contentOf, quantityText, stepOf, unitWord } from "./units";
import type { LiveResult, Product } from "./types";
import { cutoffMs, cutoffText, untilText } from "./when";

/**
 * The storefront's shared pieces: product tiles (no images in the data, so type, pack and brand carry the tile,
 * with a band in the colour of its storage temperature), the live box and the claim and allergen words.
 */

export const TEMP: Record<string, { label: string; color: string; tint: string }> = {
  frozen: { label: "Frozen", color: "var(--color-frozen)", tint: "#e8ecf7" },
  chilled: { label: "Chilled", color: "var(--color-chilled)", tint: "#e2f1f3" },
  ambient: { label: "Ambient", color: "var(--color-ambient)", tint: "#f5efe4" },
};

/** The temperature as a quiet code: glyph and word in the class colour. */
export function TempMark({ t, className = "" }: { t?: string | null; className?: string }) {
  const x = TEMP[t ?? ""];
  if (!x) return <span className={`text-ink-soft ${className}`}>Storage: no data</span>;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${className}`} style={{ color: x.color }}>
      <TempGlyph t={t ?? ""} size={13} />
      {x.label}
    </span>
  );
}

/** Which drawn pack a product comes in, from its sales unit and content. */
export function packGlyph(p: Product): GlyphKind {
  const u = p.salesUnit ?? "";
  const m = contentOf(p, 1);
  if (u === "BOT") return "bottle";
  if (u === "KAN") return "canister";
  if (u === "PRK") return "tub";
  if (u === "SK") return "sack";
  if (u === "BAG" || u === "PAK") return "bag";
  if (u === "KRT") return "carton";
  if (m?.unit === "L") return m.amount >= 10 && u !== "KI" && u !== "CS" ? "bib" : u === "KI" || u === "CS" || u === "RAS" ? "case" : "carton";
  if (u === "KG" || m?.unit === "kg") return u === "KI" || u === "CS" ? "case" : "block";
  if (u === "KI" || u === "CS" || u === "RAS") return "case";
  return "can";
}

/** The pack is the picture: the drawn pack, and what one sales unit holds, set large. */
export function PackPlate({ p, size = "md" }: { p: Product; size?: "md" | "lg" }) {
  const t = TEMP[p.temperatureClass ?? ""];
  const m = contentOf(p, 1);
  const big = m ? (m.unit === "pcs" ? `${num(m.amount)} pcs` : `${num(m.amount)} ${m.unit}`) : unitWord(p, 1);
  const lg = size === "lg";
  return (
    <div className={`flex items-center gap-3 ${lg ? "px-6 py-8" : "px-3 py-3"}`} style={{ background: t?.tint ?? "var(--color-mist)" }}>
      <Glyph kind={packGlyph(p)} size={lg ? 96 : 44} className="shrink-0 text-petrol-deep" strokeWidth={lg ? 2 : 2.5} />
      <div className="min-w-0">
        <p className={`display text-petrol-deep tabular ${lg ? "text-[4.2rem]" : "text-[2rem]"}`}>{big}</p>
        <p className={`text-ink-soft ${lg ? "mt-1 text-[1.05rem]" : "text-[0.82rem]"}`}>
          per {unitWord(p, 1)}
          {m && !m.certain ? ", about" : ""}
        </p>
      </div>
    </div>
  );
}

// ---------- the knowledge map: each product's kind and uses, fetched in batches for a grid ----------

type Profile = { kind: string; uses: { id: string; text: string }[] };
const profiles = new Map<string, Profile | null>();
const queued = new Set<string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let version = 0;

function flush() {
  timer = undefined;
  const ids = [...queued].slice(0, 100);
  ids.forEach((id) => queued.delete(id));
  if (!ids.length) return;
  void api<{ profiles: Record<string, Profile> }>("GET", `/ui-api/knowledge/profiles?ids=${ids.map(encodeURIComponent).join(",")}`).then((r) => {
    for (const id of ids) profiles.set(id, r.ok ? (r.data.profiles[id] ?? null) : null);
    version += 1;
    listeners.forEach((l) => l());
    if (queued.size) timer = setTimeout(flush, 30);
  });
}

export function useProfile(id: string): Profile | null | undefined {
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => 0,
  );
  void v;
  useEffect(() => {
    if (profiles.has(id) || queued.has(id)) return;
    queued.add(id);
    timer ??= setTimeout(flush, 30);
  }, [id]);
  return profiles.get(id);
}

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
  const r = live.results[p.id];
  const line = basket.lines.find((l) => l.productId === p.id);
  const href = `${base}/catalogue/${encodeURIComponent(p.id)}`;
  const prof = useProfile(p.id);
  const origin = originText(p.countryOfOrigin);
  return (
    <li className="group relative flex flex-col bg-paper outline-petrol hover:outline-2">
      <p className="flex items-baseline justify-between gap-2 px-3 pt-2.5 text-[0.8rem]">
        <TempMark t={p.temperatureClass} />
        <span className="truncate text-ink-soft">{p.brand !== "unknown" ? p.brand : (p.vendor ?? "")}</span>
      </p>
      <div className="mx-3 mt-2">
        <PackPlate p={p} />
      </div>
      <div className="flex flex-1 flex-col px-3 pb-3 pt-2.5">
        <Link href={href} className="line-clamp-3 text-[1.08rem] font-semibold leading-[1.2] text-ink after:absolute after:inset-0 hover:text-petrol">
          {readable(nameIn(p, lang))}
        </Link>
        <p className="mt-1 text-[0.86rem] leading-snug text-ink-soft">
          {prof?.kind ? <span className="font-semibold text-ink">{prof.kind}</span> : null}
          {prof?.uses.length ? <>{prof.kind ? ", for " : "For "}{prof.uses.slice(0, 3).map((u) => u.text).join(", ")}</> : null}
          {prof === undefined && <span className="inline-block h-3 w-28 animate-pulse bg-mist align-middle" />}
        </p>
        <p className="mt-1 text-[0.86rem] text-ink-soft">
          {quantityText(p, 1)}
          {origin ? `, ${origin}` : ""}
        </p>
        {claimsOf(p).length > 0 && (
          <p className="mt-2 flex flex-wrap gap-1">
            {claimsOf(p)
              .slice(0, 4)
              .map((c) => (
                <Tag key={c}>{CLAIM_LABEL[c]}</Tag>
              ))}
          </p>
        )}
        <div className="relative z-10 mt-auto flex items-end justify-between gap-2 border-t border-line pt-2.5">
          <span className="text-[0.88rem] leading-tight">
            {r?.offer ? (
              <>
                <span className="display text-[1.45rem] tabular">{money(r.offer.unitPriceCents)}</span>
                <span className="block text-ink-soft">per {unitWord(p, 1)}</span>
              </>
            ) : r ? (
              <span className="text-ink-soft">Not orderable now</span>
            ) : live.busy.includes(p.id) ? (
              <span className="flex items-center gap-1.5 text-ink-soft">
                <Spinner size={12} /> Asking
              </span>
            ) : (
              <span className="text-ink-soft">Price when opened</span>
            )}
          </span>
          {line ? (
            <Link href={`${base}/basket`} className="flex min-h-10 items-center gap-1.5 bg-petrol-soft px-2.5 text-[0.92rem] font-semibold text-petrol-deep">
              <span aria-hidden>✓</span> {line.packs} in basket
            </Link>
          ) : (
            <Button
              kind="primary"
              size="sm"
              className="min-h-10 whitespace-nowrap"
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
  const [now] = useState(() => Date.now());
  if (busy && !r) return <Working>Asking the wholesaler for today&apos;s price, stock and cut-off…</Working>;
  if (!r) return null;
  const o = r.offer;
  if (!o)
    return (
      <div className="border-l-[6px] border-ink bg-mist px-3 py-2">
        <p className="font-semibold">Not orderable right now</p>
        <p className="text-[0.95rem] text-ink-soft">{r.problems.length ? r.problems.map((x) => PROBLEM[x] ?? x).join("; ") : r.message}</p>
        <p className="mt-1 text-[0.82rem] text-ink-soft">Checked live, {day(helsinkiToday(new Date(r.checkedAt)))} {clock(r.checkedAt)}</p>
      </div>
    );
  const cut = cutoffMs(o.orderBy);
  return (
    <div>
      <p className="display text-[3rem] text-ink tabular">{money(o.unitPriceCents)}</p>
      <p className="text-[0.95rem] text-ink-soft">
        per {unitWord(p, 1)}, VAT 0 %
        {o.comparisonPriceCents !== undefined && o.comparisonUnit && (
          <>
            {"; "}
            <span className="tabular">{money(o.comparisonPriceCents)}</span> per {o.comparisonUnit.toLowerCase() === "l" ? "litre" : o.comparisonUnit.toLowerCase()}
          </>
        )}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-px bg-line">
        <div className="bg-paper py-2 pr-2">
          <dt className="text-[0.8rem] text-ink-soft">Order by</dt>
          <dd className="font-semibold leading-snug">
            {o.orderBy ? (cutoffText(o.orderBy) ?? o.orderBy) : "No cut-off stated"}
            {cut !== undefined && <span className={`block text-[0.88rem] ${cut - now < 6 * 3_600_000 ? "font-bold text-ink" : "font-medium text-ink-soft"}`}>{untilText(cut, now)}</span>}
          </dd>
        </div>
        <div className="bg-paper py-2 pl-3">
          <dt className="text-[0.8rem] text-ink-soft">Earliest delivery</dt>
          <dd className="font-semibold">{day(o.deliveryDate)}</dd>
        </div>
        <div className="col-span-2 bg-paper py-2">
          <dt className="text-[0.8rem] text-ink-soft">Stock</dt>
          <dd className="font-semibold">{o.stockKnown === false ? "Not confirmed by the wholesaler" : `${num(o.availablePacks, 0)} ${unitWord(p, o.availablePacks)}`}</dd>
        </div>
      </dl>
      <p className="mt-2 text-[0.82rem] text-ink-soft">Checked live with the wholesaler at {clock(r.checkedAt)}.</p>
    </div>
  );
}

/** Product facts as a waybill: every field present, "no data" where the data does not say. */
export function Facts({ p, lang }: { p: Product; lang: Lang }) {
  const a = p.allergenInfo;
  return (
    <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1.5 text-[0.98rem]">
      <dt className="text-ink-soft">Product code</dt>
      <dd className="tabular">{p.id}</dd>
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

/** The buy box on a product page: live price on open, quantity in the sales unit with what it means, basket or agent. */
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
      <div aria-hidden className="h-1.5 bg-petrol" />
      <div className="space-y-5 p-5">
        <LiveBox r={r} busy={live.busy.includes(p.id)} p={p} />
        {live.error && !r && <p className="text-ink-soft">The live check failed: {live.error}</p>}
        <div className="border-t border-line pt-4">
          <Quantity p={p} value={n} onChange={setN} id={`qty-${p.id}`} />
          {r?.offer && (
            <p key={n} className="changed mt-2 inline-block px-1 text-[1.1rem] font-semibold tabular">
              {money(r.offer.unitPriceCents * n)} for {quantityText(p, n)}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button kind="go" size="lg" onClick={() => basket.add(p, n)}>
            {line ? "Add more to the basket" : "Add to basket"}
          </Button>
          <button
            type="button"
            className="flex min-h-11 items-center justify-center gap-2 bg-lavender px-4 font-semibold text-lavender-deep hover:bg-[#e3daf0]"
            onClick={() => {
              agent.setProduct(p);
              agent.setFollowUp(undefined);
              agent.open();
            }}
          >
            Order with the agent
          </button>
        </div>
        {line && (
          <p className="flex items-center gap-2 bg-petrol-soft px-3 py-2 text-[0.95rem] text-petrol-deep">
            <span aria-hidden>✓</span> In the basket: {quantityText(p, line.packs)}.
          </p>
        )}
        <p className="border-t border-line pt-3 text-[0.85rem] leading-snug text-ink-soft">
          <span className="font-semibold text-ink tabular">{live.calls}</span> live call{live.calls === 1 ? "" : "s"} to the wholesaler on this visit, for <span className="tabular">{live.products}</span> product{live.products === 1 ? "" : "s"} you opened or added. Everything else on this page is master data.
        </p>
      </div>
    </div>
  );
}
