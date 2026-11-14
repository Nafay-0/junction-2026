"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { api } from "../../_client/api";
import { Glyph, TempGlyph, type GlyphKind } from "../../_ui/glyphs";
import { Art, artFor } from "../../_ui/art";
import { ART_TEXT } from "../../_ui/art.text";
import { Check, Plus, Sparkles } from "lucide-react";
import { Button as KitButton, FactList, Panel, Spinner, Tag } from "../../_ui/kit";
import { attr, clock, helsinkiToday, money, num } from "../../_ui/plain";
import { useFormat, useLang, useText } from "../../_i18n/provider";
import { attrL } from "../../_i18n/format";
import { usePortal, type Lang } from "./portal";
import { Quantity } from "./qty";
import { SHOP_TEXT } from "./shop.text";
import { Missing } from "./ui";
import { contentOf, quantityText, stepOf, unitWord } from "./units";
import type { LiveResult, Product } from "./types";
import { cutoffMs, cutoffText, untilText } from "./when";
import { NUTRIENTS, NUTRIENT_UNIT } from "@/core/nutrition";
import { ownPrice, packDeposit, vatRateOf } from "@/core/pricing";

/** A figure in the buyer's language (decimal comma in Finnish and Swedish). */
/** Numbers keep the Finnish conventions in every language ("13,5", "0,8"), as the rest of the store writes them. */
const numIn = (v: number, _lang: Lang, digits = 2) => new Intl.NumberFormat("fi-FI", { maximumFractionDigits: digits }).format(v);

/**
 * The storefront's shared pieces: product tiles (no images in the data, so type, pack and brand carry the tile,
 * with a band in the colour of its storage temperature), the live box and the claim and allergen words.
 */

/** Colours per storage temperature; `label` is the English word (the screens use `tempLabel` for the buyer's language). */
export const TEMP: Record<string, { label: string; color: string; tint: string }> = {
  frozen: { label: "Frozen", color: "var(--color-frozen)", tint: "#e8ecf7" },
  chilled: { label: "Chilled", color: "var(--color-chilled)", tint: "#e2f1f3" },
  ambient: { label: "Ambient", color: "var(--color-ambient)", tint: "#f5efe4" },
};

/** "Chilled", "Kylmä", "Kyld"; undefined for an unknown class. */
export function tempLabel(t: string | null | undefined, lang: Lang = "en"): string | undefined {
  return TEMP[t ?? ""] ? SHOP_TEXT[lang].temp[t ?? ""] : undefined;
}

/** The temperature as a quiet code: glyph and word in the class colour. `chip` sets it on a paper pill (over a picture). */
export function TempMark({ t, className = "", chip = false }: { t?: string | null; className?: string; chip?: boolean }) {
  const tx = useText(SHOP_TEXT);
  const x = TEMP[t ?? ""];
  if (!x) return chip ? null : <span className={`text-ink-soft ${className}`}>{tx.storageNoData}</span>;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${chip ? "rounded-full bg-paper/92 px-2 py-0.5 text-[0.72rem] leading-5 shadow-xs backdrop-blur-sm" : ""} ${className}`} style={{ color: x.color }}>
      <TempGlyph t={t ?? ""} size={chip ? 11 : 13} />
      {tx.temp[t ?? ""]}
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

/**
 * The pack is the picture: a generated illustration of the kind of product (never this product: it says so), or the
 * drawn pack where there is none, with what one sales unit holds set in type on a paper badge, readable before the name.
 * `tile` fills its parent's box; `lg` is the product page's picture.
 */
export function PackPlate({ p, size = "md", temp = false }: { p: Product; size?: "md" | "lg"; temp?: boolean }) {
  const tx = useText(SHOP_TEXT);
  const ax = useText(ART_TEXT);
  const { lang } = useLang();
  const m = contentOf(p, 1);
  const big = m ? (m.unit === "pcs" ? tx.pcs(num(m.amount)) : `${num(m.amount)} ${m.unit}`) : unitWord(p, 1, lang);
  const per = `${tx.per(unitWord(p, 1, lang))}${m && !m.certain ? tx.about : ""}`;
  const lg = size === "lg";
  const key = artFor(p);
  const drawn = <DrawnPlate p={p} lg={lg} />;
  return (
    <div className={`relative overflow-hidden ${lg ? "aspect-[4/3] rounded-2xl" : "aspect-[1/1] sm:aspect-[5/4]"}`}>
      {key ? <Art k={key} cover sizes={lg ? "(min-width: 1024px) 40rem, 92vw" : "(min-width: 1280px) 15rem, (min-width: 640px) 30vw, 46vw"} position="50% 58%" fallback={drawn} /> : drawn}
      {temp && (
        <span className="absolute left-2 top-2">
          <TempMark t={p.temperatureClass} chip />
        </span>
      )}
      {key && (
        <span title={ax.illustrationLong} className={`absolute right-2 top-2 rounded-full bg-petrol-deep/70 text-paper/95 backdrop-blur-sm ${lg ? "right-3 top-3 px-2.5 py-0.5 text-[0.8rem]" : "px-2 text-[0.68rem] leading-5"}`}>
          {ax.illustration}
          <span className="sr-only">: {ax.illustrationLong}</span>
        </span>
      )}
      <p className={`absolute rounded-md bg-paper shadow-xs ${lg ? "bottom-4 left-4 rounded-lg px-4 py-2.5" : "bottom-2 left-2 px-2 pb-1 pt-0.5"}`}>
        <span className={`display block leading-[1.05] text-petrol-deep tabular ${lg ? "text-[2.6rem] sm:text-[3rem]" : "text-[1.3rem] sm:text-[1.45rem]"}`}>{big}</span>
        <span className={`block leading-tight text-ink-soft ${lg ? "text-[0.95rem]" : "text-[0.72rem]"}`}>{per}</span>
      </p>
    </div>
  );
}

/** The drawn pack: the fallback when there is no picture for the kind of product, or it fails to load. */
function DrawnPlate({ p, lg }: { p: Product; lg: boolean }) {
  const t = TEMP[p.temperatureClass ?? ""];
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ background: t?.tint ?? "var(--color-surface)" }}>
      <Glyph kind={packGlyph(p)} size={lg ? 120 : 64} className={`text-petrol-deep/70 ${lg ? "" : "-translate-y-2"}`} strokeWidth={lg ? 1.6 : 2} />
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

/** Dietary claim words in English (the words in every language are `CLAIM_LABELS[lang]`). */
export const CLAIM_LABEL: Record<string, string> = SHOP_TEXT.en.claim;
export const CLAIM_LABELS: Record<Lang, Record<string, string>> = { en: SHOP_TEXT.en.claim, fi: SHOP_TEXT.fi.claim, sv: SHOP_TEXT.sv.claim };

/** Why a product cannot be ordered, by the live check's problem code, in English (`PROBLEMS[lang]` for the others). */
export const PROBLEM: Record<string, string> = SHOP_TEXT.en.problem;
export const PROBLEMS: Record<Lang, Record<string, string>> = { en: SHOP_TEXT.en.problem, fi: SHOP_TEXT.fi.problem, sv: SHOP_TEXT.sv.problem };

/** The live check's problem codes as words; a code it does not know is shown as it came. */
export function problemsText(codes: string[], lang: Lang = "en"): string {
  return codes.map((x) => PROBLEMS[lang][x] ?? x).join("; ");
}

/** An allergen word ("milk", "maito", "mjölk"); English keeps the shared word list. */
export function allergenText(a: string, lang: Lang = "en"): string {
  return lang === "en" ? attr(a) : (SHOP_TEXT[lang].allergen[a] ?? attrL(a, lang));
}

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

export function originText(code: string | null | undefined, lang: Lang = "en"): string | undefined {
  if (!code) return undefined;
  return SHOP_TEXT[lang].origin[code.toLowerCase()] ?? code.toUpperCase();
}

/**
 * A product in the grid, the way a good shop shows one: the picture with the pack's content on it, then brand, name,
 * what it is for, the pack and origin, claims; at the foot the price (asked of the wholesaler only when the buyer
 * opens or adds the product) and the add button. A narrow tile (two to a phone row) shows the add button as a round
 * plus, still named in full for screen readers.
 */
export function Tile({ p }: { p: Product }) {
  const { base, lang, live, basket } = usePortal();
  const tx = useText(SHOP_TEXT);
  const r = live.results[p.id];
  const line = basket.lines.find((l) => l.productId === p.id);
  const href = `${base}/catalogue/${encodeURIComponent(p.id)}`;
  const prof = useProfile(p.id);
  const origin = originText(p.countryOfOrigin, lang);
  const claims = claimsOf(p);
  const brand = p.brand !== "unknown" ? p.brand : (p.vendor ?? "");
  const addLabel = stepOf(p) > 1 || p.salesUnit === "KG" ? tx.addN(stepOf(p), unitWord(p, stepOf(p), lang)) : tx.addOne(unitWord(p, 1, lang));
  return (
    <li className="lift group @container relative flex flex-col overflow-hidden rounded-xl border border-line bg-paper">
      <PackPlate p={p} temp />
      <div className="flex flex-1 flex-col p-3 sm:p-4">
        {brand && <p className="truncate text-[0.76rem] text-ink-soft">{brand}</p>}
        <Link href={href} className="mt-0.5 line-clamp-3 text-[0.95rem] font-semibold leading-[1.25] text-ink after:absolute after:inset-0 after:rounded-xl hover:text-petrol sm:text-[1rem]">
          {readable(nameIn(p, lang))}
        </Link>
        <p className="mt-1 line-clamp-2 text-[0.8rem] leading-snug text-ink-soft">
          {prof?.kind ? <span className="font-medium text-ink">{prof.kind}</span> : null}
          {prof?.uses.length ? <>{tx.forUses(!!prof.kind)}{prof.uses.slice(0, 3).map((u) => u.text).join(", ")}</> : null}
          {prof === undefined && <span className="skeleton inline-block h-3 w-24 align-middle" />}
        </p>
        <p className="mt-1 text-[0.8rem] leading-snug text-ink-soft">
          {quantityText(p, 1, lang)}
          {origin ? `, ${origin}` : ""}
        </p>
        {claims.length > 0 && (
          <p className="mt-2 flex flex-wrap gap-1">
            {claims.slice(0, 3).map((c, i) => (
              <span key={c} className={i < 2 ? "contents" : "hidden @[15rem]:contents"}>
                <Tag>{tx.claim[c]}</Tag>
              </span>
            ))}
          </p>
        )}
        <div className="relative z-10 mt-auto flex items-end justify-between gap-2 pt-3">
          <span className="min-w-0 text-[0.8rem] leading-tight">
            {r?.offer ? (
              <>
                <span className="display block text-[1.3rem] text-ink tabular">{money(r.offer.unitPriceCents)}</span>
                <span className="block text-ink-soft">{tx.per(unitWord(p, 1, lang))}</span>
              </>
            ) : r ? (
              <span className="text-ink-soft">{tx.notOrderableNow}</span>
            ) : live.busy.includes(p.id) ? (
              <span className="flex items-center gap-1.5 text-ink-soft">
                <Spinner size={12} /> {tx.asking}
              </span>
            ) : (
              <span className="text-ink-soft">{tx.priceWhenOpened}</span>
            )}
          </span>
          {line ? (
            <Link href={`${base}/basket`} className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full bg-petrol-soft px-3 text-[0.85rem] font-semibold text-petrol-deep transition-colors hover:bg-petrol/15 pointer-coarse:min-h-11">
              <Check aria-hidden size={15} strokeWidth={2.6} /> {tx.inBasket(line.packs)}
            </Link>
          ) : (
            <button
              type="button"
              aria-label={addLabel}
              title={addLabel}
              onClick={() => {
                basket.add(p, stepOf(p));
                void live.check([p.id]);
              }}
              className="inline-flex size-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-petrol text-[0.88rem] font-semibold text-paper shadow-xs transition-[background-color,transform] duration-150 hover:bg-petrol-deep active:scale-95 motion-reduce:active:scale-100 @[15rem]:h-10 @[15rem]:w-auto @[15rem]:px-3.5 pointer-coarse:@[15rem]:h-11"
            >
              <Plus aria-hidden size={18} strokeWidth={2.4} className="@[15rem]:-ml-0.5" />
              <span aria-hidden className="hidden whitespace-nowrap @[15rem]:inline">
                {addLabel}
              </span>
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** A tile's place while the grid loads. */
export function TileSkeleton() {
  return (
    <li aria-hidden className="overflow-hidden rounded-xl border border-line bg-paper">
      <div className="skeleton aspect-[1/1] !rounded-none sm:aspect-[5/4]" />
      <div className="space-y-2 p-3 sm:p-4">
        <div className="skeleton h-3 w-16" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-2/3" />
        <div className="flex items-end justify-between pt-3">
          <div className="skeleton h-4 w-20" />
          <div className="skeleton size-10 !rounded-full" />
        </div>
      </div>
    </li>
  );
}

export function LiveBox({ r, busy, p }: { r?: LiveResult & { checkedAt: string }; busy: boolean; p: Product }) {
  const tx = useText(SHOP_TEXT);
  const f = useFormat();
  const [now] = useState(() => Date.now());
  if (busy && !r)
    return (
      <div role="status" aria-label={tx.askingWholesaler} className="space-y-3">
        <div className="skeleton h-12 w-40" />
        <div className="skeleton h-4 w-56" />
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <div className="skeleton h-16" />
          <div className="skeleton h-16" />
        </div>
        <p className="text-[0.85rem] text-ink-soft">{tx.askingWholesaler}</p>
      </div>
    );
  if (!r) return null;
  const o = r.offer;
  if (!o)
    return (
      <Panel className="px-4 py-3.5">
        <p className="font-semibold">{tx.notOrderableRightNow}</p>
        <p className="mt-0.5 text-[0.95rem] leading-snug text-ink-soft">{r.problems.length ? problemsText(r.problems, f.lang) : r.message}</p>
        <p className="mt-1.5 text-[0.8rem] text-ink-soft">{tx.checkedLiveOn(f.day(helsinkiToday(new Date(r.checkedAt))), clock(r.checkedAt))}</p>
      </Panel>
    );
  const cut = cutoffMs(o.orderBy);
  const soon = cut !== undefined && cut - now < 6 * 3_600_000;
  // A Finnish wholesaler's way: before VAT with the rate said, the customer's own price beside the list price, and a
  // returnable-packaging deposit as its own amount (core/pricing.ts).
  const vat = vatRateOf(o, p);
  const own = ownPrice(o);
  const dep = packDeposit(p.deposits);
  return (
    <div>
      <p className="display text-[2.6rem] leading-none text-ink tabular sm:text-[3rem]">{money(o.unitPriceCents)}</p>
      <p className="mt-1.5 text-[0.92rem] text-ink-soft">
        {tx.perVat(unitWord(p, 1, f.lang), vat ? numIn(vat.pct, f.lang, 1) : undefined)}
        {!vat && <>{"; "}{tx.vatUnknown}</>}
        {o.comparisonPriceCents !== undefined && o.comparisonUnit && (
          <>
            {"; "}
            <span className="tabular">{money(o.comparisonPriceCents)}</span>
            {tx.comparisonPer(o.comparisonUnit.toLowerCase())}
          </>
        )}
      </p>
      {own && <p className="mt-1 text-[0.88rem] text-ink-soft">{tx.yourPrice(money(own.listCents), numIn(own.pct, f.lang, 1))}</p>}
      {dep && dep.knownCents > 0 && <p className="mt-1 text-[0.88rem] text-ink-soft">{tx.depositLine(money(dep.knownCents), dep.lines.filter((l) => l.totalCents !== null).map((l) => `${num(l.quantity, 0)} × ${tx.depositKind[l.kind]} ${money(l.unitCents!)}`).join(", "))}</p>}
      {dep && dep.unknown.length > 0 && <p className="mt-1 text-[0.88rem] text-ink-soft">{tx.depositUnknown}</p>}
      <dl className="mt-4 grid grid-cols-2 gap-2.5">
        <div className="min-w-0 rounded-lg bg-surface px-3.5 py-2.5">
          <dt className="text-[0.76rem] text-ink-soft">{tx.orderBy}</dt>
          <dd className="mt-0.5 font-semibold leading-snug">
            {o.orderBy ? (cutoffText(o.orderBy, f.lang) ?? o.orderBy) : tx.noCutoff}
            {cut !== undefined && <span className={`block text-[0.84rem] ${soon ? "font-semibold text-notice" : "font-medium text-ink-soft"}`}>{untilText(cut, now, f.lang)}</span>}
          </dd>
        </div>
        <div className="min-w-0 rounded-lg bg-surface px-3.5 py-2.5">
          <dt className="text-[0.76rem] text-ink-soft">{tx.earliestDelivery}</dt>
          <dd className="mt-0.5 font-semibold leading-snug">{f.day(o.deliveryDate)}</dd>
        </div>
        <div className="col-span-2 min-w-0 rounded-lg bg-surface px-3.5 py-2.5">
          <dt className="text-[0.76rem] text-ink-soft">{tx.stock}</dt>
          <dd className="mt-0.5 font-semibold leading-snug">{o.stockKnown === false ? tx.stockNotConfirmed : `${num(o.availablePacks, 0)} ${unitWord(p, o.availablePacks, f.lang)}`}</dd>
        </div>
      </dl>
      <p className="mt-2.5 text-[0.8rem] text-ink-soft">{tx.checkedLiveAt(clock(r.checkedAt))}</p>
    </div>
  );
}

/** Product facts as the data states them: every field present, "no data" where the data does not say. */
export function Facts({ p, lang }: { p: Product; lang: Lang }) {
  const tx = SHOP_TEXT[lang];
  const t = tx.facts;
  const a = p.allergenInfo;
  const al = (x: string) => allergenText(x, lang);
  const rows: { key: string; label: string; value: React.ReactNode }[] = [
    {
      key: "sold",
      label: t.soldPer,
      value: (
        <>
          {unitWord(p, 1, lang)}: {quantityText(p, 1, lang).split(" = ")[1] ?? t.contentNoData}
          {p.packContent && !p.packContent.certain && <span className="block text-[0.88rem] text-ink-soft">{t.contentUncertain}</span>}
        </>
      ),
    },
    {
      key: "allergens",
      label: t.allergens,
      value:
        !a || !a.declared ? (
          <>
            <Missing>{tx.noData}</Missing>
            <span className="mt-1 block text-[0.88rem] text-ink-soft">{t.noAllergenData}</span>
          </>
        ) : (
          <>
            {a.contains.length ? t.contains(a.contains.map(al).join(", ")) : t.containsNone}
            {a.mayContain.length > 0 && <span className="block">{t.mayContain(a.mayContain.map(al).join(", "))}</span>}
            {a.freeFrom.length > 0 && <span className="block text-ink-soft">{t.freeFrom(a.freeFrom.map(al).join(", "))}</span>}
          </>
        ),
    },
    { key: "claims", label: t.claims, value: claimsOf(p).length ? claimsOf(p).map((c) => tx.claim[c]).join(", ") : <span className="text-ink-soft">{t.noneStated}</span> },
    { key: "brand", label: t.brand, value: p.brand !== "unknown" ? p.brand : <Missing>{tx.noData}</Missing> },
    { key: "supplier", label: t.supplier, value: p.vendor ?? <Missing>{tx.noData}</Missing> },
    { key: "origin", label: t.origin, value: originText(p.countryOfOrigin, lang) ?? <Missing>{tx.noData}</Missing> },
    { key: "storage", label: t.storage, value: tempLabel(p.temperatureClass, lang) ?? <Missing>{tx.noData}</Missing> },
    { key: "labels", label: t.labels, value: p.certificates.length ? p.certificates.map(labelText).join(", ") : <span className="text-ink-soft">{t.noneStated}</span> },
    {
      key: "reliability",
      label: t.deliveredInFull,
      value: p.deliveryReliabilityKnown === false || (p.source === "valio" && p.deliveryReliabilityKnown === undefined) ? <Missing>{tx.noData}</Missing> : t.pastDeliveries(Math.round(p.deliveryReliability * 100)),
    },
    {
      key: "carbon",
      label: t.carbon,
      value:
        p.carbonGroupAvgKgCo2ePerKg != null ? (
          <>
            {t.carbonPerKg(num(p.carbonGroupAvgKgCo2ePerKg, 2))}
            <span className="block text-[0.88rem] text-ink-soft">{t.carbonGroupNote}</span>
          </>
        ) : p.source === "valio" ? (
          <Missing>{tx.noData}</Missing>
        ) : (
          t.carbonPer(String(p.carbonKgPerUnit), p.unit)
        ),
    },
    ...depthRows(p, lang),
    { key: "code", label: t.productCode, value: <span className="tabular">{p.id}</span> },
    ...(["fi", "sv", "en"] as const).filter((l) => l !== lang && p.names?.[l]).map((l) => ({ key: `name-${l}`, label: t.nameIn[l], value: p.names![l] })),
  ];
  return <FactList rows={rows} labelWidth="min(10.5rem, 36%)" stack={false} />;
}

/**
 * What the partner's data says beyond the basics, each row only when the data says it (and "no data" where a buyer
 * would otherwise read silence as "none"): nutrition per 100 g or ml, the ingredient list, storage and use, origins
 * and the main ingredient's origin, a fish product's catch, the packaging's disposal, the VAT rate and any deposit.
 */
function depthRows(p: Product, lang: Lang): { key: string; label: string; value: React.ReactNode }[] {
  const tx = SHOP_TEXT[lang];
  const t = tx.facts;
  const rows: { key: string; label: string; value: React.ReactNode }[] = [];
  const text = (k: "ingredients" | "storage" | "usage" | "disposal") => {
    const v = p.texts?.[k];
    const shown = lang === "fi" ? (v?.fi ? { s: v.fi, l: "fi" } : v?.en ? { s: v.en, l: "en" } : undefined) : v?.en ? { s: v.en, l: "en" } : v?.fi ? { s: v.fi, l: "fi" } : undefined;
    if (!shown) return undefined;
    return (
      <>
        {shown.s}
        {(shown.l !== lang || shown.s.endsWith("…")) && (
          <span className="block text-[0.88rem] text-ink-soft">
            {shown.l !== lang ? t.inLang(shown.l).trim() : ""} {shown.s.endsWith("…") ? t.shortened : ""}
          </span>
        )}
      </>
    );
  };
  if (p.source === "valio" || p.nutrition) {
    const n = p.nutrition;
    rows.push({
      key: "nutrition",
      label: t.nutrition(n?.per ?? "100g"),
      value: n ? (
        <span className="block">
          {NUTRIENTS.filter((k) => n.values[k] !== undefined).map((k) => (
            <span key={k} className="block">
              {t.nutrient[k]}: {n.lessThan?.includes(k) ? t.lessThan(numIn(n.values[k]!, lang)) : numIn(n.values[k]!, lang)} {NUTRIENT_UNIT[k]}
            </span>
          ))}
        </span>
      ) : (
        <Missing>{t.noNutrition}</Missing>
      ),
    });
  }
  const ing = text("ingredients");
  if (ing) rows.push({ key: "ingredients", label: t.ingredients, value: ing });
  const temp = p.storageTempC;
  const store = text("storage");
  if (store || temp) rows.push({ key: "storage-text", label: t.storageText, value: <>{temp && <span className="block">{t.tempRange(temp.min !== undefined ? numIn(temp.min, lang, 1) : undefined, temp.max !== undefined ? numIn(temp.max, lang, 1) : undefined)}</span>}{store}</> });
  const use = text("usage");
  if (use) rows.push({ key: "usage", label: t.usage, value: use });
  const country = (c: string) => (c === "non_eu" ? t.nonEu : (originText(c, lang) ?? c.toUpperCase()));
  if (p.origins && (p.origins.length > 1 || p.origins[0] !== p.countryOfOrigin)) rows.push({ key: "origins", label: t.origins, value: p.origins.map(country).join(", ") });
  const m = p.mainIngredient;
  if (m && (m.origins.length || m.pct !== undefined)) {
    const name = (lang === "fi" ? m.names.fi : lang === "sv" ? m.names.sv : m.names.en) ?? m.names.en ?? m.names.fi ?? "";
    rows.push({ key: "main-ingredient", label: t.mainIngredient, value: `${name}${m.pct !== undefined ? ` ${numIn(m.pct, lang, 1)} %` : ""}${m.origins.length ? `: ${m.origins.map((o) => `${t.stage[o.stage] ?? o.stage.toLowerCase()} ${country(o.country)}`).join(", ")}` : ""}` });
  }
  for (const [i, f] of (p.fish ?? []).entries())
    rows.push({ key: `catch-${i}`, label: t.catch, value: [f.latin ? `${f.latin} (${f.species})` : f.species, f.production ? t.production[f.production] : undefined, f.areas.length ? t.fishArea(f.areas.join(", ")) : undefined, f.methods.length ? t.gear(f.methods.join(", ")) : undefined].filter(Boolean).join("; ") });
  const disposal = text("disposal");
  if (disposal) rows.push({ key: "disposal", label: t.disposal, value: disposal });
  const vat = vatRateOf(undefined, p);
  if (vat) rows.push({ key: "vat", label: t.vat, value: t.vatRate(numIn(vat.pct, lang, 1), false) });
  const dep = packDeposit(p.deposits);
  if (dep)
    rows.push({
      key: "deposit",
      label: t.deposit,
      value: (
        <>
          {dep.lines.map((l) => `${num(l.quantity, 0)} × ${tx.depositKind[l.kind] ?? tx.depositKind.unknown}${l.unitCents !== null ? ` ${money(l.unitCents)}` : ""}`).join(", ")}
          {dep.knownCents > 0 && <span className="block">= {money(dep.knownCents)}</span>}
          <span className="block text-[0.88rem] text-ink-soft">{dep.unknown.length ? `${tx.depositUnknown} ` : ""}{tx.depositBasis}</span>
        </>
      ),
    });
  return rows;
}

/**
 * The buy box on a product page: the live price on open, the quantity in the sales unit with what it means, then the
 * basket (the one lime action) or the agent. On a phone it comes straight after the picture and the name, before the
 * facts, so the action is a thumb's reach from the top.
 */
export function BuyBox({ p }: { p: Product }) {
  const { live, basket, agent, lang, thread } = usePortal();
  const tx = useText(SHOP_TEXT);
  const [n, setN] = useState(stepOf(p));
  const check = live.check;
  useEffect(() => {
    void check([p.id]);
  }, [p.id, check]);
  const r = live.results[p.id];
  const line = basket.lines.find((l) => l.productId === p.id);
  return (
    <div className="rounded-xl border border-line bg-paper p-5 shadow-sm sm:p-6">
      <LiveBox r={r} busy={live.busy.includes(p.id)} p={p} />
      {live.error && !r && <p className="text-ink-soft">{tx.liveFailed(live.error)}</p>}
      <div className="mt-5 border-t border-line pt-5">
        <Quantity p={p} value={n} onChange={setN} id={`qty-${p.id}`} />
        {r?.offer && (
          <p key={n} className="changed mt-3 inline-block rounded-sm px-1 text-[1.05rem] font-semibold tabular">
            {tx.priceFor(money(r.offer.unitPriceCents * n), quantityText(p, n, lang))}
            {(packDeposit(p.deposits)?.knownCents ?? 0) > 0 && tx.plusDeposit(money(packDeposit(p.deposits)!.knownCents * n))}
          </p>
        )}
      </div>
      <div className="mt-5 flex flex-col gap-2.5">
        <KitButton kind="go" size="lg" onClick={() => basket.add(p, n)}>
          {line ? tx.addMore : tx.add}
        </KitButton>
        <button
          type="button"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-lavender px-5 font-semibold text-lavender-deep transition-colors duration-150 hover:bg-lavender-mid"
          onClick={() => {
            agent.setProduct(p);
            agent.setFollowUp(undefined);
            // The agent opens on this product's facts card (a `product_show` turn); the composer keeps the product.
            void thread.submit({ door: "typed", via: "tap", action: { type: "product_show", productId: p.id }, label: `${tx.orderWithAgent}: ${p.name}`, lang });
            agent.open();
          }}
        >
          <Sparkles aria-hidden size={17} />
          {tx.orderWithAgent}
        </button>
      </div>
      {line && (
        <p className="mt-4 flex items-center gap-2 rounded-md bg-good-soft px-3.5 py-2.5 text-[0.92rem] font-medium text-good">
          <Check aria-hidden size={17} strokeWidth={2.4} className="shrink-0" /> {tx.inBasketQty(quantityText(p, line.packs, lang))}
        </p>
      )}
      <p className="mt-5 text-[0.82rem] leading-snug text-ink-soft">
        <span className="font-semibold text-ink tabular">{live.calls}</span>
        {tx.callsA(live.calls)}
        <span className="tabular">{live.products}</span>
        {tx.callsB(live.products)}
      </p>
    </div>
  );
}
