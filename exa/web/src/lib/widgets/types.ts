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
  /** Whether it is open right now, in the place's own time zone: "Open until 9 PM", "Closed now", "Temporarily closed". Unset when unknown. */
  status?: string;
  hours?: Array<{ day: string; hours: string }>;
  phone?: string;
  website?: string;
  image?: string;
  /** The page this record came from. */
  url: string;
  /** One line from the agent on why this place fits the request. */
  note?: string;
  /** Straight-line distance from the user, in metres, when their exact location is known. */
  distanceM?: number;
};

export type PlacesData = WidgetBase & {
  kind: "places";
  query: string;
  /** Human-readable search area, for example "Kamppi, Helsinki". */
  area?: string;
  places: Place[];
  /** The user's own position, when they have shared it: drawn on the map and used for directions. */
  origin?: { lat: number; lng: number; label?: string };
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
  /**
   * The market is closed (an evening, a weekend, a holiday): `price` is the last session's close
   * and `asOf` names that session. There is no minute-by-minute series then.
   */
  closed?: boolean;
  /** Shares traded in that session, as the source writes it: "362.49M". */
  volume?: string;
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
  /** A search at depth: how many pages it turned up, and how many of them bore on the angle and were kept. */
  checked?: number;
  kept?: number;
};

export type ResearchAgent = {
  id: string;
  /** The angle this sub-agent is working on. */
  title: string;
  status: "queued" | "working" | "done" | "failed";
  steps: ResearchStep[];
  /** How many steps it has taken, when `steps` carries only the latest of them (a large team, while the report is written). */
  stepCount?: number;
  /** Markdown, set when done. */
  findings?: string;
  /** The sources shown beside this angle: the first few it kept. `sourceCount` is how many it kept in all. */
  sources: Source[];
  sourceCount?: number;
  /** 2 for a sub-agent sent in the second round, to close a gap the first round left. */
  round?: 1 | 2;
  /** Second round: what the lead wanted settled, in a sentence. */
  why?: string;
};

export type ResearchData = WidgetBase & {
  kind: "research";
  question: string;
  status: "planning" | "researching" | "writing" | "done";
  agents: ResearchAgent[];
  /** Markdown report with inline links, set when done. */
  report?: string;
  /** How deep this went: "Standard", "Deep", "Deeper" or "Exhaustive". Unset on older reports. */
  depth?: string;
  /** Which round the team is in. Only set when the depth has a second round. */
  round?: 1 | 2;
  /** Distinct pages the searches turned up, and how many of them were kept as sources. `sources` lists the kept ones, up to a few hundred. */
  pagesChecked?: number;
  sourceCount?: number;
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

/* ───────────────────────── Sift: many pages, each checked against every wish ───────────────────────── */

/** From this confidence up a verdict is shown as certain; below it, as "probably". */
export const SIFT_SURE = 0.8;

/** How one page answers one wish. */
export type SiftVerdict = {
  /** "yes": the page says so. "no": it says otherwise. "unknown": the page does not say. */
  answer: "yes" | "no" | "unknown";
  /** How sure the judge is of that answer, 0 to 1. */
  confidence: number;
};

export type SiftItem = Source & {
  image?: string;
  /** One verdict per wish, in the order of `wishes`. Missing while the pages are still being checked. */
  verdicts?: SiftVerdict[];
};

export type SiftData = WidgetBase & {
  kind: "sift";
  title: string;
  /** What one result is, singular: "a recipe", "a job ad", "a review of one laptop". */
  what: string;
  wishes: Array<{
    /** Two or three words, the column heading: "Under 30 min". */
    label: string;
    /** The statement each page was checked against: "the recipe takes 30 minutes or less". */
    test: string;
  }>;
  /** The pages that are one such thing, best fit first. */
  items: SiftItem[];
  /** How many pages were read and checked. */
  checked: number;
  /** How many of those were left out because they were not one such thing: a list, a shop front, an empty page. */
  skipped?: number;
  /** How many single yes-or-no judgements were made, and how long they took together, in milliseconds. */
  judgements?: number;
  judgedMs?: number;
  /** Set when the pages were found but could not be checked. The items are then in search order, without verdicts. */
  unjudged?: string;
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

/* ───────────────────────── Custom widget (composed by the model, block by block) ─────────────────────────
 * For anything the fixed widgets do not cover: a pie chart, a small dashboard, a timeline with
 * buttons, a calculator. The model sends a title and a list of blocks; each block is one piece of
 * interface. Blocks are deliberately one flat shape with optional fields (not a union), because that
 * is the schema every model family accepts. `type` says which fields matter.
 */

export type CustomChartType = "pie" | "donut" | "bar" | "stackedBar" | "horizontalBar" | "line" | "area" | "scatter" | "radar";

export type CustomButton = {
  label: string;
  /** "link" opens `value` (a URL) in a new tab. "ask" sends `value` to the agent as the user's next message. "copy" copies `value`. */
  action: "link" | "ask" | "copy";
  value: string;
  /** The main action: drawn filled. */
  primary?: boolean;
};

export type CustomItem = {
  label: string;
  /** stats: the big number or short fact. list: text on the right. progress: text shown beside the bar. */
  value?: string;
  /** A second, quieter line. */
  detail?: string;
  /** Makes the item a link. */
  href?: string;
  /** stats: an arrow for the direction of change. */
  trend?: "up" | "down" | "flat";
  /** stats: whether the change is good news, which sets the colour. Default: up is good, down is bad. */
  good?: boolean;
  /** progress: how full the bar is, 0 to 100. */
  percent?: number;
};

export type CustomBlock = {
  type: "text" | "stats" | "chart" | "table" | "list" | "progress" | "image" | "buttons" | "callout" | "html";
  /** "half" lets two consecutive blocks sit side by side on wide screens. Default "full". */
  width?: "full" | "half";
  /** A small heading above the block. */
  title?: string;

  /** text: markdown. callout: one or two plain sentences. */
  text?: string;
  /** callout: its colour. */
  tone?: "info" | "success" | "warning";

  /** stats, list and progress: the entries. */
  items?: CustomItem[];
  /** list: how entries are marked. Default "bullets". "timeline" draws a vertical line with a dot per entry (label = when, value/detail = what). */
  listStyle?: "bullets" | "numbers" | "checks" | "timeline";

  /** chart: which kind. */
  chartType?: CustomChartType;
  /** chart: the category for each data point (slice names for pie and donut, x-axis labels otherwise; for scatter, the x values as numbers in strings). */
  labels?: string[];
  /** chart: one or more named series; `values` lines up with `labels`. Pie and donut use the first series only. */
  series?: Array<{ name: string; values: number[] }>;
  /** chart: unit shown with values, for example "€", "%", "km". */
  unit?: string;

  /** table: header cells. */
  columns?: string[];
  /** table: body rows; each row lines up with `columns`. */
  rows?: string[][];

  /** image: the image address (https). */
  url?: string;
  /** image: a line under it. */
  caption?: string;

  /** buttons: the buttons, in order. */
  buttons?: CustomButton[];

  /**
   * html: a self-contained fragment (HTML, inline CSS and JS) run in a sandboxed frame with no
   * network access, for things no other block can express: a calculator, a custom diagram, a
   * small simulation.
   */
  html?: string;
  /** html: starting height in pixels; the frame then grows to fit its content. */
  height?: number;
};

export type CustomData = WidgetBase & {
  kind: "custom";
  title: string;
  subtitle?: string;
  blocks: CustomBlock[];
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

/* ───────────────────────── Location request (answered in the browser) ───────────────────────── */

/** The user's exact position, as shared through the browser. */
export type ExactLocation = {
  lat: number;
  lng: number;
  /** Radius of uncertainty in metres, as reported by the device. */
  accuracyM?: number;
  /** "Otaniemi, Espoo, Finland". */
  label?: string;
  /** Two-letter country code. */
  country?: string;
  /** When it was read, Unix milliseconds. */
  at: number;
};

export type LocationRequestInput = {
  /** Why the agent wants the location, in one short sentence. */
  reason?: string;
};

export type LocationAnswer =
  | ({ status: "granted" } & ExactLocation)
  | {
      /** "denied": the user or browser said no. "unavailable": the device could not get a fix. "declined": the user chose not to share. */
      status: "denied" | "unavailable" | "declined";
      /** A place the user typed or chose instead, for example "Tapiola, Espoo". */
      place?: string;
    };

/* ───────────────────────── Helpers ───────────────────────── */

/** Props every widget component takes. */
/**
 * A scheduled job, as the chat shows it after the agent made, changed, listed or deleted one.
 * The job itself is described in lib/jobs/types.ts.
 */
export type JobCardData = WidgetBase & {
  kind: "job";
  /** "refused": nothing was done, and `error` says why. */
  action: "created" | "updated" | "deleted" | "list" | "refused";
  job?: import("@/lib/jobs/types").JobItem;
  /** For "list": every job the account has. */
  jobs?: Array<import("@/lib/jobs/types").JobItem>;
  /** The next few runs (ms since 1970), so the user sees what the schedule really means. */
  nextRuns?: number[];
  /** While the job is being set up: what the agent is making. */
  draft?: { title?: string; scheduleText?: string };
};

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
