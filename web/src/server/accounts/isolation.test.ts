import { beforeEach, describe, expect, it } from "vitest";
import { GET as approvalGet } from "@/app/api/v1/approvals/[approvalId]/route";
import { GET as approvalsGet } from "@/app/api/v1/approvals/route";
import { GET as ledgerGet } from "@/app/api/v1/ledger/route";
import { GET as orderGet } from "@/app/api/v1/orders/[orderId]/route";
import { getRuntime, resetRuntime } from "../runtime";
import { ACCOUNT_COOKIE } from "./http";
import { DEFAULT_TERMS } from "./terms";

/**
 * Two restaurants, each with an account and a kitchen. Everything one of them can name about the other (its
 * kitchen's address in every store route, an order, a sign-off, a request, a thread) is tried with the other's
 * session and with the other's agent mandate. Nothing may come back but a refusal.
 */
const BASE = "http://dock.test";
const routes = import.meta.glob("/src/app/ui-api/**/route.ts");
const kitchenRoutes = Object.keys(routes).filter((p) => p.includes("[kitchen]")).sort();

beforeEach(() => resetRuntime());

async function twoKitchens() {
  const rt = await getRuntime();
  const sign = async (username: string) => {
    const s = await rt.accounts.signUp({ restaurant: `Ravintola ${username}`, username, password: `a long enough passphrase ${username}` }, `198.51.100.${username.length}`);
    await rt.accounts.signKitchen(username, DEFAULT_TERMS);
    const k = (await rt.accounts.kitchenOf(username))!.kitchen;
    return { username, cookie: `${ACCOUNT_COOKIE}=${s.token}`, k, session: await rt.dock.authenticate(k.mandateToken, k.agentId) };
  };
  const a = await sign("alfa");
  const b = await sign("bravo");
  // Alfa has an order waiting for its signer: more than its agent may spend alone.
  const req = await rt.dock.openRequest(a.session, { text: "milk" });
  const packs = Math.ceil((a.k.mandate.perOrderLimitCents + 5_000) / 149);
  const q = await rt.dock.requestQuote(a.session, { requestId: req.requestId, lines: [{ productId: "VA-1001", quantity: packs }] });
  const order = await rt.dock.placeOrder(a.session, { requestId: req.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) });
  expect(order.status).toBe("pending_approval");
  return { rt, a, b, order, requestId: req.requestId, approvalId: order.approval!.approvalId };
}

describe("one restaurant cannot reach another's kitchen", () => {
  it(`through any store route that takes a kitchen (${kitchenRoutes.length} route files), with its own session or with none`, async () => {
    const { a, b, approvalId, requestId, order } = await twoKitchens();
    expect(kitchenRoutes.length).toBeGreaterThan(20);
    const params = { kitchen: a.username, approvalId, requestId, orderId: order.orderId, planId: "plan_0000000000000000", callId: "call_0000000000000000", productId: "VA-1001", threadId: "thr_0000000000000000" };
    const secrets = ["Ravintola alfa", order.orderId, requestId, approvalId, a.k.mandate.mandateId, a.k.agentId, a.k.mandateToken];
    const leaks: string[] = [];
    for (const path of kitchenRoutes) {
      const mod = (await routes[path]()) as Record<string, ((req: Request, ctx: { params: Promise<typeof params> }) => Promise<Response>) | undefined>;
      const url = `${BASE}${path.replace("/src/app", "").replace("/route.ts", "").replace(/\[(\w+)\]/g, (_, n: keyof typeof params) => params[n] ?? "x")}`;
      for (const method of ["GET", "POST"] as const) {
        const handler = mod[method];
        if (!handler) continue;
        for (const [who, cookie] of [["another account", b.cookie], ["nobody", ""]] as const) {
          // One body that is well-formed for every route here (the console call, the thread, the photo door, voice).
          const body = { method: "GET", path: "/api/v1/kitchen", text: "100 litres of milk", action: "get", requestId, name: "submit_request", callId: params.callId, args: { request: "milk" }, op: "end" };
          const init: RequestInit = { method, headers: { ...(cookie ? { cookie } : {}), ...(method === "POST" ? { "content-type": "application/json" } : {}) }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) };
          const res = await handler(new Request(url, init), { params: Promise.resolve(params) });
          const text = await res.text();
          // A refusal, or an answer that carries nothing of Alfa's (ending a call that does not exist says only that).
          const names = secrets.filter((x) => text.includes(x));
          if (names.length || (res.status < 400 && text.length > 40)) leaks.push(`${method} ${path.replace("/src/app", "")} as ${who}: ${res.status} ${names.join(",")} ${text.slice(0, 120)}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it("through the open interface with its own agent's mandate: the other's order, sign-off and ledger entries are not there", async () => {
    const { rt, a, b, order, approvalId, requestId } = await twoKitchens();
    const asBravo = { authorization: `Mandate ${b.k.mandateToken}`, "dock-agent-id": b.k.agentId };
    const get = (path: string, headers: Record<string, string> = asBravo) => new Request(`${BASE}${path}`, { headers });
    expect((await orderGet(get(`/api/v1/orders/${order.orderId}`), { params: Promise.resolve({ orderId: order.orderId }) } as never)).status).toBe(404);
    expect((await approvalGet(get(`/api/v1/approvals/${approvalId}`), { params: Promise.resolve({ approvalId }) } as never)).status).toBe(404);
    expect((await approvalGet(get(`/api/v1/approvals/${approvalId}`, { cookie: b.cookie }), { params: Promise.resolve({ approvalId }) } as never)).status).toBe(404);
    const pending = (await (await approvalsGet(get("/api/v1/approvals"))).json()) as { approvals: { orderId: string }[] };
    expect(pending.approvals.some((p) => p.orderId === order.orderId)).toBe(false);
    for (const q of ["", `?requestId=${requestId}`, `?orderId=${order.orderId}`]) {
      const ledger = (await (await ledgerGet(get(`/api/v1/ledger${q}`))).json()) as { entries: { requestId?: string; orderId?: string }[] };
      expect(ledger.entries.filter((e) => e.requestId === requestId || e.orderId === order.orderId)).toEqual([]);
    }
    // Bravo's agent cannot act on Alfa's request, order or quote either.
    await expect(rt.dock.getOrder(b.session, order.orderId)).rejects.toMatchObject({ status: 404 });
    await expect(rt.dock.withdrawOrder(b.session, order.orderId)).rejects.toMatchObject({ status: 404 });
    await expect(rt.dock.requestQuote(b.session, { requestId, lines: [{ productId: "VA-1001", quantity: 1 }] })).rejects.toMatchObject({ status: 404 });
    await expect(rt.dock.intake.get(b.session, requestId)).rejects.toMatchObject({ status: 404 });
    // And Alfa's own agent still can.
    await expect(rt.dock.getOrder(a.session, order.orderId)).resolves.toMatchObject({ status: "pending_approval" });
  });
});
