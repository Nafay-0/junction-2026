import { BUDGET } from "./sources";
import type { Spend } from "./types";

/**
 * The two partner APIs, as thin clients with a spending meter in front.
 *
 *   Context.dev  POST /v1/web/scrape (Markdown, JSON extraction, CSS parser), /v1/monitors (page monitors on the
 *                listings; reading a monitor and its runs is free), GET /v1/org/usage.
 *   Exa          POST /search with date and domain filters.
 *
 * Every call goes through `meter`: credits from Context.dev's `key_metadata` (or the X-Credits-Used header), dollars
 * from Exa's `costDollars.total`. A process stops calling a partner once it has spent its budget (sources.ts), so a
 * loop gone wrong cannot drain the weekend's credit. Keys come from the environment only and are never logged.
 */

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export class PartnerError extends Error {
  constructor(
    readonly partner: "context.dev" | "exa" | "rasff" | "direct",
    readonly kind: "no_key" | "budget" | "http" | "timeout" | "network" | "bad_response",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PartnerError";
  }
}

export function newSpend(now = new Date()): Spend {
  return { contextDevCredits: 0, contextDevCalls: 0, exaDollars: 0, exaCalls: 0, cacheHits: 0, since: now.toISOString() };
}

async function call(partner: PartnerError["partner"], fetchFn: FetchFn, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "TimeoutError" || name === "AbortError") throw new PartnerError(partner, "timeout", `${partner} did not answer within ${Math.round(timeoutMs / 1000)} s.`);
    throw new PartnerError(partner, "network", `${partner} could not be reached: ${(err as Error)?.message ?? "network error"}.`);
  }
}

async function json<T>(partner: PartnerError["partner"], res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      const b = JSON.parse(text) as { error?: string | { message?: string }; message?: string };
      msg = (typeof b.error === "string" ? b.error : b.error?.message) ?? b.message ?? msg;
    } catch {
      // keep the text
    }
    throw new PartnerError(partner, "http", `${partner} answered ${res.status}: ${msg}`, res.status);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new PartnerError(partner, "bad_response", `${partner} sent something that is not JSON.`);
  }
}

// ---------- Context.dev ----------

export type ScrapeOutput<T> = { requested: boolean; success: boolean | null; data: T | null; error_code?: string; message?: string };
export type ScrapeResponse = {
  url: string;
  markdown?: ScrapeOutput<string>;
  html?: ScrapeOutput<string>;
  parsed?: ScrapeOutput<Record<string, unknown>> & { type?: string };
  json?: ScrapeOutput<Record<string, unknown>> & { isTruncated?: boolean };
  metadata?: { title?: string; language?: string; publishedTime?: string; [k: string]: unknown };
  cache_metadata?: { status: "hit" | "miss" | "zdr"; age_ms: number };
  key_metadata?: { credits_consumed?: number; credits_remaining?: number };
  request_id?: string;
  isPartial?: boolean;
};

export type Monitor = { id: string; name: string; status: string; last_run_at: string | null; next_run_at: string | null; last_change_at: string | null; last_error?: { code?: string; message?: string } | null };

export class ContextDev {
  private readonly base = "https://api.context.dev/v1";
  constructor(
    private readonly spend: Spend,
    private readonly opts: { apiKey?: string; fetch?: FetchFn } = {},
  ) {}

  get configured(): boolean {
    return !!this.key();
  }

  private key(): string | undefined {
    return this.opts.apiKey ?? (process.env.CONTEXT_DEV_API_KEY?.trim() || undefined);
  }

  private async request<T>(method: "GET" | "POST" | "PATCH", path: string, body: unknown, timeoutMs: number, charged: boolean): Promise<T> {
    const key = this.key();
    if (!key) throw new PartnerError("context.dev", "no_key", "CONTEXT_DEV_API_KEY is not set.");
    if (charged && this.spend.contextDevCredits >= BUDGET.contextDevCreditsPerProcess)
      throw new PartnerError("context.dev", "budget", `The radar has spent its ${BUDGET.contextDevCreditsPerProcess} Context.dev credits for this run; reads pause until the next start.`);
    const res = await call("context.dev", this.opts.fetch ?? fetch, `${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, timeoutMs);
    const used = Number(res.headers.get("x-credits-used") ?? NaN);
    const out = await json<T & { key_metadata?: ScrapeResponse["key_metadata"] }>("context.dev", res);
    if (charged) {
      this.spend.contextDevCalls += 1;
      const credits = out.key_metadata?.credits_consumed ?? (Number.isFinite(used) ? used : 0);
      this.spend.contextDevCredits += credits;
    }
    if (typeof out.key_metadata?.credits_remaining === "number") this.spend.contextDevRemaining = out.key_metadata.credits_remaining;
    return out;
  }

  /** POST /v1/web/scrape. Charged: 1 credit, +4 for a JSON extraction that succeeds. */
  async scrape(body: Record<string, unknown>, timeoutMs = 60_000): Promise<ScrapeResponse> {
    const r = await this.request<ScrapeResponse>("POST", "/web/scrape", body, timeoutMs, true);
    if (r.cache_metadata?.status === "hit") this.spend.cacheHits += 1;
    return r;
  }

  async listMonitors(q: string): Promise<Monitor[]> {
    const r = await this.request<{ data: Monitor[] }>("GET", `/monitors?q=${encodeURIComponent(q)}&limit=20`, undefined, 15_000, false);
    return r.data ?? [];
  }

  async createMonitor(body: Record<string, unknown>): Promise<Monitor> {
    return this.request<Monitor>("POST", "/monitors", body, 20_000, false);
  }

  async getMonitor(id: string): Promise<Monitor> {
    return this.request<Monitor>("GET", `/monitors/${encodeURIComponent(id)}`, undefined, 15_000, false);
  }

  /** Credits left on the account (free). Needs the logs:read permission; quietly undefined without it. */
  async usage(): Promise<{ remaining?: number; used?: number } | undefined> {
    try {
      const r = await this.request<Record<string, unknown>>("GET", "/org/usage", undefined, 10_000, false);
      const remaining = pickNumber(r, ["credits_remaining", "balance", "remaining"]);
      if (remaining !== undefined) this.spend.contextDevRemaining = remaining;
      return { remaining, used: pickNumber(r, ["credits_used", "used", "period_usage"]) };
    } catch {
      return undefined;
    }
  }
}

function pickNumber(o: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number") return v;
    if (v && typeof v === "object") {
      const inner = pickNumber(v as Record<string, unknown>, keys);
      if (inner !== undefined) return inner;
    }
  }
  return undefined;
}

// ---------- Exa ----------

export type ExaResult = { url: string; title?: string; publishedDate?: string | null; highlights?: string[]; text?: string };

export class Exa {
  constructor(
    private readonly spend: Spend,
    private readonly opts: { apiKey?: string; fetch?: FetchFn } = {},
  ) {}

  get configured(): boolean {
    return !!this.key();
  }

  private key(): string | undefined {
    return this.opts.apiKey ?? (process.env.EXA_API_KEY?.trim() || undefined);
  }

  /** POST /search. Typically $0.007 per search with highlights. */
  async search(body: Record<string, unknown>): Promise<ExaResult[]> {
    const key = this.key();
    if (!key) throw new PartnerError("exa", "no_key", "EXA_API_KEY is not set.");
    if (this.spend.exaDollars >= BUDGET.exaDollarsPerProcess) throw new PartnerError("exa", "budget", `The radar has spent its $${BUDGET.exaDollarsPerProcess} of Exa for this run.`);
    const res = await call("exa", this.opts.fetch ?? fetch, "https://api.exa.ai/search", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }, 30_000);
    const out = await json<{ results?: ExaResult[]; costDollars?: { total?: number } }>("exa", res);
    this.spend.exaCalls += 1;
    this.spend.exaDollars = Math.round((this.spend.exaDollars + (out.costDollars?.total ?? 0.007)) * 10000) / 10000;
    return out.results ?? [];
  }
}

// ---------- plain HTTP (RASFF's JSON, and pages Context.dev cannot reach) ----------

export async function fetchText(url: string, init: RequestInit = {}, fetchFn: FetchFn = fetch, partner: PartnerError["partner"] = "direct"): Promise<string> {
  const res = await call(partner, fetchFn, url, { ...init, headers: { "user-agent": "DockRecallRadar/1.0 (+food safety research; hackathon demo)", ...(init.headers ?? {}) } }, 20_000);
  const text = await res.text();
  if (!res.ok) throw new PartnerError(partner, "http", `${url} answered ${res.status}.`, res.status);
  return text;
}
