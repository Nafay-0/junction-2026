import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ACCOUNT_COOKIE } from "../accounts/http";
import { DEFAULT_TERMS } from "../accounts/terms";
import { dailyUsage } from "../limits";
import { getRuntime, resetRuntime } from "../runtime";
import { OPS_COOKIE, enterOps } from "./access";
import { WORDS_HIDDEN } from "./viewer";

/**
 * Looking without the passcode. Every operations API route is walked with a viewer (no session): a GET reads and
 * leaves nothing behind (no ledger entry, no model call, no live price call), every other method is refused with 403
 * staff_only. Every route file is either explicitly readable (opsRead, GET only) or staff only (opsRoute): the
 * default for a new route is staff only. Then two own accounts and a viewer: the viewer sees that their orders exist
 * and how they went, never their words; the same browser signed in to one of them sees that one's words in full.
 */
const BASE = "http://dock.test";
const routes = import.meta.glob("/src/app/ops-api/**/route.ts");
const files = Object.keys(routes).sort();
const params = { orderId: "ord_nope", requestId: "req_nope", threadId: "thr_nope", runId: "run_nope" };
type Handler = (req: Request, ctx: { params: Promise<typeof params> }) => Promise<Response>;

beforeEach(() => resetRuntime());

const urlOf = (file: string, query = "") => `${BASE}${file.replace("/src/app", "").replace("/route.ts", "").replace(/\[(\w+)\]/g, (_, n: keyof typeof params) => params[n] ?? "x")}${query}`;

describe("the operations API with no passcode", () => {
  it(`marks every route (${files.length} files): reads explicitly, the rest staff only`, () => {
    expect(files.length).toBeGreaterThan(25);
    for (const f of files) {
      if (f.endsWith("/ops-api/session/route.ts")) continue; // the entry itself
      const src = readFileSync(path.join(process.cwd(), f.replace(/^\//, "")), "utf8");
      for (const m of src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b([\s\S]*?)(?=\nexport |\n*$)/g)) {
        const [, method, body] = m;
        const door = /opsRead\(/.test(body) ? "read" : /opsRoute\(|platformRoute|showRoute\(/.test(body) ? "staff" : "none";
        expect(door, `${f} ${method} goes through opsRead or opsRoute`).not.toBe("none");
        if (method !== "GET") expect(door, `${f} ${method} is staff only`).toBe("staff");
      }
    }
  });

  it("answers every read to a viewer and refuses every other method with 403 staff_only, with no side effect", async () => {
    const rt = await getRuntime();
    const before = { ledger: rt.dock.ledger.readonly().length, usage: JSON.stringify(dailyUsage()) };
    const reads: string[] = [];
    for (const f of files) {
      if (f.endsWith("/ops-api/session/route.ts")) continue;
      const mod = (await routes[f]()) as Record<string, Handler | undefined>;
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
        const h = mod[method];
        if (!h) continue;
        const init: RequestInit = { method, headers: { "x-forwarded-for": "203.0.113.7", ...(method !== "GET" ? { "content-type": "application/json" } : {}) }, ...(method !== "GET" ? { body: JSON.stringify({ action: "suspend", scope: "agent", target: "agent_demo", reason: "test", question: "how many orders?", preset: "valio", passcode: "x" }) } : {}) };
        const res = await h(new Request(urlOf(f, method === "GET" ? "?range=1h" : ""), init), { params: Promise.resolve(params) });
        if (method === "GET") {
          // A read: answered, or "not here" for an id that does not exist, or a service this test server does not run.
          expect([200, 400, 404, 409, 503], `${f} GET`).toContain(res.status);
          if (res.status === 200) reads.push(f);
        } else {
          expect(res.status, `${f} ${method}`).toBe(403);
          expect(((await res.json()) as { error: { code: string } }).error.code).toBe("staff_only");
        }
      }
    }
    expect(reads.length).toBeGreaterThan(15);
    // No read left anything behind: no ledger entry, no model call, no live price call.
    expect(rt.dock.ledger.readonly().length).toBe(before.ledger);
    expect(JSON.stringify(dailyUsage())).toBe(before.usage);
  });

  it("lets staff with the passcode act as before", async () => {
    const s = enterOps({ name: "Tester" });
    const { POST } = await import("@/app/ops-api/control/route");
    const res = await POST(new Request(`${BASE}/ops-api/control`, { method: "POST", headers: { cookie: `${OPS_COOKIE}=${s.token}`, "content-type": "application/json" }, body: JSON.stringify({ action: "resume", suspensionId: "sus_nope" }) }));
    expect(res.status).not.toBe(403);
  });

  it("tells a viewer it is a viewer, with the desk's badges", async () => {
    const { GET } = await import("@/app/ops-api/session/route");
    const body = (await (await GET(new Request(`${BASE}/ops-api/session`))).json()) as { signedIn: boolean; viewer?: boolean; chain?: unknown };
    expect(body).toMatchObject({ signedIn: false, viewer: true });
    expect(body.chain).toBeDefined();
  });
});

describe("whose words a viewer sees", () => {
  async function twoAccounts() {
    const rt = await getRuntime();
    const sign = async (username: string, words: string) => {
      const s = await rt.accounts.signUp({ restaurant: `Ravintola ${username}`, username, password: `a long enough passphrase ${username}` }, `198.51.100.${username.length}`);
      await rt.accounts.signKitchen(username, DEFAULT_TERMS);
      const k = (await rt.accounts.kitchenOf(username))!.kitchen;
      const session = await rt.dock.authenticate(k.mandateToken, k.agentId);
      const req = await rt.dock.openRequest(session, { text: words });
      const q = await rt.dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: "VA-1001", quantity: 2 }] });
      const order = await rt.dock.placeOrder(session, { requestId: req.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) });
      return { cookie: `${ACCOUNT_COOKIE}=${s.token}`, order, words, restaurant: `Ravintola ${username}` };
    };
    return { rt, a: await sign("alfa", "Alfa's secret wording about two cartons of milk"), b: await sign("bravo", "Bravo's private note: milk for the staff party") };
  }

  it("shows a viewer their orders and outcomes, never their words; the signed-in kitchen its own words", async () => {
    const { a, b } = await twoAccounts();
    const order = (await import("@/app/ops-api/orders/[orderId]/route")).GET;
    const trace = (await import("@/app/ops-api/trace/[requestId]/route")).GET;
    const list = (await import("@/app/ops-api/orders/route")).GET;
    const ledger = (await import("@/app/ops-api/ledger/route")).GET;
    const read = async (h: Handler, url: string, p: Partial<typeof params>, cookie = "") => {
      const res = await h(new Request(url, { headers: { ...(cookie ? { cookie } : {}), "x-forwarded-for": `203.0.113.${cookie.length % 200}` } }), { params: Promise.resolve({ ...params, ...p }) });
      expect(res.status).toBe(200);
      return res.text();
    };
    // A viewer: the orders are there, with their kitchen, total and outcome; the words are not.
    const viewerList = await read(list as Handler, `${BASE}/ops-api/orders`, {});
    expect(viewerList).toContain(a.order.orderId);
    expect(viewerList).toContain(b.restaurant);
    for (const x of [a, b]) {
      const t = await read(order as Handler, `${BASE}/ops-api/orders/${x.order.orderId}`, { orderId: x.order.orderId });
      expect(t).toContain(x.order.orderId);
      expect(t).not.toContain(x.words);
      expect(t).toContain(WORDS_HIDDEN);
      const tr = await read(trace as Handler, `${BASE}/ops-api/trace/${x.order.requestId}`, { requestId: x.order.requestId });
      expect(tr).not.toContain(x.words);
    }
    const chain = JSON.parse(await read(ledger as Handler, `${BASE}/ops-api/ledger`, {})) as { entries: { summary: string; withheld?: string }[] };
    expect(JSON.stringify(chain)).not.toContain(a.words);
    expect(chain.entries.some((e) => e.withheld === "buyer_words")).toBe(true);
    // The same browser signed in to Alfa's kitchen: Alfa's words in full, Bravo's still hidden.
    const mine = await read(order as Handler, `${BASE}/ops-api/orders/${a.order.orderId}?as=alfa`, { orderId: a.order.orderId }, a.cookie);
    expect(mine).toContain(a.words);
    const theirs = await read(order as Handler, `${BASE}/ops-api/orders/${b.order.orderId}?as=alfa`, { orderId: b.order.orderId }, a.cookie);
    expect(theirs).not.toContain(b.words);
    // Staff with the passcode: everything.
    const s = enterOps({ name: "Staff" });
    const staff = await read(order as Handler, `${BASE}/ops-api/orders/${b.order.orderId}`, { orderId: b.order.orderId }, `${OPS_COOKIE}=${s.token}`);
    expect(staff).toContain(b.words);
  });
});
