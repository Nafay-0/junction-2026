/**
 * The door every call to the wholesaler's price and availability service goes through, once per process.
 *
 * Valio (14 Nov): "Hitting the limit will return 429 and you will be blocked for 30 seconds, after which you can
 * continue so please implement something that honors 429 responses. A few hundred calls per minute is ok, over 10
 * [per] second not ok."
 *
 *   pace    at most DOCK_PARTNER_CALLS_PER_SECOND (5) calls in any second and DOCK_PARTNER_CALLS_PER_MINUTE (200) in
 *           any minute, for the whole process: the watch's timer, the menu planner's batches and every conversation
 *           share one budget. A call over it waits its turn (at most DOCK_PARTNER_QUEUE_MS, 2 s, and never past the
 *           lookup's deadline) rather than being dropped; one that would wait longer is refused as busy.
 *   block   after any 429, nothing calls the partner for DOCK_PARTNER_BLOCK_SECONDS (30), or the Retry-After when that
 *           is longer. Calls in that window fail at once ("the wholesaler's price service asked us to wait") and are
 *           never retried into it; answers already cached still serve.
 *
 * The defaults are half of what Valio allows, because several servers share one key this weekend (the public site,
 * a preview, engineers' test servers) and each keeps its own count. The state is on /api/health and the operations
 * Platform page.
 */

export type PartnerGateConfig = { perSecond: number; perMinute: number; blockSeconds: number; queueMs: number; now: () => number; sleep: (ms: number) => Promise<void> };

export class PartnerBusyError extends Error {
  constructor(
    readonly reason: "blocked" | "busy",
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message);
    this.name = "PartnerBusyError";
  }
}

export type PartnerGateState = {
  perSecond: number;
  perMinute: number;
  blockSeconds: number;
  /** ISO time until which no call goes to the partner (a 429 was answered), or null. */
  blockedUntil: string | null;
  callsLastMinute: number;
  calls: number;
  /** Calls that waited their turn, and for how long in all. */
  queued: number;
  waitedMs: number;
  /** Calls refused because the partner had asked us to wait, or because the queue was too long. */
  refusedWhileBlocked: number;
  refusedBusy: number;
  blocks: number;
  last429At: string | null;
};

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export class PartnerGate {
  private stamps: number[] = [];
  private blockedUntil = 0;
  private counters = { calls: 0, queued: 0, waitedMs: 0, refusedWhileBlocked: 0, refusedBusy: 0, blocks: 0, last429At: 0 };
  readonly cfg: PartnerGateConfig;

  constructor(cfg: Partial<PartnerGateConfig> = {}) {
    this.cfg = {
      perSecond: cfg.perSecond ?? num("DOCK_PARTNER_CALLS_PER_SECOND", 5),
      perMinute: cfg.perMinute ?? num("DOCK_PARTNER_CALLS_PER_MINUTE", 200),
      blockSeconds: cfg.blockSeconds ?? num("DOCK_PARTNER_BLOCK_SECONDS", 30),
      queueMs: cfg.queueMs ?? num("DOCK_PARTNER_QUEUE_MS", 2000),
      now: cfg.now ?? (() => Date.now()),
      sleep: cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    };
  }

  /** Seconds left of a block, or 0. */
  blockedFor(): number {
    const left = this.blockedUntil - this.cfg.now();
    return left > 0 ? Math.ceil(left / 1000) : 0;
  }

  /**
   * Wait for this call's turn (at most `maxWaitMs`, and at most the configured queue time). Throws PartnerBusyError
   * when the partner asked us to wait, or when the turn is too far off.
   */
  async acquire(maxWaitMs = Infinity): Promise<void> {
    let waited = 0;
    for (;;) {
      const t = this.cfg.now();
      if (t < this.blockedUntil) {
        this.counters.refusedWhileBlocked += 1;
        const s = this.blockedFor();
        throw new PartnerBusyError("blocked", `The wholesaler's price service asked us to wait (it answered 429): no calls for another ${s} s.`, s);
      }
      this.stamps = this.stamps.filter((x) => x > t - 60_000);
      const lastSecond = this.stamps.filter((x) => x > t - 1000);
      if (lastSecond.length < this.cfg.perSecond && this.stamps.length < this.cfg.perMinute) {
        this.stamps.push(t);
        this.counters.calls += 1;
        if (waited) {
          this.counters.queued += 1;
          this.counters.waitedMs += waited;
        }
        return;
      }
      const freeAt = lastSecond.length >= this.cfg.perSecond ? lastSecond[lastSecond.length - this.cfg.perSecond] + 1000 : this.stamps[this.stamps.length - this.cfg.perMinute] + 60_000;
      const wait = Math.max(1, freeAt - t);
      if (waited + wait > Math.min(this.cfg.queueMs, maxWaitMs)) {
        this.counters.refusedBusy += 1;
        const s = Math.max(1, Math.ceil(wait / 1000));
        throw new PartnerBusyError("busy", `AimoPilot keeps its calls to the wholesaler's price service under ${this.cfg.perSecond} a second and ${this.cfg.perMinute} a minute, and too many are waiting now: try again in ${s} s.`, s);
      }
      await this.cfg.sleep(wait);
      waited += wait;
    }
  }

  /** The partner answered 429: no call for the block time, or the Retry-After when longer. Returns the seconds. */
  block(retryAfterSeconds?: number): number {
    const s = Math.max(this.cfg.blockSeconds, retryAfterSeconds ?? 0);
    const t = this.cfg.now();
    this.blockedUntil = Math.max(this.blockedUntil, t + s * 1000);
    this.counters.blocks += 1;
    this.counters.last429At = t;
    return this.blockedFor();
  }

  state(): PartnerGateState {
    const t = this.cfg.now();
    return {
      perSecond: this.cfg.perSecond,
      perMinute: this.cfg.perMinute,
      blockSeconds: this.cfg.blockSeconds,
      blockedUntil: this.blockedUntil > t ? new Date(this.blockedUntil).toISOString() : null,
      callsLastMinute: this.stamps.filter((x) => x > t - 60_000).length,
      calls: this.counters.calls,
      queued: this.counters.queued,
      waitedMs: this.counters.waitedMs,
      refusedWhileBlocked: this.counters.refusedWhileBlocked,
      refusedBusy: this.counters.refusedBusy,
      blocks: this.counters.blocks,
      last429At: this.counters.last429At ? new Date(this.counters.last429At).toISOString() : null,
    };
  }
}

const g = globalThis as typeof globalThis & { __dockPartnerGate?: PartnerGate };

/** The one gate of this process (every live client shares it). */
export function partnerGate(): PartnerGate {
  return (g.__dockPartnerGate ??= new PartnerGate());
}
