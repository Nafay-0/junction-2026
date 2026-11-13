import { MAX_LIVE_IDS_PER_CALL } from "./catalog";
import { DockError } from "./errors";

/**
 * The partner's live price/availability API must only ever see short lists. MeteredCatalog already refuses more
 * than MAX_LIVE_IDS_PER_CALL products in one call; this allowance stops the other way round it: looping over the
 * catalogue ten products at a time. Per agent, over a rolling window, it caps the number of live calls and the
 * number of different products priced. Quotes and intake lookups count too, because they ask for live prices.
 *
 * It lives in the core so every transport gets it: the REST routes, the MCP tools and the intake all go through
 * `createDock`, which records each live call here before it reaches the partner. The MCP layer only asks
 * `check` first, to refuse before doing any work, and reads `remaining` for its tool results.
 *
 * In memory, per server process (like the rest of the runtime today). On a multi-instance deployment this belongs
 * in shared storage next to the repository.
 */
export const LIVE_LOOKUP_LIMITS = {
  windowMinutes: 60,
  maxCalls: 30,
  maxDistinctProducts: 3 * MAX_LIVE_IDS_PER_CALL,
};

export type LiveLookupLimits = typeof LIVE_LOOKUP_LIMITS;
export type LiveAllowanceLeft = { windowMinutes: number; maxProductsPerCall: number; callsLeft: number; newProductsLeft: number };

type Use = { at: number; ids: string[] };

/** The key an agent is counted under: one organisation's one agent. */
export const agentKeyOf = (orgId: string, agentId: string) => `${orgId}:${agentId}`;

export class LiveLookupAllowance {
  private uses = new Map<string, Use[]>();

  constructor(
    readonly limits: LiveLookupLimits = LIVE_LOOKUP_LIMITS,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private recent(agentKey: string): Use[] {
    const since = this.now().getTime() - this.limits.windowMinutes * 60_000;
    const kept = (this.uses.get(agentKey) ?? []).filter((u) => u.at > since);
    this.uses.set(agentKey, kept);
    return kept;
  }

  /** Allowance left for this agent in the current window. */
  remaining(agentKey: string): LiveAllowanceLeft {
    const recent = this.recent(agentKey);
    const distinct = new Set(recent.flatMap((u) => u.ids)).size;
    return {
      windowMinutes: this.limits.windowMinutes,
      maxProductsPerCall: MAX_LIVE_IDS_PER_CALL,
      callsLeft: Math.max(0, this.limits.maxCalls - recent.length),
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
    const { windowMinutes, maxCalls, maxDistinctProducts } = this.limits;
    if (recent.length >= maxCalls) {
      throw new DockError(429, "live_lookup_budget_exceeded", `This agent already made ${recent.length} live price/availability lookups in the last ${windowMinutes} minutes; the limit is ${maxCalls}.`, "live_lookup_limit", { maxCalls, windowMinutes });
    }
    if (distinctAfter > maxDistinctProducts) {
      throw new DockError(
        429,
        "live_lookup_budget_exceeded",
        `Live price/availability is for a short list: at most ${maxDistinctProducts} different products per agent in ${windowMinutes} minutes. This call would make it ${distinctAfter}.`,
        "live_lookup_limit",
        { maxDistinctProducts, windowMinutes, alreadyPriced: known.size, requested: ids.length },
      );
    }
  }

  /** Record a live lookup before it happens, or throw a refusal naming the live_lookup_limit rule. */
  reserve(agentKey: string, productIds: string[]): void {
    this.check(agentKey, productIds);
    const ids = [...new Set(productIds)];
    if (ids.length === 0 || ids.length > MAX_LIVE_IDS_PER_CALL) return;
    this.recent(agentKey).push({ at: this.now().getTime(), ids });
  }
}
