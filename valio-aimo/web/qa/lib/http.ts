/* eslint-disable @typescript-eslint/no-explicit-any -- QA harness: probes read untyped JSON replies. */
/**
 * QA harness HTTP layer. Every response that passes through here is recorded and scanned by the global
 * invariants (no 5xx, no stack trace, no secret, error bodies well formed). Probes never throw on HTTP errors.
 */
import { scanResponse, type Violation } from "./invariants";

export type Reply<T = any> = { status: number; body: T; text: string; ms: number; headers: Headers };

export type Recorded = { method: string; path: string; status: number; ms: number; probe: string };

export class Recorder {
  readonly calls: Recorded[] = [];
  readonly violations: Violation[] = [];
  current = "(setup)";
  /** Paths whose 5xx is expected for this probe (e.g. the partner API is down on purpose). */
  allow5xx = new Set<string>();
  /** 429 rate_limited replies seen where a probe did not ask for them (the server's per-address limits are on). */
  rateLimited = 0;
  /** Error codes whose 5xx is the documented answer for this probe (e.g. 503 live_unavailable when the partner is down). */
  allowCodes = new Set<string>();
  expectRateLimit = false;
}

/**
 * The stage kitchens (kaari, laakso) are closed to their own accounts (main since 14 Nov): the harness signs in to
 * each as the browser suite does, and sends that kitchen's session with every call to its routes. A probe that means
 * to be anonymous uses `http.anonymous()`; one that sets its own cookie (a visitor's phone) keeps it.
 */
const STAGE_ROUTE = /^\/(?:ui-api\/(?:kitchens|scan|voice|plan|radar\/kitchens)|k)\/(kaari|laakso)(?:[/?]|$)/;
const stageCookies = new Map<string, string>();

/** Passwords tried in order: the environment's (a deployment), then the hermetic test server's (e2e/support/start-server.mjs). */
const STAGE_PASSWORDS: Record<string, string[]> = {
  kaari: [process.env.QA_KAARI_PASSWORD ?? "", "e2e-stage-kaari", process.env.DOCK_KAARI_PASSWORD ?? ""],
  laakso: [process.env.QA_LAAKSO_PASSWORD ?? "", "e2e-stage-laakso", process.env.DOCK_LAAKSO_PASSWORD ?? ""],
};

export async function signInStageKitchens(http: Http): Promise<string[]> {
  const done: string[] = [];
  for (const [kitchen, passwords] of Object.entries(STAGE_PASSWORDS)) {
    for (const password of passwords.filter(Boolean)) {
      const r = await http.anonymous().raw("POST", "/ui-api/account/signin", { body: JSON.stringify({ username: kitchen, password }), headers: { "content-type": "application/json" } });
      const cookie = r.status === 200 ? (r.headers.get("set-cookie") ?? "").split(";")[0] : "";
      if (cookie) {
        stageCookies.set(kitchen, cookie);
        done.push(kitchen);
        break;
      }
    }
  }
  return done;
}

export class Http {
  constructor(
    readonly base: string,
    readonly rec: Recorder,
    private readonly defaults: Record<string, string> = {},
    private readonly anon = false,
  ) {}

  with(headers: Record<string, string>): Http {
    return new Http(this.base, this.rec, { ...this.defaults, ...headers }, this.anon);
  }

  /** The same client without the stage kitchens' sessions: what someone who is not signed in gets. */
  anonymous(): Http {
    return new Http(this.base, this.rec, this.defaults, true);
  }

  async raw(method: string, path: string, init: { body?: BodyInit | null; headers?: Record<string, string> } = {}): Promise<Reply> {
    const headers: Record<string, string> = { accept: "application/json", ...this.defaults, ...(init.headers ?? {}) };
    const stage = !this.anon && !headers.cookie ? STAGE_ROUTE.exec(path)?.[1] : undefined;
    if (stage && stageCookies.has(stage)) headers.cookie = stageCookies.get(stage)!;
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(new URL(path, this.base), { method, headers, body: init.body ?? undefined, redirect: "manual", signal: AbortSignal.timeout(90_000) });
    } catch (err) {
      const ms = Date.now() - t0;
      this.rec.calls.push({ method, path, status: 0, ms, probe: this.rec.current });
      this.rec.violations.push({ invariant: "transport", probe: this.rec.current, detail: `${method} ${path}: ${(err as Error).message}` });
      return { status: 0, body: undefined, text: "", ms, headers: new Headers() };
    }
    const text = await res.text();
    const ms = Date.now() - t0;
    let body: unknown = undefined;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    this.rec.calls.push({ method, path, status: res.status, ms, probe: this.rec.current });
    if (res.status === 429 && /"rate_limited"/.test(text) && !this.rec.expectRateLimit) this.rec.rateLimited++;
    for (const v of scanResponse({ method, path, status: res.status, text, body, contentType: res.headers.get("content-type") ?? "" }, this.rec)) this.rec.violations.push(v);
    return { status: res.status, body, text, ms, headers: res.headers };
  }

  get<T = any>(path: string, headers?: Record<string, string>): Promise<Reply<T>> {
    return this.raw("GET", path, { headers });
  }

  post<T = any>(path: string, body?: unknown, headers?: Record<string, string>): Promise<Reply<T>> {
    return this.raw("POST", path, { body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json", ...(headers ?? {}) } });
  }
}

/** A client acting as one agent: mandate + agent id on every call. */
export function agent(http: Http, mandate: string, agentId: string): Http {
  return http.with({ authorization: `Mandate ${mandate}`, "dock-agent-id": agentId });
}

/** The buyer console's back end for one kitchen (no credentials needed: the server holds the mandate). */
export function consoleCall(http: Http, kitchen: string) {
  return <T = any>(method: "GET" | "POST", path: string, body?: unknown) => http.post<T>(`/ui-api/kitchens/${kitchen}/call`, { method, path, body });
}
