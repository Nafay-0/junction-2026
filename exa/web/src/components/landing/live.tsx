"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/*
 * The app's own cards, running on the landing page. Each one is the real widget a chat shows,
 * given sample data (the fixtures the widget gallery uses), so a visitor can hover a chart, pan
 * the map or switch a filter before they have an account.
 *
 * Three things keep that honest and light:
 * - A card's code is fetched only when it comes near the screen, and its place is held at a
 *   fixed height meanwhile, so nothing loads up front and nothing jumps.
 * - The page is public and signed out: nothing here may call our API. The price card would ask
 *   the server for fresh quotes every half minute; on this page those requests never leave the
 *   browser (see `keepToThePage`). It is answered with the sample quote moved by a few cents, so
 *   the card ticks the way it does in the app. The page says the numbers are examples.
 * - A card whose buttons would act for an account (the job's "Run now") is made inert.
 */

export type DemoName = "places" | "weather" | "stocks" | "flights" | "products" | "market" | "sift" | "research" | "job";

type Demo = React.ComponentType;

const LOADERS: Record<DemoName, () => Promise<Demo>> = {
  places: async () => {
    const [{ PlacesMap }, { placesFixture }] = await Promise.all([import("@/components/widgets/places-map"), import("@/lib/widgets/fixtures/places-map")]);
    return function PlacesDemo() {
      return <PlacesMap data={placesFixture} />;
    };
  },
  weather: async () => {
    const [{ Weather }, { weatherFixture }] = await Promise.all([import("@/components/widgets/weather"), import("@/lib/widgets/fixtures/weather")]);
    return function WeatherDemo() {
      return <Weather data={weatherFixture} />;
    };
  },
  stocks: async () => {
    const [{ Stocks }, { stocksFixture }] = await Promise.all([import("@/components/widgets/stocks"), import("@/lib/widgets/fixtures/stocks")]);
    for (const quote of stocksFixture.quotes) sampleQuotes.set(quote.symbol.toUpperCase(), { ...quote, series: [] });
    return function StocksDemo() {
      return <Stocks data={stocksFixture} />;
    };
  },
  flights: async () => {
    const [{ Flights }, { flightsFixture }] = await Promise.all([import("@/components/widgets/flights"), import("@/lib/widgets/fixtures/flights")]);
    return function FlightsDemo() {
      return <Flights data={flightsFixture} />;
    };
  },
  products: async () => {
    const [{ Products }, { productsFixture }] = await Promise.all([import("@/components/widgets/products"), import("@/lib/widgets/fixtures/products")]);
    return function ProductsDemo() {
      return <Products data={productsFixture} />;
    };
  },
  market: async () => {
    const [{ PredictionMarket }, { marketFixture }] = await Promise.all([import("@/components/widgets/market"), import("@/lib/widgets/fixtures/market")]);
    // Without its market's name the card shows what it was given and asks nobody for more.
    const data = { ...marketFixture, slug: undefined };
    return function MarketDemo() {
      return <PredictionMarket data={data} />;
    };
  },
  sift: async () => {
    const [{ Sift }, { siftFixture }] = await Promise.all([import("@/components/widgets/sift"), import("@/lib/widgets/fixtures/sift")]);
    return function SiftDemo() {
      return <Sift data={siftFixture} />;
    };
  },
  research: async () => {
    const [{ Research }, { researchFixture }] = await Promise.all([import("@/components/widgets/research"), import("@/lib/widgets/fixtures/research")]);
    return function ResearchDemo() {
      return <Research data={researchFixture} />;
    };
  },
  job: async () => {
    const [{ JobCard }, { jobCreatedFixture }] = await Promise.all([import("@/components/widgets/job-card"), import("@/lib/widgets/fixtures/job")]);
    return function JobDemo() {
      return <JobCard data={jobCreatedFixture} />;
    };
  },
};

/** Cards whose controls would act for an account: shown, not usable. */
const INERT = new Set<DemoName>(["job"]);

const loaded = new Map<DemoName, Demo>();

/* ───────── Nothing here calls the server ───────── */

type SampleQuote = { symbol: string; price: number; change: number; changePercent: number; previousClose?: number; series: unknown[] };
const sampleQuotes = new Map<string, SampleQuote>();
let kept = false;

/**
 * Requests to our own API never leave this page. The one a card makes by itself (fresh prices) is
 * answered here from the sample data, nudged a little each time; anything else gets an empty answer.
 */
function keepToThePage() {
  if (kept || typeof window === "undefined") return;
  kept = true;
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    let url: URL | null = null;
    try {
      url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
    } catch {
      url = null;
    }
    // Only while the landing page is what is on screen: a visitor who goes on to sign in from
    // here stays in the same page session, and from then on every request must go out as usual.
    if (!url || url.origin !== window.location.origin || !url.pathname.startsWith("/api/") || !document.querySelector(".landing")) return real(input, init);
    const quote = url.pathname === "/api/live/stock" ? sampleQuotes.get((url.searchParams.get("symbol") ?? "").toUpperCase()) : undefined;
    if (!quote) return Promise.resolve(new Response(null, { status: 204 }));
    // A step of a few hundredths of a percent, as a quiet market moves between two looks.
    const price = Math.round(quote.price * (1 + (Math.random() - 0.5) * 0.0012) * 100) / 100;
    const base = quote.previousClose ?? quote.price - quote.change;
    const next = { ...quote, price, change: Math.round((price - base) * 100) / 100, changePercent: Math.round(((price - base) / base) * 10000) / 100 };
    sampleQuotes.set(quote.symbol.toUpperCase(), next);
    return Promise.resolve(new Response(JSON.stringify(next), { headers: { "content-type": "application/json" } }));
  };
}

/* ───────── One card ───────── */

/** A real card with sample data. It loads when it comes near the screen; until then its place is kept. */
export function Live({ name, className }: { name: DemoName; className?: string }) {
  const holder = React.useRef<HTMLDivElement>(null);
  const [Card, setCard] = React.useState<Demo | null>(() => loaded.get(name) ?? null);

  React.useEffect(() => {
    if (Card) return;
    const el = holder.current;
    if (!el) return;
    let cancelled = false;
    const load = () => {
      keepToThePage();
      void LOADERS[name]().then((demo) => {
        loaded.set(name, demo);
        if (!cancelled) setCard(() => demo);
      });
    };
    if (typeof IntersectionObserver === "undefined") {
      load();
      return;
    }
    const watcher = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        watcher.disconnect();
        load();
      },
      { rootMargin: "600px 0px" },
    );
    watcher.observe(el);
    return () => {
      cancelled = true;
      watcher.disconnect();
    };
  }, [name, Card]);

  return (
    <div ref={holder} className={cn("text-left", className)} inert={INERT.has(name) ? true : undefined}>
      {Card ? <Card /> : <Waiting />}
    </div>
  );
}

/** The shape of a card that has not arrived yet. */
function Waiting() {
  return (
    <div aria-hidden className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <div className="flex items-center gap-3 px-4 pt-3.5 pb-3 sm:px-5">
        <span className="size-7 shrink-0 rounded-lg bg-muted" />
        <span className="flex-1 space-y-1.5">
          <span className="block h-3.5 w-2/5 rounded-full bg-muted" />
          <span className="block h-3 w-1/4 rounded-full bg-muted/70" />
        </span>
      </div>
      <div className="space-y-2.5 px-4 pb-5 sm:px-5">
        <span className="block h-36 rounded-xl bg-muted/60" />
        <span className="block h-3 w-4/5 rounded-full bg-muted/70" />
        <span className="block h-3 w-3/5 rounded-full bg-muted/70" />
      </div>
    </div>
  );
}
