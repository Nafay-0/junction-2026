import { MAX_LIVE_IDS_PER_CALL } from "@/core/catalog";
import { DockError } from "@/core/orders";

/**
 * The partner's live price/availability API must only ever see short lists. The core already refuses more
 * than MAX_LIVE_IDS_PER_CALL products in one call; this guard stops the other way round it: looping over
 * the catalogue ten products at a time. Per agent, over a rolling window, it caps the number of live calls
 * and the number of different products priced. Quotes count too, because a quote asks for live prices.
 *
 * In memory, per server process (like the rest of the runtime today). On a multi-instance deployment
 * this belongs in shared storage next to the repository.
 */
export const LIVE_LOOKUP_LIMITS = {
  windowMinutes: 60,
  maxCalls: 30,
  maxDistinctProducts: 3 * MAX_LIVE_IDS_PER_CALL,
};

type Use = { at: number; ids: string[] };

export class LiveLookupGuard {
  private uses = new Map<string, Use[]>();

  constructor(
    private readonly limits = LIVE_LOOKUP_LIMITS,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private recent(agentKey: string): Use[] {
    const since = this.now().getTime() - this.limits.windowMinutes * 60_000;
    const kept = (this.uses.get(agentKey) ?? []).filter((u) => u.at > since);
    this.uses.set(agentKey, kept);
    return kept;
  }

  /** Allowance left for this agent in the current window. */
  remaining(agentKey: string) {
    const recent = this.recent(agentKey);
    const distinct = new Set(recent.flatMap((u) => u.ids)).size;
    return {
      windowMinutes: this.limits.windowMinutes,
      maxProductsPerCall: MAX_LIVE_IDS_PER_CALL,
      callsLeft: Math.max(0, this.limits.maxCalls - recent.length),
      newProductsLeft: Math.max(0, this.limits.maxDistinctProducts - distinct),
    };
  }

  /** Record a live lookup before it happens, or throw a refusal naming the live_lookup_limit rule. */
  reserve(agentKey: string, productIds: string[]): void {
    const ids = [...new Set(productIds)];
    if (ids.length > MAX_LIVE_IDS_PER_CALL) return; // the core refuses this call before it reaches the partner
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
    recent.push({ at: this.now().getTime(), ids });
  }
}
