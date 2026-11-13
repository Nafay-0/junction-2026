import type { SourceId } from "./sources";

/**
 * The radar's records. Everything a person sees about a notice traces back to the page it came from: the URL, when
 * it was published and seen, and the exact sentences each fact was read from, in the notice's own language.
 */

/** A fact and where it came from. `sentence` is copied from the page; `verified` says code found it there verbatim. */
export type Evidence = {
  value: string;
  /** The sentence on the page the value was read from, in the original language. */
  sentence?: string;
  /** True when code found `sentence` (or the value itself) in the page text. Unverified facts never confirm a match. */
  verified: boolean;
  /** An English rendering for staff, when the reader gave one. The original stays authoritative. */
  english?: string;
};

export type HazardKind = "allergen" | "microbial" | "foreign_body" | "chemical" | "spoilage" | "labelling" | "other";

export type Lots = {
  /** Best-before or use-by dates the notice limits itself to, YYYY-MM-DD. Empty: not limited by date. */
  bestBefore: string[];
  /** "or earlier" style limits: every date up to and including this one. */
  bestBeforeUpTo?: string;
  /** Batch or lot codes as written. */
  batches: string[];
  /** Other marks the notice limits itself to (an egg stamp such as 1FI15493), as written. */
  marks: string[];
};

export type NoticeProduct = {
  name: Evidence;
  brand?: Evidence;
  producer?: Evidence;
  /** Pack size as written ("2,5 dl", "3x1 kg"). */
  pack?: Evidence;
  /** GTIN/EAN codes, digits only, each passing the GS1 check digit and present in the page text. */
  eans: string[];
  lots: Lots;
};

export type NoticeFacts = {
  products: NoticeProduct[];
  producer?: Evidence;
  hazard: { kind: HazardKind; allergens: string[]; text?: Evidence };
  /** What the authority tells consumers to do (return, do not eat). */
  consumerAction?: Evidence;
  /** What it tells businesses and kitchens to do, when it says. */
  businessAction?: Evidence;
  /** Every EAN in the page text with a valid check digit (code, not the model). */
  eans: string[];
  /** Notice-wide lot limits, the union of what code and the reader found. */
  lots: Lots;
  summaryEnglish?: string;
};

export type ReadBy = "context.dev" | "direct" | "exa+context.dev" | "rasff";

export type Notice = {
  noticeId: string;
  sourceId: SourceId;
  /** True for drill notices: never a real recall, and marked so everywhere it is shown and recorded. */
  drill: boolean;
  url: string;
  title: string;
  language: "fi" | "sv" | "en";
  /** As the publisher dates it (YYYY-MM-DD); undefined when the page gives no date. */
  publishedOn?: string;
  /** When the radar first saw it listed. */
  seenAt: string;
  /** When its page was read into facts. */
  readAt?: string;
  readBy?: ReadBy;
  /** "read": facts extracted; "listed": only the title is known yet; "unreadable": the page could not be read. */
  state: "listed" | "read" | "unreadable";
  readError?: string;
  facts?: NoticeFacts;
  /** The page text the facts were checked against (trimmed), kept so evidence can be shown and re-verified. */
  text?: string;
  /** Other pages about the same recall (Exa), and the same notice in another language. */
  corroboration: { url: string; title: string; publishedOn?: string; via: "exa" }[];
  sameAs: string[];
  /** RASFF and other feeds: the alert's own reference and classification. */
  feed?: { reference: string; classification: string; risk?: string; category?: string; countries: string[] };
};

export type MatchStrength = "confirmed" | "possible";
export type MatchBasis = "gtin" | "producer_name_pack" | "brand_name" | "brand_family" | "name_only";

export type MatchStatus =
  /** Code confirmed it on a hard identifier and acted (hold placed, or kitchens told). */
  | "confirmed"
  /** Waiting for a person: a possible match, or a confirmed one on an older notice. */
  | "review"
  /** A person confirmed it. */
  | "confirmed_by_staff"
  /** A person dismissed it, with a reason. */
  | "dismissed";

export type Match = {
  matchId: string;
  noticeId: string;
  drill: boolean;
  productId: string;
  productName: string;
  strength: MatchStrength;
  basis: MatchBasis;
  /** Plain words: which identifier matched, and what differed. */
  why: string;
  /** The notice product it matched, as the notice names it. */
  noticeProduct?: string;
  lots: Lots;
  /** Can a delivery made from today on contain an affected pack? False when every affected date has passed. */
  newDeliveriesAffected: boolean;
  status: MatchStatus;
  /** Why it waits for a person (possible match, older notice). */
  reviewReason?: string;
  createdAt: string;
  review?: { by: string; at: string; decision: "confirm" | "dismiss"; reason: string };
  holdId?: string;
};

export type Hold = {
  holdId: string;
  productId: string;
  productName: string;
  noticeId: string;
  matchId: string;
  drill: boolean;
  /** What the agent and the approver are told, with the notice's title and publisher. */
  reason: string;
  noticeUrl: string;
  noticeTitle: string;
  publisher: string;
  placedAt: string;
  /** "radar": code on a confirmed identifier; otherwise the staff member who confirmed a review. */
  placedBy: string;
  liftedAt?: string;
  liftedBy?: string;
  liftReason?: string;
  /** Calls refused while it was in force (quotes, orders, sign-offs). */
  refusals: number;
  lastRefusalAt?: string;
};

export type SourceStatus = "ok" | "never_checked" | "degraded" | "down" | "layout_changed" | "paused";

export type SourceState = {
  sourceId: SourceId;
  status: SourceStatus;
  lastCheckAt?: string;
  lastOkAt?: string;
  lastError?: string;
  /** Items the listing showed on the last good read: a sudden drop to none is a layout change, not "no recalls". */
  listedLastTime?: number;
  monitor?: { monitorId: string; lastRunAt?: string; lastRunStatus?: string; nextRunAt?: string; lastChangeAt?: string; seenChangeIds: string[] };
  checks: number;
  noticesRead: number;
};

export type Spend = {
  contextDevCredits: number;
  contextDevCalls: number;
  /** Credits left on the Context.dev account, from the last response that said. */
  contextDevRemaining?: number;
  exaDollars: number;
  exaCalls: number;
  /** Context.dev reads served from Context.dev's own cache or ours. */
  cacheHits: number;
  since: string;
};
