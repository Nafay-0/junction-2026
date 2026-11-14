import type { MarketOutcome, PredictionMarketData, PricePoint } from "@/lib/widgets/types";
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

const DAY = 86_400_000;
const DAYS = 60;
// Daily snapshots ending 13 Nov 2026, 00:00 UTC.
const END_MS = Date.UTC(2026, 10, 13);

/** A daily probability path from `start` to `end`, with drift, noise and the odd news jump. */
function history(seed: number, start: number, end: number, noise: number): PricePoint[] {
  const rand = seeded(seed);
  const walk: number[] = [0];
  for (let i = 1; i < DAYS; i++) {
    const jump = rand() < 0.05 ? (rand() - 0.5) * noise * 8 : 0;
    walk.push(walk[i - 1] * 0.92 + (rand() - 0.5) * noise + jump);
  }
  const last = walk[DAYS - 1];
  return walk.map((w, i) => {
    const f = i / (DAYS - 1);
    const p = start + (end - start) * f + (w - last * f);
    return { t: END_MS - (DAYS - 1 - i) * DAY, v: Math.round(Math.min(0.99, Math.max(0.002, p)) * 1000) / 1000 };
  });
}

function outcome(name: string, seed: number, start: number, end: number, noise: number, volume: number): MarketOutcome {
  const h = history(seed, start, end, noise);
  const probability = h[h.length - 1].v;
  return { name, probability, change: Math.round((probability - h[0].v) * 1000) / 1000, history: h, volume };
}

export const marketFixture: PredictionMarketData = {
  kind: "market",
  title: "Presidential Election Winner 2028",
  url: "https://polymarket.com/event/presidential-election-winner-2028",
  image:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/af/WhiteHouseSouthFacade.JPG/320px-WhiteHouseSouthFacade.JPG",
  volume: 741_382_115,
  endDate: "2028-11-07",
  historyLabel: "Last 60 days",
  slug: "presidential-election-winner-2028",
  outcomes: [
    outcome("JD Vance", 3, 0.262, 0.283, 0.012, 48_210_455),
    outcome("Gavin Newsom", 11, 0.233, 0.192, 0.014, 39_884_102),
    outcome("Alexandria Ocasio-Cortez", 5, 0.061, 0.082, 0.008, 21_402_877),
    outcome("Marco Rubio", 17, 0.052, 0.061, 0.006, 18_350_210),
    outcome("Josh Shapiro", 29, 0.068, 0.049, 0.006, 16_077_491),
    outcome("Pete Buttigieg", 41, 0.046, 0.038, 0.005, 12_960_334),
  ],
  sources: [
    toSource({
      url: "https://polymarket.com/event/presidential-election-winner-2028",
      title: "Presidential Election Winner 2028 | Polymarket",
    }),
  ],
};

export const marketLoadingFixture: PredictionMarketData = {
  kind: "market",
  stage: "Reading live odds from Polymarket",
  title: "Presidential Election Winner 2028",
  url: "",
  outcomes: [],
  historyLabel: "",
  sources: [],
};
