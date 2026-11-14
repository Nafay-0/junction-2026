import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as approvalRoute from "@/app/api/v1/approvals/[approvalId]/route";
import * as challengeRoute from "@/app/api/v1/approvals/[approvalId]/challenge/route";
import * as linkRoute from "@/app/api/v1/approvals/[approvalId]/link/route";
import * as approverRoute from "@/app/api/v1/approver/route";
import * as demoOrderRoute from "@/app/api/v1/approver/demo-order/route";
import * as eventsRoute from "@/app/api/v1/events/route";
import * as joinRoute from "@/app/api/v1/join/route";
import * as joinVerifyRoute from "@/app/api/v1/join/verify/route";
import * as sandboxesRoute from "@/app/api/v1/sandboxes/route";
import { InMemoryCatalog, MeteredCatalog } from "@/core/catalog";
import { generateEd25519KeyPair } from "@/core/keys";
import { Ledger } from "@/core/ledger";
import { createTrustRegistry } from "@/core/mandate";
import { InMemoryDockRepository, createDock } from "@/core/orders";
import { InMemoryPasskeyStore, PasskeyService } from "@/core/passkeys";
import { InMemoryOutbox } from "@/core/approval";
import { SEED_PRODUCTS, SEED_STOCK } from "@/core/seed";
import { SoftwareAuthenticator } from "@/core/test-webauthn";
import { addMinutes } from "@/core/util";
import { getRuntime, resetRuntime } from "./runtime";
import { SandboxService } from "./sandboxes";

const BASE = "https://dock.test";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function request(method: string, path: string, opts: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.cookie) headers.cookie = opts.cookie;
  return new Request(BASE + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

async function json(res: Response | Promise<Response>): Promise<{ status: number; body: Json; headers: Headers }> {
  const r = await res;
  return { status: r.status, body: (await r.json()) as Json, headers: r.headers };
}

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

/** Scan the QR code, make a passkey, land signed in. Returns the cookie and the phone's authenticator. */
async function join() {
  const auth = new SoftwareAuthenticator(BASE);
  const start = await json(joinRoute.POST(request("POST", "/api/v1/join")));
  expect(start.status).toBe(200);
  expect(start.body.identity.kitchenName).toMatch(/kitchen$/);
  const done = await json(joinVerifyRoute.POST(request("POST", "/api/v1/join/verify", { body: { response: auth.register(start.body.options) } })));
  expect(done.status).toBe(201);
  const setCookie = done.headers.get("set-cookie")!;
  expect(setCookie).toMatch(/^dock_approver=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
  return { auth, cookie: setCookie.split(";")[0], sandbox: done.body.sandbox as Json };
}

/** Collect SSE events from a streaming response until `count` arrived. */
function collect(res: Response, count: number): Promise<Json[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: Json[] = [];
  let buffer = "";
  return (async () => {
    while (events.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let i;
      while ((i = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        const data = block.split("\n").find((l) => l.startsWith("data: "));
        if (data) events.push(JSON.parse(data.slice(6)));
      }
    }
    await reader.cancel();
    return events;
  })();
}

const envBackup = { ...process.env };

beforeEach(() => {
  resetRuntime();
  delete process.env.DOCK_DEMO_TAP_APPROVAL;
  delete process.env.DOCK_SANDBOX_MAX;
  delete process.env.DOCK_PUBLIC_URL;
});
afterEach(() => {
  process.env = { ...envBackup };
});

describe("phone approval over HTTP", () => {
  it("join by QR -> agent order over the limit -> live event -> passkey approve -> committed", async () => {
    const { auth, cookie, sandbox } = await join();

    const me = await json(approverRoute.GET(request("GET", "/api/v1/approver", { cookie })));
    expect(me.body).toMatchObject({ approver: { roleLabel: "Purchasing manager", passkey: true }, agent: { perOrderLimit: "€500" }, pending: [] });
    expect((await json(approverRoute.GET(request("GET", "/api/v1/approver")))).status).toBe(401);

    const stream = await eventsRoute.GET(request("GET", "/api/v1/events?scope=mine", { cookie }));
    expect(stream.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const live = collect(stream, 3);

    const placed = await json(demoOrderRoute.POST(request("POST", "/api/v1/approver/demo-order", { cookie })));
    expect(placed.status).toBe(201);
    expect(placed.body.order.status).toBe("pending_approval");
    const approvalId = placed.body.order.approvalId as string;

    const view = (await json(approvalRoute.GET(request("GET", `/api/v1/approvals/${approvalId}`, { cookie }), params({ approvalId })))).body.view;
    expect(view).toMatchObject({ state: "pending", signIn: "passkey", viewerIsApprover: true, kitchenName: expect.stringContaining(sandbox.kitchenName) });
    expect(view.why).toContain("Over this agent's €500 per-order limit");
    expect(view.differences.join(" ")).toMatch(/instead of/);
    expect(view.items.map((i: Json) => i.amount)).toEqual(["600 L", "400 L"]);
    expect(view.delivery).toMatch(/^[A-Z][a-z]+day \d+ [A-Z][a-z]+$/);
    expect(JSON.stringify({ ...view, details: undefined, approvalId: undefined })).not.toMatch(/apr_|ord_|org_|VA-|AR-/);

    expect((await json(linkRoute.GET(request("GET", `/api/v1/approvals/${approvalId}/link`), params({ approvalId })))).status).toBe(404); // a stranger cannot tell it exists
    expect((await json(approvalRoute.GET(request("GET", `/api/v1/approvals/${approvalId}`), params({ approvalId })))).status).toBe(404);
    const link = await json(linkRoute.GET(request("GET", `/api/v1/approvals/${approvalId}/link`, { cookie }), params({ approvalId })));
    expect(link.body).toMatchObject({ url: `${BASE}/approve/${approvalId}`, qrPayload: `${BASE}/approve/${approvalId}` });
    expect(link.body.qrSvg).toMatch(/^<svg/);

    const ch = await json(challengeRoute.POST(request("POST", `/api/v1/approvals/${approvalId}/challenge`, { body: { decision: "approve" } }), params({ approvalId })));
    expect(ch.body.options.rpId).toBe("dock.test");
    expect(ch.body.options.allowCredentials).toEqual([{ id: auth.id, type: "public-key", transports: ["internal"] }]);
    const decided = await json(
      approvalRoute.POST(
        request("POST", `/api/v1/approvals/${approvalId}`, { body: { decision: "approve", proof: { kind: "webauthn", response: auth.assert(ch.body.options) } } }),
        params({ approvalId }),
      ),
    );
    expect(decided.status).toBe(200);
    expect(decided.body.order.status).toBe("committed");
    expect(decided.body.view).toMatchObject({ state: "committed", outcome: { decision: "approved", method: "passkey", verified: true } });

    expect((await live).map((e) => e.type)).toEqual(["approval_requested", "approval_approved", "order_committed"]);

    const { dock } = await getRuntime();
    const entry = dock.ledger.entries({ orderId: decided.body.order.orderId }).find((e) => e.type === "approval")!;
    expect(entry.summary).toMatch(/signed with a passkey/);
    expect(dock.ledger.verify().ok).toBe(true);
  });

  it("declines in one tap from the joined phone; another phone cannot", async () => {
    const a = await join();
    const b = await join();
    const placed = await json(demoOrderRoute.POST(request("POST", "/api/v1/approver/demo-order", { cookie: a.cookie })));
    const approvalId = placed.body.order.approvalId as string;
    const body = { decision: "decline", note: "Too expensive", proof: { kind: "session" } };
    const intruder = await json(approvalRoute.POST(request("POST", `/api/v1/approvals/${approvalId}`, { body, cookie: b.cookie }), params({ approvalId })));
    expect(intruder.status).toBe(403);
    expect(intruder.body.error.details.reason).toBe("wrong_approver");
    const anon = await json(approvalRoute.POST(request("POST", `/api/v1/approvals/${approvalId}`, { body }), params({ approvalId })));
    expect(anon.status).toBe(401);
    const ok = await json(approvalRoute.POST(request("POST", `/api/v1/approvals/${approvalId}`, { body, cookie: a.cookie }), params({ approvalId })));
    expect(ok.status).toBe(200);
    expect(ok.body.view).toMatchObject({ state: "declined", outcome: { decision: "declined", note: "Too expensive", method: "approver_session" } });
  });

  it("the demo-only tap fallback is off unless DOCK_DEMO_TAP_APPROVAL is set, and is marked unverified", async () => {
    expect((await json(joinVerifyRoute.POST(request("POST", "/api/v1/join/verify", { body: { fallback: true } })))).status).toBe(403);
    const { cookie } = await join();
    const placed = await json(demoOrderRoute.POST(request("POST", "/api/v1/approver/demo-order", { cookie })));
    const approvalId = placed.body.order.approvalId as string;
    const tap = () => json(approvalRoute.POST(request("POST", `/api/v1/approvals/${approvalId}`, { body: { decision: "approve", proof: { kind: "demo_tap" } }, cookie }), params({ approvalId })));
    const off = await tap();
    expect(off.status).toBe(403);
    expect(off.body.error.details.reason).toBe("demo_tap_disabled");

    process.env.DOCK_DEMO_TAP_APPROVAL = "1";
    const view = (await json(approvalRoute.GET(request("GET", `/api/v1/approvals/${approvalId}`, { cookie }), params({ approvalId })))).body.view;
    expect(view.demoTapEnabled).toBe(true);
    const on = await tap();
    expect(on.status).toBe(200);
    expect(on.body.view.outcome).toMatchObject({ method: "demo_tap", verified: false });

    const fallback = await json(joinVerifyRoute.POST(request("POST", "/api/v1/join/verify", { body: { fallback: true } })));
    expect(fallback.status).toBe(201);
    expect(fallback.body.sandbox.passkey).toBe(false);
  });

  it("caps how many kitchens exist and keeps their secrets off the big screen", async () => {
    process.env.DOCK_SANDBOX_MAX = "1";
    await join();
    const full = await json(joinRoute.POST(request("POST", "/api/v1/join")));
    expect(full.status).toBe(503);
    expect(full.body.error.code).toBe("sandbox_full");
    const list = await json(sandboxesRoute.GET(request("GET", "/api/v1/sandboxes")));
    expect(list.body.sandboxes).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toMatch(/mandateToken|privateKey|"d":/);
  });
});

describe("visitor kitchens", () => {
  it("expire after their time to live; the phone is signed out and the passkey removed", async () => {
    let now = new Date("2026-11-13T10:00:00Z");
    const passkeys = new PasskeyService({ store: new InMemoryPasskeyStore(), now: () => now });
    const registry = createTrustRegistry([]);
    const dock = createDock({
      catalog: new MeteredCatalog(new InMemoryCatalog(SEED_PRODUCTS, SEED_STOCK, () => now)),
      repo: new InMemoryDockRepository(),
      ledger: new Ledger(undefined, () => now),
      trustedIssuers: registry,
      wholesalerKey: await generateEd25519KeyPair("w"),
      notifier: new InMemoryOutbox(),
      verifier: passkeys.verifier,
      now: () => now,
    });
    const sandboxes = new SandboxService({ dock, registry, passkeys, limits: () => ({ max: 5, ttlMinutes: 60 }), now: () => now });
    const rp = { id: "dock.test", name: "Dock", origins: [BASE] };
    const { options } = await sandboxes.beginJoin(rp);
    const { sandbox, sessionToken } = await sandboxes.completeJoin(new SoftwareAuthenticator(BASE).register(options));
    expect(await passkeys.sessionApprover(sessionToken)).toBeDefined();
    expect((await sandboxes.runDemoOrder(sandbox.sandboxId)).status).toBe("pending_approval");

    now = addMinutes(now, 61);
    expect(await sandboxes.list()).toEqual([]);
    expect(await passkeys.sessionApprover(sessionToken)).toBeUndefined();
    expect(await passkeys.store.getAccount(sandbox.approverId)).toBeUndefined();
    await expect(sandboxes.runDemoOrder(sandbox.sandboxId)).rejects.toMatchObject({ code: "sandbox_not_found" });
  });
});
