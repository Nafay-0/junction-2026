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
//
// Measured on a production build (scripts/edge-cost.ts, 14 Nov 2026): one ordinary order through the kitchen store
// on a phone (/k/kaari: open the shop, the catalogue and a product, ask the agent in words, take the cards to a fixed
// price, place it) and one minute on the sign-off screen cost
//   any 83 (30 browsing, 16 ordering, 37 per minute waiting), page 20, console-call 46 (11 ordering, 35 per minute
//   waiting: the order every 3 s and the ledger every 4 s while the event stream is open), catalog-live 1, events 3.
// The limits below hold ten visitors doing that at the same minute behind one venue address, all on the same demo
// kitchen, with about 30 % headroom. Money is not protected here: the daily model and partner caps (limits.ts), the
// per-caller interpret allowance and the per-agent live-lookup allowance stay as they were.
const ANY = rule("any", 1500); // 10 x 83 = 830
const PAGE = rule("page", 300); // 10 x 20 = 200
const INTERPRET = rule("interpret", 20); // outside agents calling the reader directly; the store's reader goes through console-call
const CONSOLE_CALL = rule("console-call", 600); // 10 x 46 = 460
const CONSOLE_CALL_KITCHEN = rule("console-call-kitchen", 600); // ten phones on one built-in demo kitchen: 460
const JOIN = rule("join", 30);
const DEMO_ORDER = rule("demo-order", 12);
const DEMO_ORDER_KITCHEN = rule("demo-order-kitchen", 6);
const AGENT_WRITE = rule("agent-write", 120);
const EVENTS = rule("events", 60); // 10 x 3 = 30 (each page opens one stream)
const ASSISTANT = rule("assistant", 40); // two questions a minute each for ten visitors; every answer is a capped model call
const ASSISTANT_KITCHEN = rule("assistant-kitchen", 60);
const LIVE_LOOKUP = rule("catalog-live", 60); // a product page checks its live price once: 10 visitors x 3 products = 30
const KITCHEN_WRITE = rule("kitchen-write", 60);
const KITCHEN_WRITE_KITCHEN = rule("kitchen-write-kitchen", 120);
const OPS_ENTER = rule("ops-enter", 10);
// The planner: creating a plan is several model calls; every edit of a plan (covers, a decision, a date) is one POST
// too, about four a minute while a chef works through a plan.
const MENU_PLAN = rule("menu-plan", 40);
const MENU_PLAN_KITCHEN = rule("menu-plan-kitchen", 60);
// The voice door (src/app/_channels): starting a call mints a paid realtime session.
const VOICE_CALL = rule("voice-call", 6);
const VOICE_TOOL = rule("voice-tool", 60);

const g = globalThis as typeof globalThis & { __dockRateLimiter?: RateLimiter };
const limiter = (g.__dockRateLimiter ??= new RateLimiter());

function refuse(status: number, code: string, message: string, rule: string, headers: Record<string, string> = {}) {
  return NextResponse.json({ error: { code, rule, message } }, { status, headers: { "cache-control": "no-store", ...headers } });
}

/** The rules a request counts against: [rule, key-suffix]. Exported for the edge-cost measurement (scripts/edge-cost.ts). */
export function rulesFor(method: string, path: string): [RateRule, string?][] {
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
  if (post && /^\/ui-api\/voice\/[^/]+\/call$/.test(path)) out.push([VOICE_CALL]);
  if (post && /^\/ui-api\/voice\/[^/]+\/tool$/.test(path)) out.push([VOICE_TOOL]);
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
  // /ui-api/scan/ takes photos and PDFs (up to 10 MB), larger than this proxy buffers (next.config.ts); those
  // routes apply the same per-address limits and their own body cap (src/server/channels/scan/guard.ts).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|ui-api/scan/).*)"],
};
