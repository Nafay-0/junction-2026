import { NextResponse, type NextRequest } from "next/server";
import { RateLimiter, clientAddress, rateLimitsEnabled, type RateRule } from "@/server/limits";

/**
 * The public server's front door: per-address (and per-kitchen) rate limits, a body-size cap, and dev-only
 * routes closed in production. Money and partner quota are capped again where they are spent (limits.ts),
 * because the buyer console forwards its calls in-process and never passes through here a second time.
 */

const MAX_BODY_BYTES = 64 * 1024;
const MIN = 60_000;
const rule = (name: string, limit: number): RateRule => ({ name, limit, windowMs: MIN });

// Generous per address: at a venue many phones share one public address.
const ANY = rule("any", 900);
const PAGE = rule("page", 300);
const INTERPRET = rule("interpret", 20);
const CONSOLE_CALL = rule("console-call", 60);
const CONSOLE_CALL_KITCHEN = rule("console-call-kitchen", 120);
const JOIN = rule("join", 30);
const DEMO_ORDER = rule("demo-order", 12);
const DEMO_ORDER_KITCHEN = rule("demo-order-kitchen", 6);
const AGENT_WRITE = rule("agent-write", 120);
const EVENTS = rule("events", 60);
const ASSISTANT = rule("assistant", 20);
const ASSISTANT_KITCHEN = rule("assistant-kitchen", 60);
const LIVE_LOOKUP = rule("catalog-live", 30);
const KITCHEN_WRITE = rule("kitchen-write", 60);
const KITCHEN_WRITE_KITCHEN = rule("kitchen-write-kitchen", 120);
const OPS_ENTER = rule("ops-enter", 10);
const MENU_PLAN = rule("menu-plan", 6);
const MENU_PLAN_KITCHEN = rule("menu-plan-kitchen", 12);

const g = globalThis as typeof globalThis & { __dockRateLimiter?: RateLimiter };
const limiter = (g.__dockRateLimiter ??= new RateLimiter());

function refuse(status: number, code: string, message: string, rule: string, headers: Record<string, string> = {}) {
  return NextResponse.json({ error: { code, rule, message } }, { status, headers: { "cache-control": "no-store", ...headers } });
}

/** The rules a request counts against: [rule, key-suffix]. */
function rulesFor(method: string, path: string): [RateRule, string?][] {
  const api = path.startsWith("/api/") || path.startsWith("/ui-api/");
  const out: [RateRule, string?][] = [[ANY]];
  if (!api) out.push([PAGE]);
  const post = method === "POST";
  let m: RegExpExecArray | null;
  if (post && path === "/api/v1/agent/interpret") out.push([INTERPRET]);
  if (post && (m = /^\/ui-api\/kitchens\/([^/]+)\/call$/.exec(path))) out.push([CONSOLE_CALL], [CONSOLE_CALL_KITCHEN, `k:${m[1]}`]);
  if (post && path.startsWith("/api/v1/join")) out.push([JOIN]);
  if (post && (m = /^\/api\/v1\/sandboxes\/([^/]+)\/demo-order$/.exec(path))) out.push([DEMO_ORDER], [DEMO_ORDER_KITCHEN, `k:${m[1]}`]);
  if (post && path === "/api/v1/approver/demo-order") out.push([DEMO_ORDER]);
  if (post && (path === "/api/mcp" || path.startsWith("/api/mcp/c/") || /^\/api\/v1\/(availability|quotes|orders|requests|intake)/.test(path))) out.push([AGENT_WRITE]);
  if (path === "/api/v1/events") out.push([EVENTS]);
  // The kitchen store (/k): the assistant calls the model, catalog/live the partner's live API, basket the gate.
  if (post && (m = /^\/ui-api\/kitchens\/([^/]+)\/assistant$/.exec(path))) out.push([ASSISTANT], [ASSISTANT_KITCHEN, `k:${m[1]}`]);
  if (post && /^\/ui-api\/kitchens\/[^/]+\/catalog\/live$/.test(path)) out.push([LIVE_LOOKUP]);
  if (post && (m = /^\/ui-api\/kitchens\/([^/]+)\/(basket|memory)$/.exec(path))) out.push([KITCHEN_WRITE], [KITCHEN_WRITE_KITCHEN, `k:${m[1]}`]);
  // The menu planner: one plan is several model calls (outline, each dish, picks, fixes) and live lookups.
  if (post && (m = /^\/ui-api\/plan\/([^/]+)(\/[^/]+)?$/.exec(path))) out.push([MENU_PLAN], [MENU_PLAN_KITCHEN, `k:${m[1]}`]);
  if (post && (m = /^\/ui-api\/plan\/([^/]+)\/[^/]+\/(quote|order)$/.exec(path))) out.push([KITCHEN_WRITE], [KITCHEN_WRITE_KITCHEN, `k:${m[1]}`]);
  // The operations desk: entering takes the passcode, so guessing is slowed down.
  if (post && path === "/ops-api/session") out.push([OPS_ENTER]);
  // Reissuing or revoking a connector takes the operator secret (or the visitor's own session).
  if ((post || method === "DELETE") && path.startsWith("/ui-api/connect/")) out.push([OPS_ENTER]);
  return out;
}

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (process.env.NODE_ENV === "production" && path.startsWith("/api/v1/dev/")) {
    return refuse(404, "not_found", "Not available in production.", "dev_only");
  }

  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return refuse(413, "body_too_large", `Request body is larger than ${MAX_BODY_BYTES / 1024} KB.`, "body_size");
  }

  if (rateLimitsEnabled()) {
    const who = clientAddress(req.headers);
    for (const [r, suffix] of rulesFor(req.method, path)) {
      // Per-kitchen rules are shared by every caller; per-address rules are keyed by the caller.
      const retryAfter = limiter.hit(r, suffix ?? who);
      if (retryAfter !== null) {
        const what = suffix ? "this kitchen" : "your address";
        return refuse(429, "rate_limited", `Too many requests from ${what}; try again in ${retryAfter} s. (Demo server limit "${r.name}".)`, "rate_limit", {
          "retry-after": String(retryAfter),
        });
      }
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
