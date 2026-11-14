import type { PricePoint, StockQuote, StocksData } from "@/lib/widgets/types";
import { toSource } from "@/lib/widgets/types";

/** Small seeded PRNG (mulberry32), so the fixture is identical on every import. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Intraday one-minute bars: an opening gap, a drift towards `close`, noise that is
 * louder near the open, and a couple of short bursts. The last point lands on `close`.
 */
function intraday({
  seed,
  startMs,
  points,
  open,
  close,
  volatility,
}: {
  seed: number;
  startMs: number;
  points: number;
  open: number;
  close: number;
  volatility: number;
}): PricePoint[] {
  const rand = seeded(seed);
  const gauss = () => {
    const u = Math.max(rand(), 1e-9);
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  // Random walk first, then bend it so it starts at `open` and ends at `close` (a Brownian bridge).
  const walk: number[] = [0];
  for (let i = 1; i < points; i++) {
    const openNoise = 1 + 1.6 * Math.exp(-i / 18);
    const burst = rand() < 0.04 ? gauss() * 3 : 0;
    walk.push(walk[i - 1] + (gauss() * openNoise + burst) * volatility);
  }
  const last = walk[points - 1];
  return walk.map((w, i) => {
    const f = i / (points - 1);
    const v = open + (close - open) * f + (w - last * f);
    return { t: startMs + i * 60_000, v: Math.round(v * 100) / 100 };
  });
}

function quote(input: {
  symbol: string;
  name: string;
  previousClose: number;
  series: PricePoint[];
  asOf: string;
  url: string;
}): StockQuote {
  const { series, previousClose } = input;
  const values = series.map((p) => p.v);
  const price = values[values.length - 1];
  const change = Math.round((price - previousClose) * 100) / 100;
  return {
    symbol: input.symbol,
    name: input.name,
    price,
    change,
    changePercent: Math.round((change / previousClose) * 10000) / 100,
    currency: "USD",
    asOf: input.asOf,
    open: values[0],
    high: Math.max(...values),
    low: Math.min(...values),
    previousClose,
    series,
    seriesLabel: "Today, 1-minute",
    url: input.url,
  };
}

// 13 Nov 2026, 09:30 ET (14:30 UTC; US daylight saving time ended on 1 Nov).
const OPEN_MS = Date.UTC(2026, 10, 13, 14, 30);
const POINTS = 120;

export const stocksFixture: StocksData = {
  kind: "stocks",
  quotes: [
    quote({
      symbol: "NVDA",
      name: "NVIDIA Corporation",
      previousClose: 208.36,
      series: intraday({ seed: 7, startMs: OPEN_MS, points: POINTS, open: 209.9, close: 213.42, volatility: 0.34 }),
      asOf: "13 Nov 2026, 11:29 ET",
      url: "https://finance.yahoo.com/quote/NVDA/",
    }),
    quote({
      symbol: "AAPL",
      name: "Apple Inc.",
      previousClose: 271.58,
      series: intraday({ seed: 21, startMs: OPEN_MS, points: POINTS, open: 271.1, close: 268.07, volatility: 0.27 }),
      asOf: "13 Nov 2026, 11:29 ET",
      url: "https://finance.yahoo.com/quote/AAPL/",
    }),
  ],
  sources: [
    toSource({ url: "https://finance.yahoo.com/quote/NVDA/", title: "NVIDIA Corporation (NVDA) Stock Price, News, Quote" }),
    toSource({ url: "https://finance.yahoo.com/quote/AAPL/", title: "Apple Inc. (AAPL) Stock Price, News, Quote" }),
    toSource({ url: "https://www.nasdaq.com/market-activity/stocks/nvda", title: "NVIDIA Corporation Common Stock (NVDA)" }),
  ],
};

export const stocksLoadingFixture: StocksData = {
  kind: "stocks",
  stage: "Fetching live quotes for NVDA and AAPL",
  quotes: [],
  sources: [],
};

/** A weekend: the market is closed, so each quote is its last close and there is no minute-by-minute line. */
export const stocksClosedFixture: StocksData = {
  kind: "stocks",
  quotes: [
    { symbol: "NVDA", name: "Nvidia Corp", price: 162.85, change: -3.34, changePercent: -2.01, currency: "USD", asOf: "the close on Fri 13 Nov", open: 169.89, high: 170, low: 158.39, previousClose: 166.19, series: [], seriesLabel: "Last close", url: "https://exa.ai/library/markets/stocks/NVDA", closed: true, volume: "362.49M" },
    { symbol: "AAPL", name: "Apple Inc", price: 356.27, change: 1.39, changePercent: 0.39, currency: "USD", asOf: "the close on Fri 13 Nov", open: 357.96, high: 360.83, low: 355.75, previousClose: 354.88, series: [], seriesLabel: "Last close", url: "https://exa.ai/library/markets/stocks/AAPL", closed: true, volume: "39.03M" },
  ],
  sources: [toSource({ url: "https://exa.ai/library/markets/stocks/NVDA", title: "NVDA market data (Exa)" }), toSource({ url: "https://exa.ai/library/markets/stocks/AAPL", title: "AAPL market data (Exa)" })],
};
