"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { api } from "../../_client/api";
import { Glyph, TempGlyph, type GlyphKind } from "../../_ui/glyphs";
import { Art, artFor } from "../../_ui/art";
import { ART_TEXT } from "../../_ui/art.text";
import { Spinner, Tag, Working } from "../../_ui/kit";
import { attr, clock, helsinkiToday, money, num } from "../../_ui/plain";
import { useFormat, useLang, useText } from "../../_i18n/provider";
import { attrL } from "../../_i18n/format";
import { usePortal, type Lang } from "./portal";
import { Quantity } from "./qty";
import { SHOP_TEXT } from "./shop.text";
import { Button, Missing } from "./ui";
import { contentOf, quantityText, stepOf, unitWord } from "./units";
import type { LiveResult, Product } from "./types";
import { cutoffMs, cutoffText, untilText } from "./when";

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

/** The temperature as a quiet code: glyph and word in the class colour. */
export function TempMark({ t, className = "" }: { t?: string | null; className?: string }) {
  const tx = useText(SHOP_TEXT);
  const x = TEMP[t ?? ""];
  if (!x) return <span className={`text-ink-soft ${className}`}>{tx.storageNoData}</span>;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${className}`} style={{ color: x.color }}>
      <TempGlyph t={t ?? ""} size={13} />
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

/** The pack is the picture: the drawn pack, and what one sales unit holds, set large. */
export function PackPlate({ p, size = "md" }: { p: Product; size?: "md" | "lg" }) {
  const tx = useText(SHOP_TEXT);
  const ax = useText(ART_TEXT);
  const { lang } = useLang();
  const m = contentOf(p, 1);
  const big = m ? (m.unit === "pcs" ? tx.pcs(num(m.amount)) : `${num(m.amount)} ${m.unit}`) : unitWord(p, 1, lang);
  const per = `${tx.per(unitWord(p, 1, lang))}${m && !m.certain ? tx.about : ""}`;
  const lg = size === "lg";
  const key = artFor(p);
  const drawn = <DrawnPlate p={p} big={big} per={per} lg={lg} />;
  if (!key) return drawn;
  // The picture is an illustration of the kind of product, never this product: it says so, and the pack's real
  // content stays in type on a paper badge, readable before the name.
  return (
    <div className={`relative ${lg ? "aspect-[4/3]" : "aspect-[16/11]"}`}>
      <Art k={key} cover sizes={lg ? "(min-width: 1024px) 34rem, 92vw" : "(min-width: 1280px) 16rem, (min-width: 640px) 30vw, 92vw"} position="50% 58%" fallback={drawn} />
      <p className={`absolute bottom-0 left-0 bg-paper ${lg ? "px-5 py-3" : "px-2.5 pb-1.5 pt-1"}`}>
        <span className={`display block text-petrol-deep tabular ${lg ? "text-[3.4rem]" : "text-[1.75rem]"}`}>{big}</span>
        <span className={`block text-ink-soft ${lg ? "text-[1rem]" : "text-[0.78rem]"}`}>{per}</span>
      </p>
      <span title={ax.illustrationLong} className={`absolute right-0 top-0 bg-petrol-deep/75 text-paper ${lg ? "px-2.5 py-1 text-[0.85rem]" : "px-1.5 py-0.5 text-[0.7rem]"}`}>
        {ax.illustration}
        <span className="sr-only">: {ax.illustrationLong}</span>
      </span>
    </div>
  );
}

/** The drawn pack: the fallback when there is no picture for the kind of product, or it fails to load. */
function DrawnPlate({ p, big, per, lg }: { p: Product; big: string; per: string; lg: boolean }) {
  const t = TEMP[p.temperatureClass ?? ""];
  return (
    <div className={`flex items-center gap-3 ${lg ? "px-6 py-8" : "px-3 py-3"}`} style={{ background: t?.tint ?? "var(--color-mist)" }}>
      <Glyph kind={packGlyph(p)} size={lg ? 96 : 44} className="shrink-0 text-petrol-deep" strokeWidth={lg ? 2 : 2.5} />
      <div className="min-w-0">
        <p className={`display text-petrol-deep tabular ${lg ? "text-[4.2rem]" : "text-[2rem]"}`}>{big}</p>
        <p className={`text-ink-soft ${lg ? "mt-1 text-[1.05rem]" : "text-[0.82rem]"}`}>{per}</p>
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

export function Tile({ p }: { p: Product }) {
  const { base, lang, live, basket } = usePortal();
  const tx = useText(SHOP_TEXT);
  const r = live.results[p.id];
  const line = basket.lines.find((l) => l.productId === p.id);
  const href = `${base}/catalogue/${encodeURIComponent(p.id)}`;
  const prof = useProfile(p.id);
  const origin = originText(p.countryOfOrigin, lang);
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
          {prof?.uses.length ? <>{tx.forUses(!!prof.kind)}{prof.uses.slice(0, 3).map((u) => u.text).join(", ")}</> : null}
          {prof === undefined && <span className="inline-block h-3 w-28 animate-pulse bg-mist align-middle" />}
        </p>
        <p className="mt-1 text-[0.86rem] text-ink-soft">
          {quantityText(p, 1, lang)}
          {origin ? `, ${origin}` : ""}
        </p>
        {claimsOf(p).length > 0 && (
          <p className="mt-2 flex flex-wrap gap-1">
            {claimsOf(p)
              .slice(0, 4)
              .map((c) => (
                <Tag key={c}>{tx.claim[c]}</Tag>
              ))}
          </p>
        )}
        <div className="relative z-10 mt-auto flex items-end justify-between gap-2 border-t border-line pt-2.5">
          <span className="text-[0.88rem] leading-tight">
            {r?.offer ? (
              <>
                <span className="display text-[1.45rem] tabular">{money(r.offer.unitPriceCents)}</span>
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
            <Link href={`${base}/basket`} className="flex min-h-10 items-center gap-1.5 bg-petrol-soft px-2.5 text-[0.92rem] font-semibold text-petrol-deep">
              <span aria-hidden>✓</span> {tx.inBasket(line.packs)}
            </Link>
          ) : (
            <Button
              kind="primary"
              size="sm"
              className={`min-h-10 ${lang === "en" ? "whitespace-nowrap" : "text-balance"}`}
              onClick={() => {
                basket.add(p, stepOf(p));
                void live.check([p.id]);
              }}
            >
              {stepOf(p) > 1 || p.salesUnit === "KG" ? tx.addN(stepOf(p), unitWord(p, stepOf(p), lang)) : tx.addOne(unitWord(p, 1, lang))}
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

export function LiveBox({ r, busy, p }: { r?: LiveResult & { checkedAt: string }; busy: boolean; p: Product }) {
  const tx = useText(SHOP_TEXT);
  const f = useFormat();
  const [now] = useState(() => Date.now());
  if (busy && !r) return <Working>{tx.askingWholesaler}</Working>;
  if (!r) return null;
  const o = r.offer;
  if (!o)
    return (
      <div className="border-l-[6px] border-ink bg-mist px-3 py-2">
        <p className="font-semibold">{tx.notOrderableRightNow}</p>
        <p className="text-[0.95rem] text-ink-soft">{r.problems.length ? problemsText(r.problems, f.lang) : r.message}</p>
        <p className="mt-1 text-[0.82rem] text-ink-soft">{tx.checkedLiveOn(f.day(helsinkiToday(new Date(r.checkedAt))), clock(r.checkedAt))}</p>
      </div>
    );
  const cut = cutoffMs(o.orderBy);
  return (
    <div>
      <p className="display text-[3rem] text-ink tabular">{money(o.unitPriceCents)}</p>
      <p className="text-[0.95rem] text-ink-soft">
        {tx.perVat(unitWord(p, 1, f.lang))}
        {o.comparisonPriceCents !== undefined && o.comparisonUnit && (
          <>
            {"; "}
            <span className="tabular">{money(o.comparisonPriceCents)}</span>
            {tx.comparisonPer(o.comparisonUnit.toLowerCase())}
          </>
        )}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-px bg-line">
        <div className="min-w-0 bg-paper py-2 pr-2">
          <dt className="text-[0.8rem] text-ink-soft">{tx.orderBy}</dt>
          <dd className="font-semibold leading-snug">
            {o.orderBy ? (cutoffText(o.orderBy, f.lang) ?? o.orderBy) : tx.noCutoff}
            {cut !== undefined && <span className={`block text-[0.88rem] ${cut - now < 6 * 3_600_000 ? "font-bold text-ink" : "font-medium text-ink-soft"}`}>{untilText(cut, now, f.lang)}</span>}
          </dd>
        </div>
        <div className="min-w-0 bg-paper py-2 pl-3">
          <dt className="text-[0.8rem] text-ink-soft">{tx.earliestDelivery}</dt>
          <dd className="font-semibold">{f.day(o.deliveryDate)}</dd>
        </div>
        <div className="col-span-2 bg-paper py-2">
          <dt className="text-[0.8rem] text-ink-soft">{tx.stock}</dt>
          <dd className="font-semibold">{o.stockKnown === false ? tx.stockNotConfirmed : `${num(o.availablePacks, 0)} ${unitWord(p, o.availablePacks, f.lang)}`}</dd>
        </div>
      </dl>
      <p className="mt-2 text-[0.82rem] text-ink-soft">{tx.checkedLiveAt(clock(r.checkedAt))}</p>
    </div>
  );
}

/** Product facts as a waybill: every field present, "no data" where the data does not say. */
export function Facts({ p, lang }: { p: Product; lang: Lang }) {
  const tx = SHOP_TEXT[lang];
  const t = tx.facts;
  const a = p.allergenInfo;
  const al = (x: string) => allergenText(x, lang);
  return (
    <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1.5 text-[0.98rem] [&>dd]:min-w-0 [&>dd]:break-words [&>dt]:hyphens-manual">
      <dt className="text-ink-soft">{t.productCode}</dt>
      <dd className="tabular">{p.id}</dd>
      <dt className="text-ink-soft">{t.soldPer}</dt>
      <dd>
        {unitWord(p, 1, lang)}: {quantityText(p, 1, lang).split(" = ")[1] ?? t.contentNoData}
        {p.packContent && !p.packContent.certain && <span className="block text-[0.88rem] text-ink-soft">{t.contentUncertain}</span>}
      </dd>
      <dt className="text-ink-soft">{t.brand}</dt>
      <dd>{p.brand !== "unknown" ? p.brand : <Missing>{tx.noData}</Missing>}</dd>
      <dt className="text-ink-soft">{t.supplier}</dt>
      <dd>{p.vendor ?? <Missing>{tx.noData}</Missing>}</dd>
      <dt className="text-ink-soft">{t.origin}</dt>
      <dd>{originText(p.countryOfOrigin, lang) ?? <Missing>{tx.noData}</Missing>}</dd>
      <dt className="text-ink-soft">{t.storage}</dt>
      <dd>{tempLabel(p.temperatureClass, lang) ?? <Missing>{tx.noData}</Missing>}</dd>
      <dt className="text-ink-soft">{t.claims}</dt>
      <dd>{claimsOf(p).length ? claimsOf(p).map((c) => tx.claim[c]).join(", ") : t.noneStated}</dd>
      <dt className="text-ink-soft">{t.labels}</dt>
      <dd>{p.certificates.length ? p.certificates.map(labelText).join(", ") : t.noneStated}</dd>
      <dt className="text-ink-soft">{t.allergens}</dt>
      <dd>
        {!a || !a.declared ? (
          <>
            <Missing>{tx.noData}</Missing>
            <span className="block text-[0.88rem] text-ink-soft">{t.noAllergenData}</span>
          </>
        ) : (
          <>
            {a.contains.length ? t.contains(a.contains.map(al).join(", ")) : t.containsNone}
            {a.mayContain.length > 0 && <span className="block">{t.mayContain(a.mayContain.map(al).join(", "))}</span>}
            {a.freeFrom.length > 0 && <span className="block text-ink-soft">{t.freeFrom(a.freeFrom.map(al).join(", "))}</span>}
          </>
        )}
      </dd>
      <dt className="text-ink-soft">{t.deliveredInFull}</dt>
      <dd>{p.deliveryReliabilityKnown === false || (p.source === "valio" && p.deliveryReliabilityKnown === undefined) ? <Missing>{tx.noData}</Missing> : t.pastDeliveries(Math.round(p.deliveryReliability * 100))}</dd>
      <dt className="text-ink-soft">{t.carbon}</dt>
      <dd>
        {p.carbonGroupAvgKgCo2ePerKg != null ? (
          <>
            {t.carbonPerKg(num(p.carbonGroupAvgKgCo2ePerKg, 2))}
            <span className="block text-[0.88rem] text-ink-soft">{t.carbonGroupNote}</span>
          </>
        ) : p.source === "valio" ? (
          <Missing>{tx.noData}</Missing>
        ) : (
          t.carbonPer(String(p.carbonKgPerUnit), p.unit)
        )}
      </dd>
      {(["fi", "sv", "en"] as const)
        .filter((l) => l !== lang && p.names?.[l])
        .map((l) => (
          <div key={l} className="contents">
            <dt className="text-ink-soft">{t.nameIn[l]}</dt>
            <dd className="min-w-0 break-words">{p.names![l]}</dd>
          </div>
        ))}
    </dl>
  );
}

/** The buy box on a product page: live price on open, quantity in the sales unit with what it means, basket or agent. */
export function BuyBox({ p }: { p: Product }) {
  const { live, basket, agent, lang } = usePortal();
  const tx = useText(SHOP_TEXT);
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
        {live.error && !r && <p className="text-ink-soft">{tx.liveFailed(live.error)}</p>}
        <div className="border-t border-line pt-4">
          <Quantity p={p} value={n} onChange={setN} id={`qty-${p.id}`} />
          {r?.offer && (
            <p key={n} className="changed mt-2 inline-block px-1 text-[1.1rem] font-semibold tabular">
              {tx.priceFor(money(r.offer.unitPriceCents * n), quantityText(p, n, lang))}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button kind="go" size="lg" onClick={() => basket.add(p, n)}>
            {line ? tx.addMore : tx.add}
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
            {tx.orderWithAgent}
          </button>
        </div>
        {line && (
          <p className="flex items-center gap-2 bg-petrol-soft px-3 py-2 text-[0.95rem] text-petrol-deep">
            <span aria-hidden>✓</span> {tx.inBasketQty(quantityText(p, line.packs, lang))}
          </p>
        )}
        <p className="border-t border-line pt-3 text-[0.85rem] leading-snug text-ink-soft">
          <span className="font-semibold text-ink tabular">{live.calls}</span>
          {tx.callsA(live.calls)}
          <span className="tabular">{live.products}</span>
          {tx.callsB(live.products)}
        </p>
      </div>
    </div>
  );
}
