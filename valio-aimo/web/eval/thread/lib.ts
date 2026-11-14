/* eslint-disable @typescript-eslint/no-explicit-any -- eval harness: drivers read untyped JSON replies. */
import type { Nutrition } from "@/core/nutrition";
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";
/**
 * Shared pieces of the buyer-experience eval: a cookie-keeping browser with timing, the driver-independent
 * outcome a scenario is checked against, product lookups for catalogue checks, and statistics.
 */

export type Json = any;

// ---------- a browser: one cookie jar, every call timed ----------

export type Reply = { status: number; body: Json; text: string; headersMs: number; ms: number; headers: Headers };

export class Browser {
  readonly calls: { method: string; path: string; status: number; ms: number }[] = [];
  private jar: Record<string, string> = {};
  constructor(readonly base: string) {}

  cookie(): string {
    return Object.entries(this.jar)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  absorbCookies(res: Response) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      if (i > 0) this.jar[kv.slice(0, i)] = kv.slice(i + 1);
    }
  }

  /** `onHeaders` fires when the response's first byte (its status line and headers) arrives. */
  async req(method: string, path: string, body?: unknown, opts: { onHeaders?: () => void; timeoutMs?: number } = {}): Promise<Reply> {
    const t0 = performance.now();
    let res: Response;
    try {
      res = await fetch(new URL(path, this.base), {
        method,
        headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(this.cookie() ? { cookie: this.cookie() } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
      });
    } catch (err) {
      const ms = performance.now() - t0;
      this.calls.push({ method, path, status: 0, ms });
      return { status: 0, body: { error: { code: "network", message: (err as Error).message } }, text: "", headersMs: ms, ms, headers: new Headers() };
    }
    const headersMs = performance.now() - t0;
    opts.onHeaders?.();
    this.absorbCookies(res);
    const text = await res.text();
    const ms = performance.now() - t0;
    let parsed: Json;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    this.calls.push({ method, path, status: res.status, ms: Math.round(ms) });
    return { status: res.status, body: parsed, text, headersMs, ms, headers: res.headers };
  }

  get = (p: string, o?: { onHeaders?: () => void }) => this.req("GET", p, undefined, o);
  post = (p: string, b?: unknown, o?: { onHeaders?: () => void; timeoutMs?: number }) => this.req("POST", p, b ?? {}, o);
}

// ---------- what a scenario ends with, whatever the driver ----------

export type OptionSeen = {
  optionId: string;
  rank?: string;
  title?: string;
  match?: string;
  totalCents: number;
  deliveryDate?: string;
  orderBy?: string;
  givesUp: string[];
  alternative?: { for?: string; tier?: string; reason?: string };
  lines: { productId: string; name?: string; packs?: number; substituteFor?: string }[];
  signOff: string[];
};

export type Outcome = {
  /** What the reader understood from the first purchase message (interpret reply, or the understood card). */
  understood?: { item?: string; amount?: number; unit?: string; deliverBy?: string; attributes: string[]; allergens: string[]; basedOn?: string; alsoAsked: string[] };
  /** Every reading, in order (a follow-up gets its own). */
  readings: { item?: string; amount?: number; unit?: string; deliverBy?: string; basedOn?: string; alsoAsked: string[] }[];
  concerns: { code: string; message: string; key: string }[];
  questions: number;
  /** The newest options the buyer saw, and every option seen in the scenario. */
  options: OptionSeen[];
  allOptions: OptionSeen[];
  /** The option card the order was made from, and its place on the card list (0-based). */
  chosen?: { optionId: string; index: number };
  excluded: string[];
  notes: string[];
  /** Last intake state (legacy) or the nearest equivalent (thread). */
  state?: string;
  /** Distinct requests the scenario opened. */
  requests: string[];
  orders: { orderId: string; status: string; approver?: string; rules: { rule: string; outcome: string }[]; reasons: string[]; totalCents: number; lines: { productId: string; quantity?: number }[]; family?: string }[];
  refusals: { code?: string; rule?: string; message: string }[];
  /** Read-only answers (the assistant panel, or a records card). */
  answers: { text: string; citations: { kind?: string; productId?: string; orderId?: string; label?: string }[]; kind?: string }[];
  /** Every line the agent said, in order (thread driver only). */
  lines?: string[];
  /** How each concern was settled: confirmed as said, and whether it counted as the person's own. */
  acknowledgements: { code: string; action?: string; channel?: string; verified?: boolean }[];
  notices: { kind: string; message: string; rule?: string }[];
  /** The day's opening and any later "what needs me today" card (thread driver only): `opening` for the one posted unasked. */
  today: { opening: boolean; pending: boolean; date: string; items: Json[] }[];
  /** The home's other cards seen (products, product, standing, deliveries, memory_list). */
  home: string[];
  /** A menu plan (need → recipe → order on the store's menu page). */
  plan?: { lines: number; struck: number; doubts: number; unsourced: string[] };
  /** Free-form trace of what the driver did. */
  log: string[];
};

export const emptyOutcome = (): Outcome => ({
  readings: [],
  concerns: [],
  questions: 0,
  options: [],
  allOptions: [],
  excluded: [],
  notes: [],
  requests: [],
  orders: [],
  refusals: [],
  answers: [],
  acknowledgements: [],
  notices: [],
  today: [],
  home: [],
  log: [],
});

export type Milestone = "first_sign" | "understood" | "options" | "dishes" | "menu" | "placed" | "answered" | "total";
/** `dishes`: a menu card shows its dishes (the planner's outline); `menu`: the menu card is ready to edit, every line priced. */
export const MILESTONES: Milestone[] = ["first_sign", "understood", "options", "dishes", "menu", "placed", "answered", "total"];

/** Times are milliseconds from the first submit. A milestone is kept the first time it is reached. */
export class Marks {
  readonly t0 = performance.now();
  readonly at: Partial<Record<Milestone, number>> = {};
  hit(m: Milestone, when = performance.now()) {
    if (this.at[m] === undefined) this.at[m] = Math.round(when - this.t0);
  }
}

/** What the buyer did after the first message. */
export type Actions = {
  /** Taps on cards or buttons (confirm, answer, choose, place, "change this request"). */
  taps: number;
  /** Typed turns written by the scenario after the first message (the buyer's own follow-ups). */
  typed: number;
  /** Typed input the driver had to add that the scenario did not script (filling a field the reader missed, retyping). */
  extraTyped: number;
  /** Each action, in order, for the report. */
  list: string[];
};

export const noActions = (): Actions => ({ taps: 0, typed: 0, extraTyped: 0, list: [] });

/**
 * The stage kitchens are open only to their own signed-in account (main since 14 Nov). Sign in as a judge at the table
 * would, when the server's password is known (DOCK_KAARI_PASSWORD / DOCK_LAAKSO_PASSWORD); a server from before
 * accounts needs none.
 */
export async function signInAs(b: Browser, kitchen: string): Promise<void> {
  // The public test accounts' passwords are published with them (server/accounts/test-accounts.ts).
  const pw = TEST_ACCOUNTS.find((t) => t.username === kitchen)?.password ?? process.env[`DOCK_${kitchen.toUpperCase()}_PASSWORD`];
  if (pw) await b.post("/ui-api/account/signin", { username: kitchen, password: pw });
}

// ---------- the catalogue, for checks ----------

export type ProductInfo = { id: string; name: string; category?: string; attributes: string[]; allergens: string[]; nutrition?: Nutrition } | null;

export class Catalogue {
  private cache = new Map<string, Promise<ProductInfo>>();
  constructor(private readonly b: Browser, private readonly kitchen: string) {}
  product(id: string): Promise<ProductInfo> {
    let p = this.cache.get(id);
    if (!p) {
      p = this.b.get(`/ui-api/kitchens/${this.kitchen}/catalog/product/${encodeURIComponent(id)}`).then((r) => {
        const x = r.body?.product;
        return r.status === 200 && x ? { id: x.id, name: x.name, category: x.category, attributes: x.attributes ?? [], allergens: x.allergens ?? [], ...(x.nutrition ? { nutrition: x.nutrition } : {}) } : null;
      });
      this.cache.set(id, p);
    }
    return p;
  }
}

// ---------- statistics ----------

export function quantile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return Math.round(s[lo] + (s[hi] - s[lo]) * (i - lo));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
