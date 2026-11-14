import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { exaContents, exaSearch, type ExaMeter } from "@/lib/exa/client";
import { toSource, type MarketOutcome, type PredictionMarketData, type PricePoint, type Source, type StockQuote, type StocksData } from "@/lib/widgets/types";
import { clip, errorMessage, type ToolContext } from "./context";
import { runStructured } from "./structured";

/* ───────────────────────── Stocks ─────────────────────────
 * Exa serves a live market page per US ticker (exa.ai/library/markets/stocks/NVDA) with the
 * day's trading and minute-by-minute prices. One Contents call returns it in about 300 ms.
 */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** US market time to a UTC timestamp. Eastern time is UTC-5 in winter and UTC-4 from mid-March to early November. */
function easternToMs(year: number, monthIndex: number, day: number, hhmmss: string): number {
  const [h, m, s] = hhmmss.split(":").map(Number);
  const dst = monthIndex > 2 && monthIndex < 10 ? true : monthIndex === 2 ? day >= 14 : monthIndex === 10 ? day < 7 : false;
  return Date.UTC(year, monthIndex, day, h + (dst ? 4 : 5), m, s || 0);
}

const money = (s: string | undefined) => (s ? Number(s.replace(/[$,]/g, "")) : undefined);

export function parseStockPage(text: string, url: string, symbol: string): StockQuote | null {
  const head = text.match(/^#\s+([A-Z.\-]+)\s+[—-]\s+(.+)$/m);
  const line = text.match(/is currently at \$([\d,.]+), (up|down|unchanged)[^$]*(?:\$([\d,.]+))?\s*\([+\-−]?([\d.]+)%\)[^,]*, as of ([A-Za-z]+) (\d{1,2}), (\d{4})/);
  if (!line) return parseClosedPage(text, url, symbol, head);
  const price = money(line[1])!;
  const sign = line[2] === "down" ? -1 : 1;
  const change = sign * (money(line[3]) ?? 0);
  const changePercent = sign * Number(line[4]);
  const monthIndex = MONTHS.indexOf(line[5].toLowerCase());
  const day = Number(line[6]);
  const year = Number(line[7]);

  const section = (title: string) => text.split(new RegExp(`^##\\s+${title}\\s*$`, "m"))[1]?.split(/^##\s/m)[0] ?? "";
  const pick = (block: string, label: string) => money(block.match(new RegExp(`${label}:\\s*\\$([\\d,.]+)`))?.[1]);
  const today = section("Today's Trading");
  const previous = section("Previous Close");

  const series: PricePoint[] = [];
  for (const m of section("Price History").matchAll(/^\|\s*(\d{2}:\d{2}:\d{2})\s*\|\s*\$([\d,.]+)\s*\|/gm)) {
    series.push({ t: easternToMs(year, monthIndex, day, m[1]), v: Number(m[2].replace(/,/g, "")) });
  }
  series.sort((a, b) => a.t - b.t);
  const last = series.at(-1);
  const asOfTime = last ? new Date(last.t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" }) : "";
  return {
    symbol: head?.[1] ?? symbol,
    name: titleName(head?.[2] ?? symbol),
    price,
    change,
    changePercent,
    currency: "USD",
    asOf: `${day} ${line[5].slice(0, 3)} ${year}${asOfTime ? `, ${asOfTime} ET` : ""}`,
    open: pick(today, "Open"),
    high: pick(today, "High"),
    low: pick(today, "Low"),
    previousClose: pick(previous, "Close"),
    series,
    seriesLabel: "Latest session, 1-minute prices",
    url,
  };
}

/**
 * The page as it reads while the market is closed (an evening, a weekend, a holiday):
 *   "NVIDIA CORP (NVDA) closed at $162.85, down $3.34 (2.01%) on Fri, Nov 13."
 * followed by that session's open, high, low, close and volume. There is no minute-by-minute
 * table then. The last close is still an answer: it is returned, marked as closed.
 */
function parseClosedPage(text: string, url: string, symbol: string, head: RegExpMatchArray | null): StockQuote | null {
  // An up day is written with plus signs ("up +$1.39 (+0.39%)"), a down day without ("down $3.34 (2.01%)").
  const line = text.match(/closed at \$([\d,.]+)(?:,\s*(up|down|unchanged)(?:[^$(\n]*\$([\d,.]+))?\s*(?:\([+\-−]?([\d.]+)%\))?)?\s+on\s+([A-Za-z]{3,9}),?\s+([A-Za-z]{3,9})\.?\s+(\d{1,2})/);
  if (!line) return null;
  const price = money(line[1]);
  if (price === undefined || !Number.isFinite(price)) return null;
  const sign = line[2] === "down" ? -1 : 1;
  const section = (title: string) => text.split(new RegExp(`^##\\s+${title}\\s*$`, "m"))[1]?.split(/^##\s/m)[0] ?? "";
  const pick = (block: string, label: string) => money(block.match(new RegExp(`${label}:\\s*\\$([\\d,.]+)`))?.[1]);
  const session = section("Trading Session");
  const previousClose = pick(section("Previous Close"), "Close");
  // The page gives the change; when it does not, it follows from the close before.
  const change = line[3] !== undefined ? sign * (money(line[3]) ?? 0) : previousClose !== undefined ? Math.round((price - previousClose) * 100) / 100 : 0;
  const changePercent = line[4] !== undefined ? sign * Number(line[4]) : previousClose ? Math.round(((price - previousClose) / previousClose) * 10000) / 100 : 0;
  return {
    symbol: head?.[1] ?? symbol,
    name: titleName(head?.[2] ?? symbol),
    price,
    change,
    changePercent,
    currency: "USD",
    asOf: `the close on ${line[5].slice(0, 3)} ${Number(line[7])} ${line[6].slice(0, 3)}`,
    open: pick(session, "Open"),
    high: pick(session, "High"),
    low: pick(session, "Low"),
    previousClose,
    series: [],
    seriesLabel: "Last close",
    url,
    closed: true,
    volume: session.match(/Volume:\s*([\d.,]+\s?[KMBT]?)/)?.[1]?.trim(),
  };
}

function titleName(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => (/^(INC|CORP|CO|LTD|PLC|ETF|ADR|SA|NV|AG|LLC)\.?$/.test(w) ? w.charAt(0) + w.slice(1).toLowerCase() : w.length <= 4 && w === w.toUpperCase() && !/[AEIOU]/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(" ");
}

export async function fetchStockQuote(symbolInput: string, opts: { meter?: ExaMeter; signal?: AbortSignal } = {}): Promise<StockQuote> {
  const symbol = symbolInput.trim().toUpperCase().replace(/[^A-Z.\-]/g, "");
  if (!symbol) throw new Error("No ticker symbol given.");
  const url = `https://exa.ai/library/markets/stocks/${symbol}`;
  const res = await exaContents({ urls: [url], text: { maxCharacters: 12000 } }, { ...opts, cache: false });
  const page = res.results[0];
  const quote = page?.text ? parseStockPage(page.text, url, symbol) : null;
  if (!quote) throw new Error(`No live market data for ${symbol}. Exa's market pages cover US-listed tickers.`);
  return quote;
}

const historySchema = {
  type: "object",
  required: ["points"],
  properties: {
    points: {
      type: "array",
      description: "Daily closing prices, oldest first",
      items: { type: "object", required: ["date", "close"], properties: { date: { type: "string", description: "YYYY-MM-DD" }, close: { type: "number" } } },
    },
  },
};

const RANGE_LABEL = { "1m": "Last month, daily close", "6m": "Last 6 months, daily close", "1y": "Last year, daily close" } as const;

export function getStocksTool(ctx: ToolContext) {
  return tool({
    description:
      "Get live stock prices for one or more US-listed tickers and show an interactive price chart that keeps updating. " +
      "Default is the latest session minute by minute (about a second). Longer ranges take about 20 seconds. " +
      "While the US market is closed (evenings, weekends, holidays) it returns the last close and says so: that is the answer then, not a failure.",
    inputSchema: z.object({
      symbols: z.array(z.string()).min(1).max(4).describe('Ticker symbols, for example ["NVDA","AAPL"]. Use the US listing or ADR.'),
      range: z.enum(["today", "1m", "6m", "1y"]).optional().describe("Chart range. Default today."),
    }),
    execute: async ({ symbols, range }, { abortSignal }): Promise<StocksData> => {
      const settled = await Promise.allSettled(
        symbols.map(async (s) => {
          const quote = await fetchStockQuote(s, { meter: ctx.meter, signal: abortSignal });
          if (range && range !== "today") {
            try {
              const { data } = await runStructured<{ points?: Array<{ date: string; close: number }> }>(
                ctx,
                { query: `Daily closing prices of ${quote.symbol} stock for the ${RANGE_LABEL[range].split(",")[0].toLowerCase()}, one point per trading day (weekly is fine for a year).`, schema: historySchema, providers: ["financial_datasets"], effort: "minimal" },
                abortSignal,
              );
              const points = (data.points ?? []).map((p) => ({ t: Date.parse(p.date), v: p.close })).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
              if (points.length > 5) return { ...quote, series: points, seriesLabel: RANGE_LABEL[range] };
            } catch {
              /* fall back to the intraday series */
            }
          }
          return quote;
        }),
      );
      const quotes = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      const failed = settled.flatMap((r, i) => (r.status === "rejected" ? [symbols[i].toUpperCase()] : []));
      return {
        kind: "stocks",
        quotes,
        sources: quotes.map((q) => toSource({ url: q.url, title: `${q.symbol} live market data (Exa)` })),
        error: quotes.length === 0 ? `No live market data for ${failed.join(", ")}. Exa's market pages cover US-listed tickers.` : undefined,
      };
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value: output.error
        ? output.error
        : (output.quotes.every((q) => q.closed)
            ? "The US stock market is closed right now, so there is no live price: the card shows the last close and says so. Tell the user in one short sentence that the market is closed and which day's close this is. Do not call it a live or current price, and do not repeat the numbers in a table.\n"
            : "A live chart is now shown to the user. Do not repeat the numbers in a table; comment in a sentence or two.\n") +
          output.quotes
            .map((q) =>
              q.closed
                ? `${q.symbol} (${q.name}): closed at ${q.price} USD, ${q.change >= 0 ? "+" : ""}${q.change} (${q.changePercent}%) on that day, at ${q.asOf}. That session: open ${q.open}, high ${q.high}, low ${q.low}${q.volume ? `, volume ${q.volume}` : ""}. The close before it: ${q.previousClose}.`
                : `${q.symbol} (${q.name}): ${q.price} USD, ${q.change >= 0 ? "+" : ""}${q.change} (${q.changePercent}%) as of ${q.asOf}. Open ${q.open}, high ${q.high}, low ${q.low}, previous close ${q.previousClose}.`,
            )
            .join("\n"),
    }),
  });
}

/* ───────────────────────── Prediction markets ─────────────────────────
 * Odds and price history come from Polymarket's public API, so the chart is instant and can
 * refresh live. Exa then finds this week's reporting on the question, so the agent can say
 * why the odds moved and cite it.
 */

type GammaMarket = {
  question?: string;
  groupItemTitle?: string;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  volumeNum?: number;
  active?: boolean;
  closed?: boolean;
};
type GammaEvent = { title: string; slug: string; image?: string; volume?: number; endDate?: string; closed?: boolean; markets?: GammaMarket[] };

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(10_000);
  const res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Polymarket returned ${res.status}.`);
  return (await res.json()) as T;
}

const parseList = (s: string | undefined): string[] => {
  try {
    return s ? (JSON.parse(s) as string[]) : [];
  } catch {
    return [];
  }
};

async function history(tokenId: string, signal?: AbortSignal): Promise<PricePoint[]> {
  try {
    const data = await getJson<{ history?: Array<{ t: number; p: number }> }>(`https://clob.polymarket.com/prices-history?market=${tokenId}&interval=1m&fidelity=360`, signal);
    return (data.history ?? []).map((h) => ({ t: h.t * 1000, v: h.p }));
  } catch {
    return [];
  }
}

async function buildMarket(ev: GammaEvent, signal?: AbortSignal): Promise<PredictionMarketData> {
  const open = (ev.markets ?? []).filter((m) => m.active !== false && !m.closed);
  type Candidate = { name: string; probability: number; token?: string; volume?: number };
  let candidates: Candidate[];
  if (open.length === 1) {
    const m = open[0];
    const names = parseList(m.outcomes);
    const prices = parseList(m.outcomePrices).map(Number);
    const tokens = parseList(m.clobTokenIds);
    candidates = names.map((name, i) => ({ name, probability: prices[i] ?? 0, token: tokens[i], volume: m.volumeNum }));
  } else {
    candidates = open.map((m) => ({
      name: m.groupItemTitle || m.question || "Outcome",
      probability: Number(parseList(m.outcomePrices)[0] ?? 0),
      token: parseList(m.clobTokenIds)[0],
      volume: m.volumeNum,
    }));
  }
  candidates = candidates.filter((c) => Number.isFinite(c.probability)).sort((a, b) => b.probability - a.probability).slice(0, 8);
  const histories = await Promise.all(candidates.map((c, i) => (i < 6 && c.token ? history(c.token, signal) : Promise.resolve([]))));
  const outcomes: MarketOutcome[] = candidates.map((c, i) => {
    const h = histories[i];
    return { name: c.name, probability: c.probability, history: h, change: h.length > 1 ? c.probability - h[0].v : undefined, volume: c.volume };
  });
  const url = `https://polymarket.com/event/${ev.slug}`;
  return {
    kind: "market",
    title: ev.title,
    url,
    image: ev.image,
    volume: typeof ev.volume === "number" ? ev.volume : undefined,
    endDate: ev.endDate,
    outcomes,
    historyLabel: "Last 30 days",
    slug: ev.slug,
    sources: [toSource({ url, title: `${ev.title} (Polymarket)` })],
  };
}

export async function fetchMarketBySlug(slugInput: string, signal?: AbortSignal): Promise<PredictionMarketData> {
  const slug = slugInput.replace(/[^a-z0-9-]/gi, "");
  const events = await getJson<GammaEvent[]>(`https://gamma-api.polymarket.com/events?slug=${slug}`, signal);
  if (!events[0]) throw new Error("That market was not found.");
  return buildMarket(events[0], signal);
}

async function findMarket(query: string, signal?: AbortSignal): Promise<PredictionMarketData> {
  const data = await getJson<{ events?: GammaEvent[] }>(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(query)}&limit_per_type=6`, signal);
  const events = (data.events ?? []).filter((e) => (e.markets ?? []).some((m) => m.active !== false && !m.closed));
  if (events.length === 0) throw new Error(`No open prediction market found for "${query}".`);
  return buildMarket(events[0], signal);
}

export function getPredictionMarketTool(ctx: ToolContext) {
  return tool({
    description:
      "Look up a prediction market on Polymarket: current odds for each outcome, 30-day history as a live chart, and this week's news that explains the moves. " +
      "Use it for 'what are the odds', elections, sports outcomes, economic events and anything people bet on.",
    inputSchema: z.object({
      query: z.string().describe('The event in a few words, for example "2028 US presidential election winner" or "Fed rate cut December".'),
    }),
    execute: async ({ query }, { abortSignal }): Promise<PredictionMarketData & { news?: Array<Source & { quote: string }> }> => {
      try {
        const market = await findMarket(query, abortSignal);
        let news: Array<Source & { quote: string }> = [];
        try {
          const res = await exaSearch(
            {
              query: `Latest news and analysis on: ${market.title}`,
              objective: "Recent reporting that explains what changed the outlook for this event. Prefer major news outlets.",
              category: "news",
              numResults: 4,
              startPublishedDate: new Date(Date.now() - 10 * 86_400_000).toISOString(),
              contents: { highlights: { maxCharacters: 600 } },
            },
            { meter: ctx.meter, signal: abortSignal },
          );
          news = res.results.map((r) => ({ ...toSource({ ...r, snippet: clip(r.highlights?.[0], 260) }), quote: clip(r.highlights?.[0], 600) }));
        } catch {
          /* the chart still works without news */
        }
        const newsSources: Source[] = news.map((n) => ({ url: n.url, title: n.title, domain: n.domain, favicon: n.favicon, publishedDate: n.publishedDate, snippet: n.snippet }));
        return { ...market, sources: [...market.sources, ...newsSources], news };
      } catch (err) {
        return { kind: "market", title: query, url: "https://polymarket.com", outcomes: [], historyLabel: "", sources: [], error: errorMessage(err) };
      }
    },
    toModelOutput: ({ output }) => {
      if (output.error) return { type: "text", value: output.error };
      const odds = output.outcomes
        .slice(0, 6)
        .map((o) => `${o.name}: ${(o.probability * 100).toFixed(1)}%${o.change !== undefined ? ` (${o.change >= 0 ? "+" : ""}${(o.change * 100).toFixed(1)} pts in 30 days)` : ""}`)
        .join("\n");
      const news = (output.news ?? []).map((n) => `- ${n.title} (${n.url}${n.publishedDate ? `, ${n.publishedDate.slice(0, 10)}` : ""})\n  > ${n.quote}`).join("\n");
      return {
        type: "text",
        value:
          `A live odds chart for "${output.title}" is now shown to the user. Do not list all the odds again. ` +
          `In two or three sentences say what the market implies and, citing the news below, why it moved.\n\n${odds}\n\nRecent news:\n${news || "none found"}`,
      };
    },
  });
}
