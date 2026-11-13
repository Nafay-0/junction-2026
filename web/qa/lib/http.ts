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
}

export class Http {
  constructor(
    readonly base: string,
    readonly rec: Recorder,
    private readonly defaults: Record<string, string> = {},
  ) {}

  with(headers: Record<string, string>): Http {
    return new Http(this.base, this.rec, { ...this.defaults, ...headers });
  }

  async raw(method: string, path: string, init: { body?: BodyInit | null; headers?: Record<string, string> } = {}): Promise<Reply> {
    const headers = { accept: "application/json", ...this.defaults, ...(init.headers ?? {}) };
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
