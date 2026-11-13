/**
 * The contract between the agent's tools (server) and the widgets (client).
 *
 * Every tool returns one of these payloads, and the widget with the same name renders it.
 * Rules that hold for every payload:
 *  - `sources` lists where the data came from. A widget must show them.
 *  - `stage` is set only on preliminary (still loading) results and says what is happening.
 *  - Money is a number plus an ISO currency code. Times are ISO 8601 strings unless noted.
 */

/** A web page (or data provider) that a piece of information came from. */
export type Source = {
  url: string;
  title?: string;
  /** Hostname without "www.", for example "kela.fi". */
  domain: string;
  favicon?: string;
  publishedDate?: string;
  /** A short passage from the page that supports the claim. */
  snippet?: string;
};

/** Present on every tool output. */
export type WidgetBase = {
  /** Set while the tool is still working: a short present-tense line such as "Asking Jinko for live fares". */
  stage?: string;
  sources: Source[];
  /** What this call cost on Exa, in US dollars. */
  exaCostUsd?: number;
  /** Set when the tool could not get the data. The widget shows this instead of content. */
  error?: string;
};

/* ───────────────────────── Search and reading (activity rows, not cards) ───────────────────────── */

export type SearchResultItem = Source & {
  image?: string;
  highlights: string[];
};

export type WebSearchData = WidgetBase & {
  kind: "search";
  query: string;
  results: SearchResultItem[];
};

export type ReadPagesData = WidgetBase & {
  kind: "pages";
  pages: Array<Source & { characters: number; excerpt: string; text: string }>;
};

/* ───────────────────────── Places and maps ───────────────────────── */

export type Place = {
  id: string;
  name: string;
  /** For example "Thai Restaurant". */
  category?: string;
  description?: string;
  address?: string;
  /** Neighbourhood or city. */
  area?: string;
  lat: number;
  lng: number;
  /** 0 to 5. */
  rating?: number;
  reviewCount?: number;
  /** "Open", "Closed", "Temporarily closed". */
  status?: string;
  hours?: Array<{ day: string; hours: string }>;
  phone?: string;
  website?: string;
  image?: string;
  /** The page this record came from. */
  url: string;
  /** One line from the agent on why this place fits the request. */
  note?: string;
};

export type PlacesData = WidgetBase & {
  kind: "places";
  query: string;
  /** Human-readable search area, for example "Kamppi, Helsinki". */
  area?: string;
  places: Place[];
};

/* ───────────────────────── Travel ───────────────────────── */

export type FlightLeg = {
  from: string;
  to: string;
  /** ISO local date-time, for example "2026-12-05T14:00". */
  departAt: string;
  arriveAt: string;
  durationMinutes?: number;
  stops: number;
  airline?: string;
  flightNumber?: string;
};

export type FlightOption = {
  id: string;
  airline: string;
  price: number;
  currency: string;
  outbound: FlightLeg;
  inbound?: FlightLeg;
  /** Fare class and conditions, for example "Economy Light: no checked bag". */
  fareNote?: string;
  bookingUrl?: string;
  /** "Cheapest", "Fastest", "Best overall". */
  tag?: string;
};

export type FlightsData = WidgetBase & {
  kind: "flights";
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string;
  adults: number;
  options: FlightOption[];
  note?: string;
};

export type HotelOption = {
  id: string;
  name: string;
  address?: string;
  area?: string;
  lat?: number;
  lng?: number;
  stars?: number;
  /** Guest rating, 0 to 10. */
  rating?: number;
  reviewCount?: number;
  pricePerNight: number;
  totalPrice?: number;
  currency: string;
  image?: string;
  amenities?: string[];
  bookingUrl?: string;
  tag?: string;
  note?: string;
};

export type HotelsData = WidgetBase & {
  kind: "hotels";
  location: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  options: HotelOption[];
  note?: string;
};

/* ───────────────────────── Shopping ───────────────────────── */

export type Product = {
  id: string;
  title: string;
  brand?: string;
  image?: string;
  price?: number;
  currency?: string;
  /** The shop or site, for example "Verkkokauppa.com". */
  merchant: string;
  url: string;
  /** 0 to 5. */
  rating?: number;
  reviewCount?: number;
  availability?: string;
  specs?: Array<{ label: string; value: string }>;
  /** "Best value", "Top pick". */
  tag?: string;
  note?: string;
};

export type ProductsData = WidgetBase & {
  kind: "products";
  query: string;
  products: Product[];
  /** One or two sentences recommending a choice. */
  verdict?: string;
};

/* ───────────────────────── Markets ───────────────────────── */

export type PricePoint = {
  /** Unix time in milliseconds. */
  t: number;
  v: number;
};

export type StockQuote = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  currency: string;
  /** Human-readable, for example "13 Nov 2026, 16:00 ET". */
  asOf: string;
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
  series: PricePoint[];
  /** What the series covers: "Today, 1-minute" or "1 year, daily". */
  seriesLabel: string;
  url: string;
};

export type StocksData = WidgetBase & {
  kind: "stocks";
  quotes: StockQuote[];
};

export type MarketOutcome = {
  name: string;
  /** 0 to 1. */
  probability: number;
  /** Change in probability over the history window, in points of probability (-1 to 1). */
  change?: number;
  history: PricePoint[];
  volume?: number;
};

export type PredictionMarketData = WidgetBase & {
  kind: "market";
  title: string;
  url: string;
  image?: string;
  /** Total traded volume in US dollars. */
  volume?: number;
  endDate?: string;
  outcomes: MarketOutcome[];
  /** "Last 30 days". */
  historyLabel: string;
  /** How to re-fetch live odds from the browser: the Polymarket event slug. */
  slug?: string;
};

/* ───────────────────────── Images ───────────────────────── */

export type ImageItem = {
  url: string;
  title?: string;
  /** The page the image appears on. */
  pageUrl: string;
  domain: string;
};

export type ImagesData = WidgetBase & {
  kind: "images";
  query: string;
  images: ImageItem[];
};

/* ───────────────────────── Weather ───────────────────────── */

export type WeatherDay = {
  /** ISO date. */
  date: string;
  condition: string;
  highC: number;
  lowC: number;
  /** 0 to 100. */
  rainChance?: number;
  precipMm?: number;
  windKph?: number;
  windDirection?: string;
};

export type WeatherData = WidgetBase & {
  kind: "weather";
  location: string;
  days: WeatherDay[];
};

/* ───────────────────────── Research (parallel sub-agents) ───────────────────────── */

export type ResearchStep = {
  type: "search" | "read" | "think";
  label: string;
  /** Domains touched by this step, for favicons. */
  domains?: string[];
};

export type ResearchAgent = {
  id: string;
  /** The angle this sub-agent is working on. */
  title: string;
  status: "queued" | "working" | "done" | "failed";
  steps: ResearchStep[];
  /** Markdown, set when done. */
  findings?: string;
  sources: Source[];
};

export type ResearchData = WidgetBase & {
  kind: "research";
  question: string;
  status: "planning" | "researching" | "writing" | "done";
  agents: ResearchAgent[];
  /** Markdown report with inline links, set when done. */
  report?: string;
};

/* ───────────────────────── Widgets the model composes itself ───────────────────────── */

export type ComparisonData = WidgetBase & {
  kind: "comparison";
  title: string;
  /** Column headers: the things being compared. */
  columns: string[];
  /** One row per criterion; `values` lines up with `columns`. */
  rows: Array<{ label: string; values: string[] }>;
  /** Index of the recommended column, if any. */
  winner?: number;
  note?: string;
};

export type KeyFactsData = WidgetBase & {
  kind: "facts";
  title: string;
  facts: Array<{ label: string; value: string; detail?: string; sourceUrl?: string }>;
};

export type ActionItem = {
  label: string;
  description?: string;
  /** Decides the icon and how the link opens. */
  type: "link" | "book" | "call" | "email" | "directions" | "calendar" | "download";
  /** https:, tel:, mailto: or a maps URL. For "calendar", an https link to an .ics file or a Google Calendar template URL. */
  href: string;
  /** Marks the main action. */
  primary?: boolean;
};

export type ActionsData = WidgetBase & {
  kind: "actions";
  title?: string;
  actions: ActionItem[];
};

export type PlanStep = {
  title: string;
  status: "pending" | "active" | "done";
};

export type PlanData = {
  kind: "plan";
  steps: PlanStep[];
};

/* ───────────────────────── Clarifying questions (answered in the browser) ───────────────────────── */

export type ClarifyQuestion = {
  id: string;
  question: string;
  type: "single" | "multi" | "text";
  options?: Array<{ label: string; description?: string }>;
  placeholder?: string;
};

export type ClarifyInput = {
  intro?: string;
  questions: ClarifyQuestion[];
};

export type ClarifyAnswer = {
  answers: Record<string, string | string[]>;
  skipped?: boolean;
};

/* ───────────────────────── Helpers ───────────────────────── */

/** Props every widget component takes. */
export type WidgetProps<T> = {
  data: T;
  /** True while the tool is still running; `data` may be partial. */
  loading?: boolean;
};

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function faviconOf(url: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domainOf(url))}&sz=64`;
}

export function toSource(input: { url: string; title?: string | null; publishedDate?: string | null; snippet?: string }): Source {
  return {
    url: input.url,
    title: input.title ?? undefined,
    domain: domainOf(input.url),
    favicon: faviconOf(input.url),
    publishedDate: input.publishedDate ?? undefined,
    snippet: input.snippet,
  };
}
