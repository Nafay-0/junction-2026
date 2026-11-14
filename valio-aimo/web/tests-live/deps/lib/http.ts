/* eslint-disable @typescript-eslint/no-explicit-any -- test harness: replies are untyped JSON. */
/**
 * HTTP for the dependency tests: every call is timed, never throws on an HTTP status, and records 5xx replies
 * and transport failures so a scenario can report them. Modelled on the QA harness (origin/claude/qa web/qa/lib).
 */
import { signMandate, type Mandate } from "@/core/mandate";
import { SoftwareAuthenticator } from "@/core/test-webauthn";
import { demoMandate, demoOrgKeyPair } from "@/server/dev-fixtures";

export type Reply<T = any> = { status: number; body: T; text: string; ms: number; headers: Headers; error?: string };
export type CallLog = { method: string; path: string; status: number; ms: number; code?: string };

export class Http {
  readonly log: CallLog[];
  constructor(
    readonly base: string,
    private readonly defaults: Record<string, string> = {},
    log?: CallLog[],
    readonly timeoutMs = 120_000,
  ) {
    this.log = log ?? [];
  }

  with(headers: Record<string, string>): Http {
    return new Http(this.base, { ...this.defaults, ...headers }, this.log, this.timeoutMs);
  }

  async raw(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    const t0 = Date.now();
    const h: Record<string, string> = { accept: "application/json", ...this.defaults, ...headers };
    if (body !== undefined) h["content-type"] = "application/json";
    try {
      const res = await fetch(new URL(path, this.base), { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(this.timeoutMs) });
      const text = await res.text();
      let json: any;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      const ms = Date.now() - t0;
      this.log.push({ method, path: path.split("?")[0], status: res.status, ms, code: json?.error?.code });
      return { status: res.status, body: json, text, ms, headers: res.headers };
    } catch (err) {
      const ms = Date.now() - t0;
      const e = (err as Error).name === "TimeoutError" ? "client_timeout" : ((err as { cause?: { code?: string } }).cause?.code ?? (err as Error).message);
      this.log.push({ method, path: path.split("?")[0], status: 0, ms, code: e });
      return { status: 0, body: undefined, text: "", ms, headers: new Headers(), error: e };
    }
  }

  get<T = any>(path: string, headers?: Record<string, string>): Promise<Reply<T>> {
    return this.raw("GET", path, undefined, headers);
  }
  post<T = any>(path: string, body?: unknown, headers?: Record<string, string>): Promise<Reply<T>> {
    return this.raw("POST", path, body ?? {}, headers);
  }
}

let n = 0;
const uid = (p: string) => `${p}_deps_${Date.now().toString(36)}_${(n++).toString(36)}`;

/** The demo buyer organisation's agent over REST (keys: the public dev seed; the server must run without DOCK_DEMO_ORG_JWK). */
export async function laaksoAgent(http: Http, overrides: Partial<Mandate> = {}): Promise<Http & { agentId: string }> {
  const agentId = overrides.agentId ?? uid("agent_laakso");
  const token = await signMandate(demoMandate(new Date(), { mandateId: uid("mnd_laakso"), agentId, ...overrides }), await demoOrgKeyPair());
  return Object.assign(http.with({ authorization: `Mandate ${token}`, "dock-agent-id": agentId }), { agentId });
}

export type Visitor = { http: Http; sandboxId: string; orgId: string; auth: SoftwareAuthenticator; cookie: string };

/** Join by QR code as a phone does: registration options, a software passkey, verify. */
export async function joinAsVisitor(http: Http): Promise<Visitor | { error: string; status: number; ms: number }> {
  const t0 = Date.now();
  const begin = await http.post("/api/v1/join", {});
  if (begin.status !== 200) return { error: `join ${begin.status} ${begin.body?.error?.code ?? begin.error ?? ""}`, status: begin.status, ms: Date.now() - t0 };
  const origin = new URL(http.base).origin;
  const auth = new SoftwareAuthenticator(origin);
  const response = auth.register(begin.body.options, origin);
  const verify = await http.post("/api/v1/join/verify", { response });
  if (verify.status !== 201) return { error: `verify ${verify.status} ${verify.body?.error?.code ?? verify.error ?? ""}`, status: verify.status, ms: Date.now() - t0 };
  const cookie = (verify.headers.get("set-cookie") ?? "").split(";")[0];
  const s = verify.body.sandbox;
  return { http: http.with({ cookie }), sandboxId: s.sandboxId, orgId: s.orgId, auth, cookie };
}

export const isVisitor = (v: Visitor | { error: string }): v is Visitor => "sandboxId" in v;

/** Approve or decline with the visitor's passkey, the way /approve/<id> does. */
export async function passkeyDecide(v: Visitor, approvalId: string, decision: "approve" | "decline"): Promise<Reply> {
  const ch = await v.http.post(`/api/v1/approvals/${approvalId}/challenge`, { decision });
  if (ch.status !== 200) return ch;
  const response = v.auth.assert(ch.body.options, { origin: new URL(v.http.base).origin });
  const r = await v.http.post(`/api/v1/approvals/${approvalId}`, { decision, proof: { kind: "webauthn", response } });
  return { ...r, ms: r.ms + ch.ms };
}

/** The console's back end for one kitchen (the server holds the mandate). */
export function consoleCall(http: Http, kitchen: string) {
  return (method: "GET" | "POST", path: string, body?: unknown) => http.post(`/ui-api/kitchens/${kitchen}/call`, { method, path, ...(body === undefined ? {} : { body }) });
}

export type Caller = (method: "GET" | "POST", path: string, body?: unknown) => Promise<Reply>;
export const restCaller = (a: Http): Caller => (m, p, b) => (m === "GET" ? a.get(p) : a.post(p, b));

/** What the console shows for an interpret reply (src/app/_client/interpret.ts + k/[kitchen]/console.tsx). */
export function consoleInterpretView(r: Reply): { kind: string; offersRetry: boolean; offersOffline: boolean; message?: string } {
  if (r.status >= 200 && r.status < 300 && r.body?.need) return { kind: "ok", offersRetry: false, offersOffline: false };
  const code = r.body?.error?.code;
  const message = r.body?.error?.message ?? r.error;
  if (code === "need_incomplete") return { kind: "incomplete", offersRetry: false, offersOffline: false, message };
  if (code === "not_a_purchase_request") return { kind: "not_purchase", offersRetry: false, offersOffline: false, message };
  if (r.status === 0 || r.status >= 500) return { kind: "unavailable", offersRetry: true, offersOffline: true, message };
  return { kind: "error", offersRetry: false, offersOffline: false, message };
}
