import { DockError } from "@/core/errors";
import { RateLimiter, clientAddress, rateLimitsEnabled, type RateRule } from "../../limits";

/**
 * The front door for /ui-api/scan/**, which src/proxy.ts leaves out (its body buffer is smaller than a photo):
 * the same per-address rate limits, and a body read that stops at a hard cap whatever Content-Length says.
 */
const g = globalThis as typeof globalThis & { __dockScanLimiter?: RateLimiter };
const limiter = (g.__dockScanLimiter ??= new RateLimiter(10_000));
const RULES: Record<"read" | "step", RateRule> = {
  read: { name: "scan", limit: 10, windowMs: 60_000 },
  step: { name: "scan-step", limit: 60, windowMs: 60_000 },
};

export function guard(req: Request, what: "read" | "step") {
  if (!rateLimitsEnabled()) return;
  const retry = limiter.hit(RULES[what], clientAddress(req.headers));
  if (retry !== null) throw new DockError(429, "rate_limited", `Too many requests from your address; try again in ${retry} s. (Demo server limit "${RULES[what].name}".)`, "rate_limit");
}

/** Read the request body, refusing anything over `max` bytes before reading it all. */
export async function readCapped(req: Request, max: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw new DockError(413, "scan_too_large", `That upload is larger than ${Math.round(max / 1048576)} MB.`);
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new DockError(413, "scan_too_large", `That upload is larger than ${Math.round(max / 1048576)} MB.`);
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}
