import { DockError } from "@/core/errors";

/** A sliding one-hour window of counts, per key and in total. In memory, per server process. */
export class HourlyLimit {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly perKey: number,
    private readonly total: number,
    private readonly what: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  take(key: string) {
    const t = this.now();
    const fresh = (k: string) => (this.hits.get(k) ?? []).filter((x) => t - x < 3_600_000);
    const mine = fresh(key);
    const all = fresh("*");
    if (mine.length >= this.perKey) throw new DockError(429, "rate_limited", `This kitchen has used its ${this.perKey} ${this.what} for this hour.`);
    if (all.length >= this.total) throw new DockError(429, "rate_limited", `This server has taken ${this.total} ${this.what} this hour, its limit.`);
    this.hits.set(key, [...mine, t]);
    this.hits.set("*", [...all, t]);
  }
}

const g = globalThis as typeof globalThis & { __dockScanLimit?: HourlyLimit };
/** Scans: DOCK_SCANS_PER_KITCHEN_HOUR (default 20) and DOCK_SCANS_PER_HOUR (default 150). */
export function scanLimit(): HourlyLimit {
  g.__dockScanLimit ??= new HourlyLimit(Number(process.env.DOCK_SCANS_PER_KITCHEN_HOUR) || 20, Number(process.env.DOCK_SCANS_PER_HOUR) || 150, "document scans");
  return g.__dockScanLimit;
}
