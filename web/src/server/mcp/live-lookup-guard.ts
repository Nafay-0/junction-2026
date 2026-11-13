import { LIVE_LOOKUP_LIMITS, LiveLookupAllowance } from "@/core/live-allowance";

/**
 * The MCP view of the per-agent hourly allowance for live price/availability lookups. The allowance itself lives
 * in the core (core/live-allowance.ts), so REST callers and the intake get the same protection; every live call
 * made through `createDock` is recorded there. This guard only checks first, so an MCP tool is refused before
 * it does any work, and reports what is left. It never records a call itself (that would count it twice).
 */
export { LIVE_LOOKUP_LIMITS };

export class LiveLookupGuard {
  constructor(private readonly allowance: LiveLookupAllowance = new LiveLookupAllowance()) {}

  remaining(agentKey: string) {
    return this.allowance.remaining(agentKey);
  }

  /** Throws the refusal the core would give this call (rule live_lookup_limit); records nothing. */
  reserve(agentKey: string, productIds: string[]): void {
    this.allowance.check(agentKey, productIds);
  }
}
