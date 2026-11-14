import { MAX_LIVE_IDS_PER_CALL } from "./catalog";
import { DockError } from "./errors";

/**
 * The partner's live price/availability API is rate limited and must only ever see short lists. MeteredCatalog
 * refuses more than MAX_LIVE_IDS_PER_CALL products in one call; this allowance stops looping over the catalogue
 * ten products at a time. It counts only calls that actually reach the partner: answers Dock serves from its
 * short-lived live cache (orders.ts) cost nothing.
 *
 * Three ceilings, all over a rolling window except the daily one:
 *   per share    calls and distinct products per agent and hour. A "share" is the agent itself, or one browser
 *                session of an on-site console (`agentKey#session`), so many people at one demo kitchen do not
 *                use up each other's lookups.
 *   per agent    calls per agent and hour across all its shares: the on-site console as a whole is still capped.
 *   per day      calls per day by every agent together: the hard ceiling that protects the partner's service.
 *
 * Sized for real use: an intake prices one or two short lists; a menu plan makes a few batched lookups of up to
 * about twenty products each; a long basket's quote is priced in calls of ten. Every figure can be set in the
 * environment (names in web/.env.example):
 *   DOCK_LIVE_CALLS_PER_HOUR        per share, default 60
 *   DOCK_LIVE_PRODUCTS_PER_HOUR     distinct products per share, default 150
 *   DOCK_LIVE_AGENT_CALLS_PER_HOUR  per agent across its console sessions, default 600
 *   DOCK_LIVE_CALLS_PER_DAY         all agents together, default 3000
 *
 * It lives in the core so every transport gets it (REST, MCP, the intake, the menu planner). In memory, per
 * process; the Valkey subclass (server/aiven/valkey.ts) shares the per-share counts across processes.
 */
export type LiveLookupLimits = {
  windowMinutes: number;
  /** Partner calls per share (agent, or one console session) in the window. */
  maxCalls: number;
  /** Distinct products priced per share in the window. */
  maxDistinctProducts: number;
  /** Partner calls per agent across all its shares in the window. */
  maxCallsPerAgent?: number;
  /** Partner calls by everyone together per calendar day (UTC). */
  maxCallsPerDay?: number;
};

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v ?? "");
  return (v ?? "").trim() !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** The limits from the environment (see above), with defaults sized for intakes, menus and long baskets. */
export function liveLookupLimits(env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env): Required<LiveLookupLimits> {
  return {
    windowMinutes: 60,
    maxCalls: num(env.DOCK_LIVE_CALLS_PER_HOUR, 60),
    maxDistinctProducts: num(env.DOCK_LIVE_PRODUCTS_PER_HOUR, 150),
    maxCallsPerAgent: num(env.DOCK_LIVE_AGENT_CALLS_PER_HOUR, 600),
    maxCallsPerDay: num(env.DOCK_LIVE_CALLS_PER_DAY, 3000),
  };
}

export const LIVE_LOOKUP_LIMITS: Required<LiveLookupLimits> = liveLookupLimits();

export type LiveAllowanceLeft = { windowMinutes: number; maxProductsPerCall: number; callsLeft: number; newProductsLeft: number };

type Use = { at: number; ids: string[] };

/** The key an agent is counted under: one organisation's one agent. */
export const agentKeyOf = (orgId: string, agentId: string) => `${orgId}:${agentId}`;

/** One console session's own share of an agent's allowance. */
export const shareKeyOf = (orgId: string, agentId: string, share?: string) => (share ? `${agentKeyOf(orgId, agentId)}#${share}` : agentKeyOf(orgId, agentId));

const agentPart = (key: string) => key.split("#")[0];

export class LiveLookupAllowance {
  private uses = new Map<string, Use[]>();
  private day = { date: "", calls: 0 };
  readonly limits: Required<LiveLookupLimits>;

  constructor(
    limits: LiveLookupLimits = LIVE_LOOKUP_LIMITS,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.limits = { ...LIVE_LOOKUP_LIMITS, ...limits };
  }

  private recent(key: string): Use[] {
    const since = this.now().getTime() - this.limits.windowMinutes * 60_000;
    const kept = (this.uses.get(key) ?? []).filter((u) => u.at > since);
    if (kept.length) this.uses.set(key, kept);
    else this.uses.delete(key);
    return kept;
  }

  private agentCalls(key: string): number {
    const agent = agentPart(key);
    let n = 0;
    for (const k of [...this.uses.keys()]) if (agentPart(k) === agent) n += this.recent(k).length;
    return n;
  }

  private today(): { date: string; calls: number } {
    const d = this.now().toISOString().slice(0, 10);
    if (this.day.date !== d) this.day = { date: d, calls: 0 };
    return this.day;
  }

  private minutesUntilFree(key: string): number {
    const oldest = this.recent(key)[0];
    if (!oldest) return 1;
    return Math.max(1, Math.ceil((oldest.at + this.limits.windowMinutes * 60_000 - this.now().getTime()) / 60_000));
  }

  /** Allowance left for this share in the current window. */
  remaining(agentKey: string): LiveAllowanceLeft {
    const recent = this.recent(agentKey);
    const distinct = new Set(recent.flatMap((u) => u.ids)).size;
    const { maxCalls, maxCallsPerAgent, maxCallsPerDay } = this.limits;
    const callsLeft = Math.min(maxCalls - recent.length, maxCallsPerAgent - this.agentCalls(agentKey), maxCallsPerDay - this.today().calls);
    return {
      windowMinutes: this.limits.windowMinutes,
      maxProductsPerCall: MAX_LIVE_IDS_PER_CALL,
      callsLeft: Math.max(0, callsLeft),
      newProductsLeft: Math.max(0, this.limits.maxDistinctProducts - distinct),
    };
  }

  /** Throw the refusal this call would get, without recording anything. */
  check(agentKey: string, productIds: string[]): void {
    const ids = [...new Set(productIds)];
    if (ids.length === 0 || ids.length > MAX_LIVE_IDS_PER_CALL) return; // MeteredCatalog refuses an oversized call itself
    const recent = this.recent(agentKey);
    const known = new Set(recent.flatMap((u) => u.ids));
    const distinctAfter = new Set([...known, ...ids]).size;
    const { windowMinutes, maxCalls, maxDistinctProducts, maxCallsPerAgent, maxCallsPerDay } = this.limits;
    const session = agentKey.includes("#");
    const who = session ? "This console session" : "This agent";
    if (this.today().calls >= maxCallsPerDay) {
      throw new DockError(429, "live_lookup_daily_limit", `AimoPilot has made its ${maxCallsPerDay} live price/availability lookups for today, the ceiling that protects the wholesaler's service. Prices and stock come back after midnight UTC; option cards already shown still hold until their quotes expire.`, "live_lookup_limit", { maxCallsPerDay, scope: "day" });
    }
    if (recent.length >= maxCalls) {
      const wait = this.minutesUntilFree(agentKey);
      throw new DockError(429, "live_lookup_budget_exceeded", `${who} already made ${recent.length} live price/availability lookups in the last ${windowMinutes} minutes; the limit is ${maxCalls}. Try again in about ${wait} min.`, "live_lookup_limit", { maxCalls, windowMinutes, retryAfterMinutes: wait, scope: session ? "session" : "agent" });
    }
    if (session && this.agentCalls(agentKey) >= maxCallsPerAgent) {
      throw new DockError(429, "live_lookup_budget_exceeded", `This kitchen's on-site agent made ${maxCallsPerAgent} live price/availability lookups in the last ${windowMinutes} minutes, for everyone at the console together. Try again in a few minutes.`, "live_lookup_limit", { maxCallsPerAgent, windowMinutes, scope: "agent" });
    }
    if (distinctAfter > maxDistinctProducts) {
      throw new DockError(
        429,
        "live_lookup_budget_exceeded",
        `Live price/availability is for short lists: at most ${maxDistinctProducts} different products per ${session ? "console session" : "agent"} in ${windowMinutes} minutes. This call would make it ${distinctAfter}.`,
        "live_lookup_limit",
        { maxDistinctProducts, windowMinutes, alreadyPriced: known.size, requested: ids.length },
      );
    }
  }

  /** Record a live lookup before it reaches the partner, or throw a refusal naming the live_lookup_limit rule. */
  reserve(agentKey: string, productIds: string[]): void {
    this.check(agentKey, productIds);
    const ids = [...new Set(productIds)];
    if (ids.length === 0 || ids.length > MAX_LIVE_IDS_PER_CALL) return;
    const list = this.recent(agentKey);
    list.push({ at: this.now().getTime(), ids });
    this.uses.set(agentKey, list);
    this.today().calls++;
  }
}
