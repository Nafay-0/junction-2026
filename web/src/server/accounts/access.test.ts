import { beforeEach, describe, expect, it } from "vitest";
import * as accountMe from "@/app/ui-api/account/route";
import * as signup from "@/app/ui-api/account/signup/route";
import * as signin from "@/app/ui-api/account/signin/route";
import * as signout from "@/app/ui-api/account/signout/route";
import * as mandate from "@/app/ui-api/account/mandate/route";
import * as device from "@/app/ui-api/account/device/route";
import * as opsAccounts from "@/app/ops-api/accounts/route";
import * as opsReset from "@/app/ops-api/accounts/reset/route";
import * as ledgerRoute from "@/app/api/v1/ledger/route";
import * as eventsRoute from "@/app/api/v1/events/route";
import * as consoleCall from "@/app/ui-api/kitchens/[kitchen]/call/route";
import * as kitchenRoute from "@/app/ui-api/kitchens/[kitchen]/route";
import * as portalRoute from "@/app/ui-api/kitchens/[kitchen]/portal/route";
import * as basketRoute from "@/app/ui-api/kitchens/[kitchen]/basket/route";
import * as portalMemory from "@/app/ui-api/kitchens/[kitchen]/memory/route";
import * as connectRoute from "@/app/ui-api/kitchens/[kitchen]/connect/route";
import * as connectorRoute from "@/app/ui-api/connect/[kitchen]/route";
import * as approvalRoute from "@/app/ui-api/kitchens/[kitchen]/approval/[approvalId]/route";
import * as memoryBook from "@/app/ui-api/memory/kitchens/[kitchen]/route";
import { enterOps, sessionCookie as opsCookie } from "../ops/access";
import { getRuntime, resetRuntime } from "../runtime";
import { tokenHash } from "./service";
import { DEFAULT_TERMS } from "./terms";

/**
 * One account, one kitchen, private to it (server/authz.ts consoleKitchen, the store layout, every console route):
 * another account, an anonymous visitor, an expired session, a forged or tampered cookie and a signed-out cookie
 * all get nothing; the operations desk sees every kitchen; changes need the account's own session and same origin.
 */
const BASE = "https://dock.test";
const json = { "content-type": "application/json", origin: BASE };
const params = (kitchen: string) => ({ params: Promise.resolve({ kitchen }) }) as never;

beforeEach(() => {
  resetRuntime();
  process.env.DOCK_CATALOG = "seed";
  process.env.DOCK_MEMORY_LLM = "off";
});

const post = (path: string, body: unknown, cookie?: string, extra: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, { method: "POST", headers: { ...json, ...(cookie ? { cookie } : {}), ...extra }, body: JSON.stringify(body) });
const get = (path: string, cookie?: string) => new Request(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

/** Sign up and sign the default mandate (a €300 limit): returns the account's cookie. */
async function openAccount(username: string, restaurant: string): Promise<string> {
  const res = await signup.POST(post("/ui-api/account/signup", { restaurant, username, password: "a-long-password" }));
  expect(res.status).toBe(201);
  const cookie = cookieOf(res);
  expect((await mandate.POST(post("/ui-api/account/mandate", { terms: DEFAULT_TERMS }, cookie))).status).toBe(201);
  return cookie;
}

const viaConsole = (kitchen: string, call: unknown, cookie?: string, extra: Record<string, string> = {}) => consoleCall.POST(post(`/ui-api/kitchens/${kitchen}/call`, call, cookie, extra), params(kitchen));

type Quote = { requestId: string; quoteToken: string; quote: { lines: { productId: string; quantity: number; unitPriceCents: number }[] } };

/** The basket's path through the gate: a request and a fixed price (seed catalogue), then the order. */
async function placeBasket(kitchen: string, cookie: string, packs: number) {
  const q = (await (await basketRoute.POST(post(`/ui-api/kitchens/${kitchen}/basket`, { lines: [{ productId: "VA-1010", packs }] }, cookie), params(kitchen))).json()) as Quote;
  expect(q.quoteToken).toBeTruthy();
  const res = await viaConsole(kitchen, { method: "POST", path: "/api/v1/orders", body: { requestId: q.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) } }, cookie);
  return (await res.json()).order as { orderId: string; status: string; approval?: { approvalId: string } };
}

async function orderWithinLimit(kitchen: string, cookie: string): Promise<string> {
  const order = await placeBasket(kitchen, cookie, 2);
  expect(order.status).toBe("committed");
  return order.orderId;
}

describe("account isolation", () => {
  it("the kitchen's own account reads and orders; another account, an anonymous visitor and forged cookies get nothing", async () => {
    const a = await openAccount("aalto", "Ravintola Aalto");
    const b = await openAccount("bistro-b", "Bistro B");
    const orderId = await orderWithinLimit("aalto", a);

    // Own account: the console, the portal overview with its order.
    const mine = await portalRoute.GET(get("/ui-api/kitchens/aalto/portal", a), params("aalto"));
    expect(mine.status).toBe(200);
    expect(JSON.stringify(await mine.json())).toContain(orderId);

    const rt = await getRuntime();
    const token = decodeURIComponent(a.split("=")[1]);
    const tampered = `dock_account=${token.slice(0, -2)}xy`;
    const forged = `dock_account=${tokenHash(token)}`; // the stored hash is not a cookie
    for (const [who, cookie, status] of [
      ["another account", b, 403],
      ["anonymous", undefined, 401],
      ["tampered cookie", tampered, 401],
      ["forged cookie", forged, 401],
      ["another account's approver cookie", "dock_approver=abc", 401],
    ] as const) {
      const portal = await portalRoute.GET(get("/ui-api/kitchens/aalto/portal", cookie), params("aalto"));
      expect(portal.status, who).toBe(status);
      expect(JSON.stringify(await portal.json()), who).not.toContain(orderId);
      expect((await kitchenRoute.GET(get("/ui-api/kitchens/aalto", cookie), params("aalto"))).status, who).toBe(status);
      expect((await viaConsole("aalto", { method: "GET", path: "/api/v1/ledger" }, cookie)).status, who).toBe(status);
      expect((await viaConsole("aalto", { method: "POST", path: "/api/v1/intake", body: { text: "milk" } }, cookie)).status, who).toBe(status);
      expect((await basketRoute.POST(post("/ui-api/kitchens/aalto/basket", { lines: [{ productId: "VA-1010", packs: 1 }] }, cookie), params("aalto"))).status, who).toBe(status);
      expect((await connectRoute.GET(get("/ui-api/kitchens/aalto/connect", cookie), params("aalto"))).status, who).toBe(status); // carries the mandate
      expect((await connectorRoute.GET(get("/ui-api/connect/aalto", cookie), params("aalto"))).status, who).toBe(status);
      expect((await memoryBook.GET(get("/ui-api/memory/kitchens/aalto", cookie), params("aalto"))).status, who).toBe(status);
      // The public ledger and event stream show this kitchen's entries to nobody else.
      const ledger = await (await ledgerRoute.GET(get("/api/v1/ledger", cookie))).json();
      expect(JSON.stringify(ledger.entries), who).not.toContain(orderId);
      expect((await eventsRoute.GET(get(`/api/v1/events?orgId=org_acct_aalto`, cookie))).status, who).toBe(403);
    }
    // The account itself sees its own entries in the ledger and may follow its own events.
    const own = await (await ledgerRoute.GET(get("/api/v1/ledger", a))).json();
    expect(JSON.stringify(own.entries)).toContain(orderId);
    const stream = await eventsRoute.GET(get(`/api/v1/events?orgId=org_acct_aalto`, a));
    expect(stream.status).toBe(200);
    await stream.body?.cancel();
    // B's own kitchen does not list A's.
    const bInfo = await (await kitchenRoute.GET(get("/ui-api/kitchens/bistro-b", b), params("bistro-b"))).json();
    expect(bInfo.kitchens.map((k: { slug: string }) => k.slug)).not.toContain("aalto");
    expect(rt).toBeTruthy();
  });

  it("an expired session and a signed-out cookie stop working everywhere", async () => {
    const a = await openAccount("aalto", "Ravintola Aalto");
    const second = cookieOf(await signin.POST(post("/ui-api/account/signin", { username: "aalto", password: "a-long-password" })));
    expect((await portalRoute.GET(get("/ui-api/kitchens/aalto/portal", second), params("aalto"))).status).toBe(200);
    const out = await signout.POST(post("/ui-api/account/signout", {}, second));
    expect(out.headers.get("set-cookie")).toMatch(/dock_account=;.*Max-Age=0/);
    expect((await portalRoute.GET(get("/ui-api/kitchens/aalto/portal", second), params("aalto"))).status).toBe(401);
    expect((await (await accountMe.GET(get("/ui-api/account", second))).json()).account).toBeNull();
    // The other session is still signed in, until it expires.
    expect((await portalRoute.GET(get("/ui-api/kitchens/aalto/portal", a), params("aalto"))).status).toBe(200);
    const rt = await getRuntime();
    const h = tokenHash(decodeURIComponent(a.split("=")[1]));
    const s = (await rt.accounts.store.getSession(h))!;
    await rt.accounts.store.putSession(h, { ...s, expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect((await portalRoute.GET(get("/ui-api/kitchens/aalto/portal", a), params("aalto"))).status).toBe(401);
  });

  it("the operations desk sees every account's kitchen, and lists accounts with nothing about the person", async () => {
    await openAccount("aalto", "Ravintola Aalto");
    const ops = opsCookie(new Request(BASE), enterOps({ name: "Riikka" })).split(";")[0];
    expect((await portalRoute.GET(get("/ui-api/kitchens/aalto/portal", ops), params("aalto"))).status).toBe(200);
    expect((await opsAccounts.GET(get("/ops-api/accounts"))).status).toBe(401);
    const list = await (await opsAccounts.GET(get("/ops-api/accounts", ops))).json();
    const row = list.accounts.find((r: { kitchen: string }) => r.kitchen === "aalto");
    expect(row).toMatchObject({ restaurant: "Ravintola Aalto", kind: "own", orders: 0 });
    expect(Object.keys(row).sort()).toEqual(["hasKitchen", "kind", "kitchen", "orders", "restaurant", "signedUpAt"]);
    expect(JSON.stringify(list)).not.toMatch(/scrypt|password|privateJwk|"d":/);
    expect((await opsReset.POST(post("/ops-api/accounts/reset", {}))).status).toBe(401);
    expect((await opsReset.POST(post("/ops-api/accounts/reset", {}, ops))).status).toBe(200);
  });
});

describe("account changes need the account's own session, from this site", () => {
  it("rules change only by the kitchen's own account; another account cannot touch them", async () => {
    const a = await openAccount("aalto", "Ravintola Aalto");
    const b = await openAccount("bistro-b", "Bistro B");
    const rule = { action: "rule", family: "milk", dimension: "lactose", choice: "lactose_free" };
    const change = (cookie?: string) => portalMemory.POST(post("/ui-api/kitchens/aalto/memory", rule, cookie), params("aalto"));
    expect((await change()).status).toBe(401);
    expect((await change(b)).status).toBe(403);
    const ok = await change(a);
    expect(ok.status).toBe(200);
    expect(JSON.stringify(await ok.json())).toMatch(/lactose/i);
    // The mandate route acts only on the signed-in account's own kitchen; there is no way to name another.
    const rt = await getRuntime();
    const before = (await rt.accounts.kitchenOf("aalto"))!.kitchen.mandate.mandateId;
    expect((await mandate.POST(post("/ui-api/account/mandate", { terms: { ...DEFAULT_TERMS, perOrderLimitEur: 9999, weeklyBudgetEur: 20000 }, username: "aalto", kitchen: "aalto" }, b))).status).toBe(200);
    expect((await rt.accounts.kitchenOf("aalto"))!.kitchen.mandate.mandateId).toBe(before);
    expect((await mandate.POST(post("/ui-api/account/mandate", { terms: DEFAULT_TERMS }))).status).toBe(401);
  });

  it("a stage kitchen's rules: open to read, changed only while signed in to its account", async () => {
    process.env.DOCK_KAARI_PASSWORD = "stage-password-from-env";
    try {
      resetRuntime();
      const before = await (await viaConsole("kaari", { method: "GET", path: "/api/v1/kitchen" })).json();
      const pref = before.kitchen.stated.find((p: { text: string }) => /lactose/i.test(p.text));
      const forget = (cookie?: string) => portalMemory.POST(post("/ui-api/kitchens/kaari/memory", { action: "forget", preferenceId: pref.id }, cookie), params("kaari"));
      const stranger = await openAccount("aalto", "Ravintola Aalto");
      expect((await forget()).status).toBe(401);
      expect((await forget(stranger)).status).toBe(401);
      expect((await signin.POST(post("/ui-api/account/signin", { username: "kaari", password: "wrong-password" }))).status).toBe(401);
      const kaari = cookieOf(await signin.POST(post("/ui-api/account/signin", { username: "kaari", password: "stage-password-from-env" })));
      expect((await forget(kaari)).status).toBe(200);
    } finally {
      delete process.env.DOCK_KAARI_PASSWORD;
    }
  });

  it("refuses a cross-site request carrying the cookie, and a form post that is not JSON", async () => {
    const a = await openAccount("aalto", "Ravintola Aalto");
    const evil = { origin: "https://evil.example" };
    expect((await viaConsole("aalto", { method: "POST", path: "/api/v1/intake", body: { text: "milk" } }, a, evil)).status).toBe(403);
    expect((await viaConsole("aalto", { method: "POST", path: "/api/v1/intake", body: { text: "milk" } }, a, { origin: "null" })).status).toBe(403);
    const fetchSite = await viaConsole("aalto", { method: "POST", path: "/api/v1/intake", body: { text: "milk" } }, a, { origin: "", "sec-fetch-site": "cross-site" });
    expect(fetchSite.status).toBe(403);
    expect((await mandate.POST(post("/ui-api/account/mandate", { terms: DEFAULT_TERMS }, a, evil))).status).toBe(403);
    expect((await signout.POST(post("/ui-api/account/signout", {}, a, evil))).status).toBe(403);
    expect((await signin.POST(post("/ui-api/account/signin", { username: "aalto", password: "a-long-password" }, undefined, evil))).status).toBe(403);
    const form = new Request(`${BASE}/ui-api/account/signout`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE, cookie: a }, body: "x=1" });
    expect((await signout.POST(form)).status).toBe(415);
    // Still signed in: none of those did anything.
    expect((await (await accountMe.GET(get("/ui-api/account", a))).json()).account.username).toBe("aalto");
  });

  it("session cookies are HttpOnly, SameSite and Secure on https; no route returns the hash", async () => {
    const res = await signup.POST(post("/ui-api/account/signup", { restaurant: "Cafe C", username: "cafe-c", password: "a-long-password" }));
    const set = res.headers.get("set-cookie")!;
    expect(set).toMatch(/^dock_account=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
    const body = JSON.stringify(await res.json());
    const me = JSON.stringify(await (await accountMe.GET(get("/ui-api/account", cookieOf(res)))).json());
    for (const s of [body, me]) expect(s).not.toMatch(/scrypt|passwordHash|a-long-password|privateJwk/);
    const local = await signin.POST(new Request("http://localhost:3107/ui-api/account/signin", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3107" }, body: JSON.stringify({ username: "cafe-c", password: "a-long-password" }) }));
    expect(local.headers.get("set-cookie")).not.toMatch(/Secure/); // plain-http localhost (a local run) only
  });
});

describe("sign-off for an account kitchen", () => {
  it("without a signing device an order above the limit waits, and nothing stands in for the passkey", async () => {
    const a = await openAccount("aalto", "Ravintola Aalto");
    const rt = await getRuntime();
    // 300 L is over the €300 limit: the gate holds it for the signer.
    const placed = { order: await placeBasket("aalto", a, 30) };
    const approvalId = placed.order.approval!.approvalId;
    const qr = await (await approvalRoute.GET(get(`/ui-api/kitchens/aalto/approval/${approvalId}`, a), { params: Promise.resolve({ kitchen: "aalto", approvalId }) } as never)).json();
    expect(qr).toMatchObject({ mode: "no_device", approver: { name: DEFAULT_TERMS.signer } });
    // The one-time link from the outbox is refused: this kitchen's signer signs with a passkey.
    const msg = rt.outbox.messages().find((m) => m.approvalId === approvalId);
    expect(msg).toBeTruthy();
    const token = new URLSearchParams(msg!.link.split("?")[1] ?? "").get("token") ?? msg!.link.split("/").pop()!;
    await expect(rt.dock.decideApproval(approvalId, { decision: "approve", proof: { kind: "link_token", token } })).rejects.toMatchObject({ status: 403 });
    expect((await rt.dock.listOrders()).find((o) => o.orderId === placed.order.orderId)?.status).toBe("pending_approval");
    // Devices: none yet, and a phone link names only this account.
    expect((await (await device.GET(get("/ui-api/account/device", a))).json()).devices).toEqual([]);
    expect((await device.POST(post("/ui-api/account/device", { step: "begin", link: "not-a-real-link" }))).status).toBe(410);
  });
});
