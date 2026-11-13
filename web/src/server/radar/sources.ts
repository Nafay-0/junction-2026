/**
 * The recall radar's sources and budgets: the one configuration file.
 *
 * Every place the radar looks, how often, through which partner, and what it may spend. Adding a source is adding
 * an entry here (and, for a new kind of page, a reader in readers.ts). Nothing else reads a URL or an interval.
 *
 * Who does what:
 *   Context.dev  reads one specific page into clean structured data: the authority's listing (a CSS parser, 1
 *                credit), each notice (Markdown + JSON extraction against our schema, 5 credits), and watches the
 *                listing for changes with a page monitor (1 credit per run, management calls are free).
 *   Exa          finds notices and corroborating pages across the web by meaning and date: producers' and
 *                retailers' own recall notices, which often come out before the authority's, and other pages
 *                about the same recall.
 *   RASFF        the EU rapid alert system's public JSON, read directly (an API, not a page).
 *   drill        a notice page this project hosts itself, in the authority's format, marked as a drill.
 */

export type SourceId = "ruokavirasto-fi" | "ruokavirasto-sv" | "exa-web" | "rasff" | "drill";

export type SourceKind =
  /** An authority's list of recall notices, each linking to a notice page. */
  | "authority_listing"
  /** A web search for producers' and retailers' own notices. */
  | "web_search"
  /** A structured alert feed (JSON). */
  | "alert_feed";

export type SourceConfig = {
  id: SourceId;
  name: string;
  /** Who publishes it, in plain words. */
  publisher: string;
  kind: SourceKind;
  language: "fi" | "sv" | "en";
  /** The page a person opens to see the same list. */
  homeUrl: string;
  /** Minutes between full checks the radar makes itself. */
  checkEveryMinutes: number;
  /** A Context.dev page monitor on the listing, polled for changes between checks (free to poll). */
  monitor?: { everyMinutes: number; includeSelectors: string[] };
  /** Only notices published within this many days are read (backfill on first run). */
  readWindowDays: number;
  /** At most this many notice pages read per check (each costs Context.dev credits). */
  maxReadsPerCheck: number;
  /** False for language versions of another source: a second reading of the same authority, not a second opinion. */
  independent: boolean;
  drill?: boolean;
  /** Plain words for the operations screen. */
  about: string;
};

export const SOURCES: SourceConfig[] = [
  {
    id: "ruokavirasto-fi",
    name: "Ruokavirasto: takaisinvedot",
    publisher: "Finnish Food Authority (Ruokavirasto)",
    kind: "authority_listing",
    language: "fi",
    homeUrl: "https://www.ruokavirasto.fi/takaisinvedot/",
    checkEveryMinutes: 120,
    monitor: { everyMinutes: 30, includeSelectors: [".content-list-block"] },
    readWindowDays: 320,
    maxReadsPerCheck: 60,
    independent: true,
    about: "The authority's recall list in Finnish. Context.dev watches it every 30 minutes; each new notice is read into facts.",
  },
  {
    id: "ruokavirasto-sv",
    name: "Livsmedelsverket (FI): återkallelser",
    publisher: "Finnish Food Authority, Swedish-language pages",
    kind: "authority_listing",
    language: "sv",
    homeUrl: "https://www.ruokavirasto.fi/sv/aterkallelser/",
    checkEveryMinutes: 240,
    readWindowDays: 30,
    maxReadsPerCheck: 10,
    independent: false,
    about: "The same authority in Swedish. Read so Swedish-speaking kitchens see the authority's own Swedish words; paired with the Finnish notice.",
  },
  {
    id: "exa-web",
    name: "Producers' and retailers' notices",
    publisher: "Found on the open web by Exa",
    kind: "web_search",
    language: "fi",
    homeUrl: "https://exa.ai",
    checkEveryMinutes: 360,
    readWindowDays: 14,
    maxReadsPerCheck: 4,
    independent: true,
    about: "Exa searches the web by meaning and date for recall notices from producers and shops (Finnish and Swedish). Context.dev reads each find into facts.",
  },
  {
    id: "rasff",
    name: "EU RASFF Window",
    publisher: "European Commission, rapid alert system for food and feed",
    kind: "alert_feed",
    language: "en",
    homeUrl: "https://webgate.ec.europa.eu/rasff-window/screen/search",
    checkEveryMinutes: 180,
    readWindowDays: 21,
    maxReadsPerCheck: 0,
    independent: true,
    about: "EU alerts where Finland notified or the product came from Finland. The public feed names no brands, so it can inform staff but never match a product by itself.",
  },
  {
    id: "drill",
    name: "Drill notices (this project's own page)",
    publisher: "Dock recall drill: NOT A REAL RECALL",
    kind: "authority_listing",
    language: "fi",
    homeUrl: "/ui-api/radar/drill",
    checkEveryMinutes: 60,
    readWindowDays: 2,
    maxReadsPerCheck: 3,
    independent: true,
    drill: true,
    about: "A page Dock hosts in the authority's layout. Staff publish a test notice there; the radar picks it up through the same reader and matching as a real one.",
  },
];

export function sourceOf(id: string): SourceConfig | undefined {
  return SOURCES.find((s) => s.id === id);
}

/**
 * Spending limits. A weekend of the radar running, by these numbers: the Finnish monitor 48 runs a day, two full
 * listing checks a day per listing, a first backfill of ~40 notices (5 credits each), then a few new notices a day.
 * About 600 Context.dev credits over three days of 50,000, and a few cents of Exa.
 */
export const BUDGET = {
  /** Hard stop for Context.dev credits this process may spend (per process start). */
  contextDevCreditsPerProcess: 2_500,
  /** Hard stop for Exa spend per process start, in US dollars. */
  exaDollarsPerProcess: 3,
  /** Corroboration searches per new authority notice. */
  corroborationPerNotice: 1,
  /** Only notices this new are corroborated (older ones are history). */
  corroborateWithinDays: 21,
  /** How often the radar looks at the Context.dev monitors' runs (free management calls). */
  monitorPollSeconds: 60,
  /** While a drill notice waits to be picked up, the drill page is checked this often. */
  drillPollSeconds: 6,
  /** A cached listing read is reused for this long by Context.dev (maxAgeMs) unless a check is forced. */
  listingMaxAgeMinutes: 10,
} as const;

/**
 * Decisions in code. A confirmed match on a notice newer than this holds the product by itself; on an older notice
 * (a first backfill reads months back) a person decides, since the wholesaler will long since have acted on it.
 */
export const AUTO_HOLD_MAX_AGE_DAYS = 14;

/** Possible matches on notices older than this are kept as history with the notice, not queued for review. */
export const REVIEW_MAX_AGE_DAYS = 60;

/** Kitchens are told about deliveries of an affected product received within this many days. */
export const RECENT_ORDER_DAYS = 60;

/** A kitchen "regularly orders" a product it ordered at least this many times in its remembered history. */
export const REGULAR_ORDER_MIN = 2;
