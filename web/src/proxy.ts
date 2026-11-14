import { NextResponse, type NextRequest } from "next/server";
import { RateLimiter, clientAddress, envRule, rateLimitsEnabled, type RateRule } from "@/server/limits";

/**
 * The public server's front door: per-address (and per-kitchen) rate limits, a body-size cap, and dev-only
 * routes closed in production. Money and partner quota are capped again where they are spent (limits.ts),
 * because the buyer console forwards its calls in-process and never passes through here a second time.
 */

const MAX_BODY_BYTES = 64 * 1024;
// Every limit below is per minute and settable: DOCK_LIMIT_<NAME> (limits.ts limitVar; all names in web/.env.example).
const rule = (name: string, limit: number): RateRule => envRule(name, limit);

// Sized for a room, not a table: a presenter says "scan this" and sixty phones behind one or two venue addresses
// arrive within the same minute. Measured per visitor (e2e/room/crowd.spec.ts records every request by rule):
//   the sign-off path (/join, a passkey, /approver waiting, "ask my agent", /approve, sign), at most per visitor on
//   14 Nov: join 1 and join-verify 1 (a failed passkey or a page left open 4 min prepares another prompt), demo-order 1,
//   events 2 (a stream per screen; reconnects and the kitchen's thread add more), page 7, any 32 in two minutes
//   (the approver screen asks every 5 s);
//   one ordinary order through the kitchen store (scripts/edge-cost.ts, 14 Nov 2026): any 83, page 20,
//   console-call 46, catalog-live 1, events 3.
// The per-address limits below hold 60 visitors doing either in one minute behind one address, with headroom.
// Abuse stays bounded by what does not depend on the address: the per-kitchen and per-session rules, the visitor
// kitchens open at once (DOCK_SANDBOX_MAX, 200), and the daily caps on money and partner quota (limits.ts: model
// spend and calls, live lookups; voice calls per hour and day in channels/voice/calls.ts), which stay as they were.
const ANY = rule("any", 6000); // 60 x 83 = 4980
const PAGE = rule("page", 1500); // 60 x 20 = 1200
const INTERPRET = rule("interpret", 20); // outside agents calling the reader directly; the store's reader goes through console-call
const CONSOLE_CALL = rule("console-call", 3000); // 60 x 46 = 2760
const CONSOLE_CALL_KITCHEN = rule("console-call-kitchen", 600); // ten phones on one kitchen: 460
const JOIN = rule("join", 240); // POST /api/v1/join, the passkey prompt: 60 x 3 = 180; nothing is created
const JOIN_VERIFY = rule("join-verify", 150); // POST /api/v1/join/verify creates a kitchen: 60 x 2 tries; DOCK_SANDBOX_MAX caps the total
const DEMO_ORDER = rule("demo-order", 150); // "ask my agent": 60 x 2
const DEMO_ORDER_KITCHEN = rule("demo-order-kitchen", 6); // per visitor kitchen
const DEMO_ORDER_SESSION = rule("demo-order-session", 6); // per approver phone (its session cookie)
const AGENT_WRITE = rule("agent-write", 600); // outside agents and MCP connectors from the room: 60 x 10
const EVENTS = rule("events", 480); // 60 x 8 (each screen opens one stream, the kitchen thread its own, plus reconnects)
const ASSISTANT = rule("assistant", 150); // two questions a minute each for 60 visitors; every answer is a capped model call
const ASSISTANT_KITCHEN = rule("assistant-kitchen", 60);
const LIVE_LOOKUP = rule("catalog-live", 240); // a product page checks its live price once: 60 visitors x 3 products = 180
const KITCHEN_WRITE = rule("kitchen-write", 360); // basket and memory taps: 60 x 5
const KITCHEN_WRITE_KITCHEN = rule("kitchen-write-kitchen", 120);
// The kitchen's thread (the composer: words, a card tapped, a reset): every turn may be a capped model call.
const THREAD = rule("thread", 300); // 60 x 5
const THREAD_KITCHEN = rule("thread-kitchen", 30); // one kitchen: a turn every 2 s, sustained
const OPS_ENTER = rule("ops-enter", 10);
// Accounts: sign-in, sign-up, sign-out, the mandate, signing devices. Failed sign-ins are limited again per account
// and per address in server/accounts/service.ts, which holds even with DOCK_RATE_LIMITS=off.
const ACCOUNT = rule("account", 300); // 60 x 5
// The planner: creating a plan is several model calls; every edit of a plan (covers, a decision, a date) is one POST
// too, about four a minute while a chef works through a plan.
const MENU_PLAN = rule("menu-plan", 40);
const MENU_PLAN_KITCHEN = rule("menu-plan-kitchen", 60);
// The voice door (src/app/_channels): starting a call mints a paid realtime session. The real bound is the voice
// line's own caps per kitchen and in total, per hour and per day (DOCK_VOICE_CALLS_PER_*), which say so in words.
const VOICE_CALL = rule("voice-call", 30);
const VOICE_TOOL = rule("voice-tool", 300);

/** Every edge rule, for the documentation and the tests. */
export const EDGE_RULES = [
  ANY, PAGE, INTERPRET, CONSOLE_CALL, CONSOLE_CALL_KITCHEN, JOIN, JOIN_VERIFY, DEMO_ORDER, DEMO_ORDER_KITCHEN, DEMO_ORDER_SESSION,
  AGENT_WRITE, EVENTS, ASSISTANT, ASSISTANT_KITCHEN, LIVE_LOOKUP, KITCHEN_WRITE, KITCHEN_WRITE_KITCHEN, THREAD, THREAD_KITCHEN,
  OPS_ENTER, ACCOUNT, MENU_PLAN, MENU_PLAN_KITCHEN, VOICE_CALL, VOICE_TOOL,
];

/** The approver phone's session cookie (server/approver-session.ts SESSION_COOKIE), as a short key. */
function approverSession(cookie: string | null | undefined): string | undefined {
  const m = /(?:^|;\s*)dock_approver=([^;]+)/.exec(cookie ?? "");
  return m ? `s:${m[1].slice(0, 24)}` : undefined;
}

const g = globalThis as typeof globalThis & { __dockRateLimiter?: RateLimiter };
const limiter = (g.__dockRateLimiter ??= new RateLimiter());

function refuse(status: number, code: string, message: string, rule: string, headers: Record<string, string> = {}) {
  return NextResponse.json({ error: { code, rule, message } }, { status, headers: { "cache-control": "no-store", ...headers } });
}

/** The rules a request counts against: [rule, key-suffix]. Exported for the edge-cost measurement (scripts/edge-cost.ts). */
export function rulesFor(method: string, path: string, cookie?: string | null): [RateRule, string?][] {
  const api = path.startsWith("/api/") || path.startsWith("/ui-api/");
  const out: [RateRule, string?][] = [[ANY]];
  if (!api) out.push([PAGE]);
  const post = method === "POST";
  let m: RegExpExecArray | null;
  if (post && path === "/api/v1/agent/interpret") out.push([INTERPRET]);
  if (post && (m = /^\/ui-api\/kitchens\/([^/]+)\/call$/.exec(path))) out.push([CONSOLE_CALL], [CONSOLE_CALL_KITCHEN, `k:${m[1]}`]);
  if (post && path === "/api/v1/join") out.push([JOIN]);
  if (post && path === "/api/v1/join/verify") out.push([JOIN_VERIFY]);
  if (post && (m = /^\/api\/v1\/sandboxes\/([^/]+)\/demo-order$/.exec(path))) out.push([DEMO_ORDER], [DEMO_ORDER_KITCHEN, `k:${m[1]}`]);
  if (post && path === "/api/v1/approver/demo-order") {
    out.push([DEMO_ORDER]);
    const s = approverSession(cookie);
    if (s) out.push([DEMO_ORDER_SESSION, s]);
  }
  if (post && (path === "/api/mcp" || path.startsWith("/api/mcp/c/") || /^\/api\/v1\/(availability|quotes|orders|requests|intake)/.test(path))) out.push([AGENT_WRITE]);
  if (path === "/api/v1/events") out.push([EVENTS]);
  // The kitchen's thread: its event stream counts as a stream; a turn or a reset per address and per kitchen.
  if (!post && /^\/ui-api\/kitchens\/[^/]+\/thread\/stream$/.test(path)) out.push([EVENTS]);
  if (post && (m = /^\/ui-api\/kitchens\/([^/]+)\/thread\/(?:turns|reset)$/.exec(path))) out.push([THREAD], [THREAD_KITCHEN, `k:${m[1]}`]);
  // The kitchen store (/k): the assistant calls the model, catalog/live the partner's live API, basket the gate.
  if (post && (m = /^\/ui-api\/kitchens\/([^/]+)\/assistant$/.exec(path))) out.push([ASSISTANT], [ASSISTANT_KITCHEN, `k:${m[1]}`]);
  if (post && /^\/ui-api\/kitchens\/[^/]+\/catalog\/live$/.test(path)) out.push([LIVE_LOOKUP]);
  if (post && (m = /^\/ui-api\/kitchens\/([^/]+)\/(basket|memory)$/.exec(path))) out.push([KITCHEN_WRITE], [KITCHEN_WRITE_KITCHEN, `k:${m[1]}`]);
  // The menu planner: one plan is several model calls (outline, each dish, picks, fixes) and live lookups.
  if (post && (m = /^\/ui-api\/plan\/([^/]+)(\/[^/]+)?$/.exec(path))) out.push([MENU_PLAN], [MENU_PLAN_KITCHEN, `k:${m[1]}`]);
  if (post && (m = /^\/ui-api\/plan\/([^/]+)\/[^/]+\/(quote|order)$/.exec(path))) out.push([KITCHEN_WRITE], [KITCHEN_WRITE_KITCHEN, `k:${m[1]}`]);
  // The operations desk: entering takes the passcode, so guessing is slowed down.
  if (post && path === "/ops-api/session") out.push([OPS_ENTER]);
  if (post && path.startsWith("/ui-api/account/")) out.push([ACCOUNT]);
  // Reissuing or revoking a connector takes the operator secret (or the visitor's own session).
  if ((post || method === "DELETE") && path.startsWith("/ui-api/connect/")) out.push([OPS_ENTER]);
  // The buyer's one-time answer page (server/answer-links.ts).
  if (post && path.startsWith("/ui-api/answer/")) out.push([KITCHEN_WRITE]);
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
    for (const [r, suffix] of rulesFor(req.method, path, req.headers.get("cookie"))) {
      // Per-kitchen rules are shared by every caller; per-address rules are keyed by the caller.
      const retryAfter = limiter.hit(r, suffix ?? who);
      if (retryAfter !== null) {
        const what = !suffix ? "your address" : suffix.startsWith("s:") ? "this phone" : "this kitchen";
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
