import * as index from "@/app/api/v1/route";
import * as approval from "@/app/api/v1/approvals/[approvalId]/route";
import * as approvals from "@/app/api/v1/approvals/route";
import * as availability from "@/app/api/v1/availability/route";
import * as outbox from "@/app/api/v1/dev/outbox/route";
import * as keys from "@/app/api/v1/keys/route";
import * as ledger from "@/app/api/v1/ledger/route";
import * as order from "@/app/api/v1/orders/[orderId]/route";
import * as orders from "@/app/api/v1/orders/route";
import * as products from "@/app/api/v1/products/route";
import * as quotes from "@/app/api/v1/quotes/route";
import * as requests from "@/app/api/v1/requests/route";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type RouteModule = Partial<Record<"GET" | "POST", Handler>>;

const routes: [RegExp, string[], RouteModule][] = [
  [/^\/api\/v1$/, [], index],
  [/^\/api\/v1\/requests$/, [], requests],
  [/^\/api\/v1\/products$/, [], products],
  [/^\/api\/v1\/availability$/, [], availability],
  [/^\/api\/v1\/quotes$/, [], quotes],
  [/^\/api\/v1\/orders$/, [], orders],
  [/^\/api\/v1\/orders\/([^/]+)$/, ["orderId"], order as RouteModule],
  [/^\/api\/v1\/approvals$/, [], approvals],
  [/^\/api\/v1\/approvals\/([^/]+)$/, ["approvalId"], approval as RouteModule],
  [/^\/api\/v1\/ledger$/, [], ledger],
  [/^\/api\/v1\/keys$/, [], keys],
  [/^\/api\/v1\/dev\/outbox$/, [], outbox],
];

/**
 * Calls the real route handlers in-process, without a server. Same Request in, same Response out as over HTTP.
 * Used by the demo script (default mode) and the HTTP tests.
 */
export async function localFetch(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  for (const [pattern, names, mod] of routes) {
    const m = pattern.exec(pathname);
    if (!m) continue;
    const handler = mod[req.method as "GET" | "POST"];
    if (!handler) return Response.json({ error: { code: "method_not_allowed", message: `${req.method} ${pathname}` } }, { status: 405 });
    const params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    return handler(req, { params: Promise.resolve(params) });
  }
  return Response.json({ error: { code: "not_found", message: pathname } }, { status: 404 });
}
