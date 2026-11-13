import { NOTICE_INSTRUCTIONS, NOTICE_SCHEMA, type ModelNotice } from "./facts";
import { type ContextDev, type Exa, type ExaResult, type FetchFn, PartnerError, fetchText } from "./partners";
import { BUDGET, type SourceConfig } from "./sources";
import { fold, nameTokens, parseLongDate } from "./text";
import type { Notice, ReadBy } from "./types";

/**
 * Readers: from a source to listed notices, and from a notice URL to page text plus the model's proposed facts.
 *
 * Authority listings (and the drill page, which copies their layout) are read by Context.dev with a CSS parser:
 * deterministic, one credit. If the parser suddenly finds nothing on a page that listed a hundred notices, the
 * layout changed: the radar tries Context.dev's JSON extraction of the listing once, and otherwise reports the
 * source as needing attention. It never treats "found nothing" as "nothing is recalled", and never as an alarm.
 *
 * Notice pages are read by Context.dev into Markdown and JSON in one call (5 credits). A page Context.dev cannot
 * reach (the drill on a laptop without a public address) is fetched directly and read by code alone, and says so.
 */

export type ListingItem = { url: string; title: string; publishedOn?: string };
export type ListingRead = { items: ListingItem[]; via: "context.dev" | "context.dev-json" | "direct"; note?: string };
export type PageRead = { text: string; model?: ModelNotice; title?: string; publishedOn?: string; via: ReadBy; cached: boolean };

export type ReaderDeps = {
  cd: ContextDev;
  exa: Exa;
  fetch?: FetchFn;
  now: () => Date;
  /** Where the drill page lives: a public base Context.dev can reach, or this server's own origin. */
  drill: { publicBase?: string; localOrigin?: string };
  /** A drill or a person's "check now": may use the reserve of Context.dev's per-minute allowance. */
  urgent?: boolean;
};

/** The CSS rules for the authority's listing, used by Context.dev's parser and by the direct reader alike. */
export const LISTING_RULES = {
  items: { selector: ".content-list-block__list-item", type: "list", output: { date: ".content-list-block__date", title: ".content-list-block__title", url: "a@href" } },
} as const;

const LISTING_SCHEMA = {
  type: "object",
  properties: { items: { type: "array", items: { type: "object", properties: { title: { type: "string" }, date: { type: ["string", "null"] }, url: { type: "string" } }, required: ["title", "url"] } } },
  required: ["items"],
} as const;

const isLocal = (base: string) => /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.)/i.test(base);

/** The listing URL to read and whether Context.dev can reach it. */
export function listingTarget(source: SourceConfig, deps: Pick<ReaderDeps, "drill">): { url: string; via: "context.dev" | "direct" } {
  if (!source.drill) return { url: source.homeUrl, via: "context.dev" };
  const pub = deps.drill.publicBase?.replace(/\/$/, "");
  if (pub && !isLocal(pub)) return { url: `${pub}${source.homeUrl}`, via: "context.dev" };
  const local = (deps.drill.localOrigin ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`).replace(/\/$/, "");
  return { url: `${local}${source.homeUrl}`, via: "direct" };
}

function absolute(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function toItems(raw: unknown, base: string): ListingItem[] {
  const list = (raw as { items?: { date?: string | null; title?: string | null; url?: string | null }[] })?.items ?? [];
  return list
    .filter((x) => x && typeof x.url === "string" && typeof x.title === "string" && x.title.trim())
    .map((x) => ({ url: absolute(x.url!.trim(), base), title: x.title!.replace(/\s+/g, " ").trim(), publishedOn: x.date ? parseLongDate(x.date) : undefined }));
}

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

/** The same rules as LISTING_RULES, applied by code to HTML fetched directly. */
export function parseListingHtml(html: string, base: string): ListingItem[] {
  const out: ListingItem[] = [];
  for (const block of html.split(/class="content-list-block__list-item"/).slice(1)) {
    const date = /content-list-block__date"[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1];
    const link = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link) continue;
    const title = decode(link[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!title) continue;
    out.push({ url: absolute(decode(link[1]), base), title, publishedOn: date ? parseLongDate(decode(date)) : undefined });
  }
  return out;
}

/** Visible text of a page's main content, one block per line, for code's own reading. */
export function htmlToText(html: string): string {
  const main = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? html;
  return decode(
    main
      .replace(/<(script|style|noscript|svg|nav|footer)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|h[1-6]|div|tr|dd|dt|section|article|header)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function readListing(source: SourceConfig, deps: ReaderDeps, opts: { force?: boolean; previousCount?: number } = {}): Promise<ListingRead> {
  const target = listingTarget(source, deps);
  if (target.via === "direct" || !deps.cd.configured) {
    const html = await fetchText(target.url, {}, deps.fetch);
    return { items: parseListingHtml(html, target.url), via: "direct", note: target.via === "direct" ? "Read directly: Context.dev cannot reach this server's own address." : "Read directly: no Context.dev key." };
  }
  const maxAgeMs = opts.force || source.drill ? 0 : BUDGET.listingMaxAgeMinutes * 60_000;
  const r = await deps.cd.scrape({ url: target.url, formats: { parse: true }, parseParams: { rules: LISTING_RULES }, maxAgeMs }, 60_000, deps.urgent);
  if (r.parsed?.success === false) throw new PartnerError("context.dev", "http", `Context.dev could not read the listing: ${r.parsed.message ?? r.parsed.error_code ?? "unknown error"}.`);
  const items = toItems(r.parsed?.data, r.url || target.url);
  // A listing that had notices and now parses to none changed its layout; try reading it by meaning once.
  if (items.length === 0 && (opts.previousCount ?? 0) > 0) {
    const j = await deps.cd.scrape({ url: target.url, formats: { json: true }, jsonParams: { schema: LISTING_SCHEMA, instructions: "List every recall notice linked on this page with its title, date as written and link." }, maxAgeMs: 0 }, 90_000, deps.urgent);
    const viaJson = toItems(j.json?.data, j.url || target.url);
    return { items: viaJson, via: "context.dev-json", note: viaJson.length ? "The listing's layout changed: read by meaning instead of by its CSS classes." : "The listing's layout changed and nothing could be read." };
  }
  return { items, via: "context.dev" };
}

/** One notice page: Context.dev's Markdown and JSON extraction, or (drill without a public address) direct text. */
export async function readPage(url: string, source: SourceConfig, deps: ReaderDeps): Promise<PageRead> {
  const direct = (source.drill && listingTarget(source, deps).via === "direct") || !deps.cd.configured;
  if (direct) {
    const html = await fetchText(url, {}, deps.fetch);
    const title = decode(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, " ") ?? "").replace(/\s+/g, " ").trim() || undefined;
    return { text: htmlToText(html), title, via: "direct", cached: false };
  }
  const r = await deps.cd.scrape(
    { url, formats: { markdown: true, json: true }, jsonParams: { schema: NOTICE_SCHEMA, instructions: NOTICE_INSTRUCTIONS }, sharedParams: { mainContentOnly: true }, ...(source.drill ? { maxAgeMs: 0 } : {}) },
    90_000,
    deps.urgent,
  );
  const text = r.markdown?.success ? (r.markdown.data ?? "") : "";
  if (!text.trim()) throw new PartnerError("context.dev", "bad_response", `Context.dev returned no text for ${url}${r.markdown?.message ? `: ${r.markdown.message}` : ""}.`);
  const model = r.json?.success ? ((r.json.data ?? undefined) as ModelNotice | undefined) : undefined;
  return {
    text,
    model,
    title: model?.title ?? r.metadata?.title,
    publishedOn: model?.published ? parseLongDate(model.published) : undefined,
    via: source.kind === "web_search" ? "exa+context.dev" : "context.dev",
    cached: r.cache_metadata?.status === "hit",
  };
}

// ---------- Exa ----------

const RECALL_WORDS = /takaisinve|takaisin ve|vetaa myynnista|vetaa pois myynnista|veda myynnista|myynnista poisto|aterkall|drar tillbaka|recall|withdraw/;

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86400_000).toISOString();

/** Producers' and retailers' own notices, found by Exa by meaning and date, Finnish and Swedish. */
export async function discoverOnWeb(source: SourceConfig, deps: ReaderDeps): Promise<ListingItem[]> {
  const since = daysAgo(deps.now(), source.readWindowDays);
  const queries = [
    "Elintarvikkeen takaisinveto: yritys vetää tuotteen myynnistä ja pyytää kuluttajia palauttamaan sen",
    "Återkallelse av livsmedel i Finland: företaget återkallar produkten",
  ];
  const found = new Map<string, ListingItem>();
  for (const query of queries) {
    const results = await deps.exa.search({ query, type: "auto", numResults: 10, startPublishedDate: since, excludeDomains: ["ruokavirasto.fi", "facebook.com", "instagram.com", "x.com"], userLocation: "FI", contents: { highlights: true } });
    for (const r of results) {
      const blob = fold(`${r.title ?? ""} ${r.url} ${(r.highlights ?? []).join(" ")}`);
      if (!RECALL_WORDS.test(blob) || found.has(r.url)) continue;
      found.set(r.url, { url: r.url, title: (r.title ?? r.url).trim(), publishedOn: r.publishedDate?.slice(0, 10) });
    }
  }
  return [...found.values()];
}

/** Other pages about the same recall: the producer's own notice, a retailer's, the news. */
export async function corroborate(notice: Notice, deps: ReaderDeps): Promise<Notice["corroboration"]> {
  const products = notice.facts?.products ?? [];
  const words = new Set(products.flatMap((p) => nameTokens(`${p.brand?.value ?? ""} ${p.name.value}`)).filter((t) => t.length > 3));
  const eans = notice.facts?.eans ?? [];
  const what = products.slice(0, 3).map((p) => p.name.value).join(", ") || notice.title;
  const ref = notice.publishedOn ? new Date(`${notice.publishedOn}T00:00:00Z`) : deps.now();
  const results: ExaResult[] = await deps.exa.search({
    query: `${notice.language === "sv" ? "Återkallelse" : "Takaisinveto"}: ${what}. ${notice.title}`,
    type: "auto",
    numResults: 6,
    startPublishedDate: daysAgo(ref, 10),
    excludeDomains: ["ruokavirasto.fi"],
    contents: { highlights: true },
  });
  return results
    .filter((r) => {
      const blob = fold(`${r.title ?? ""} ${r.url} ${(r.highlights ?? []).join(" ")}`);
      const sharesWord = [...words].some((w) => blob.includes(w));
      return eans.some((e) => blob.includes(e)) || (sharesWord && RECALL_WORDS.test(blob));
    })
    .slice(0, 4)
    .map((r) => ({ url: r.url, title: (r.title ?? r.url).trim(), publishedOn: r.publishedDate?.slice(0, 10) ?? undefined, via: "exa" as const }));
}

// ---------- RASFF ----------

export type FeedItem = { notifId: number; reference: string; subject: string; publishedOn: string; classification: string; risk?: string; category?: string; countries: string[]; url: string };

type RasffRow = {
  notifId: number;
  reference: string;
  subject: string;
  ecValidationDate: string;
  notifyingCountry?: { isoCode?: string; organizationName?: string };
  originCountries?: { isoCode?: string; organizationName?: string }[];
  productCategory?: { description?: string };
  notificationClassification?: { description?: string };
  riskDecision?: { description?: string };
};

/** EU alerts that involve Finland (it notified, or the product came from Finland). The public list names no brands. */
export async function readRasff(source: SourceConfig, deps: ReaderDeps): Promise<FeedItem[]> {
  const body = JSON.stringify({ parameters: { pageNumber: 1, itemsPerPage: 100 } });
  const text = await fetchText("https://webgate.ec.europa.eu/rasff-window/backend/public/notification/search/consolidated/", { method: "POST", body, headers: { "content-type": "application/json", accept: "application/json" } }, deps.fetch, "rasff");
  let rows: RasffRow[];
  try {
    rows = (JSON.parse(text) as { notifications?: RasffRow[] }).notifications ?? [];
  } catch {
    throw new PartnerError("rasff", "bad_response", "RASFF Window sent something that is not JSON.");
  }
  const since = daysAgo(deps.now(), source.readWindowDays).slice(0, 10);
  return rows
    .map((r) => {
      const m = /^(\d{2})-(\d{2})-(\d{4})/.exec(r.ecValidationDate ?? "");
      const publishedOn = m ? `${m[3]}-${m[2]}-${m[1]}` : "";
      const countries = [r.notifyingCountry?.isoCode, ...(r.originCountries ?? []).map((c) => c.isoCode)].filter((c): c is string => !!c);
      return {
        notifId: r.notifId,
        reference: r.reference,
        subject: (r.subject ?? "").trim(),
        publishedOn,
        classification: r.notificationClassification?.description ?? "notification",
        risk: r.riskDecision?.description,
        category: r.productCategory?.description,
        countries: [...new Set(countries)],
        url: `https://webgate.ec.europa.eu/rasff-window/screen/notification/${r.notifId}`,
      };
    })
    .filter((x) => x.publishedOn >= since && x.countries.includes("FI"));
}
