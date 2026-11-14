import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SIGN_IN_FAILURES_PER_ACCOUNT, SIGN_IN_FAILURES_PER_ADDRESS, SIGN_UPS_PER_ADDRESS } from "./server/accounts/service";
import { EDGE_RULES, rulesFor } from "./proxy";
import { RateLimiter, limitVar } from "./server/limits";

/**
 * The edge limits against the measured cost of one ordinary order through the kitchen store (scripts/edge-cost.ts on
 * a production build): ten visitors behind one venue address, all on the same demo kitchen, in the same minute.
 */
const ONE_ORDER_AND_A_MINUTE_WAITING: [string, string, number][] = [
  ["POST", "/ui-api/kitchens/kaari/call", 46],
  ["GET", "/ui-api/kitchens/kaari/portal", 6],
  ["GET", "/api/v1/events", 3],
  ["GET", "/k/kaari/catalogue", 3],
  ["GET", "/k/kaari/catalogue/463171", 6],
  ["GET", "/ui-api/voice/kaari/call", 2],
  ["GET", "/k", 2],
  ["GET", "/k/kaari/basket", 2],
  ["GET", "/k/kaari/order", 2],
  ["GET", "/k/kaari/orders", 2],
  ["GET", "/k/kaari/agent", 2],
  ["GET", "/k/kaari", 1],
  ["GET", "/ui-api/kitchens/kaari/cutoffs", 1],
  ["GET", "/ui-api/kitchens/kaari/catalog/categories", 1],
  ["GET", "/ui-api/kitchens/kaari/catalog", 1],
  ["GET", "/ui-api/kitchens/kaari/catalog/product/463171", 1],
  ["POST", "/ui-api/kitchens/kaari/catalog/live", 1],
  ["GET", "/ui-api/kitchens/kaari/approval/apr_x", 1],
];

/**
 * The sign-off path a visitor takes in the first minutes after "scan this" (e2e/room/crowd.spec.ts records it by
 * rule): /join, the passkey prompt and the passkey back, /approver waiting (it asks every 5 s), "ask my agent",
 * the sign-off screen, a passkey sign-off. `{v}` is the visitor's own kitchen, approval and session. Rounded up.
 */
const SIGN_OFF_PATH: [string, string, number][] = [
  ["GET", "/join", 2],
  ["POST", "/api/v1/join", 3],
  ["POST", "/api/v1/join/verify", 2],
  ["GET", "/approver", 3],
  ["GET", "/api/v1/approver", 24],
  ["GET", "/api/v1/events", 5],
  ["POST", "/api/v1/approver/demo-order", 2],
  ["GET", "/approve/apr_{v}", 2],
  ["GET", "/api/v1/approvals/apr_{v}", 4],
  ["POST", "/api/v1/approvals/apr_{v}/challenge", 2],
  ["POST", "/api/v1/approvals/apr_{v}", 1],
  ["GET", "/k/sbx_{v}", 2],
  ["POST", "/ui-api/kitchens/sbx_{v}/call", 10],
  ["GET", "/ui-api/kitchens/sbx_{v}/thread/stream", 2],
  ["POST", "/ui-api/kitchens/sbx_{v}/thread/turns", 3],
  ["POST", "/ui-api/account/signin", 2],
];

function run(visitors: number, perVisitor: [string, string, number][], address: string | ((v: number) => string) = "198.51.100.7") {
  const limiter = new RateLimiter();
  const refused = new Map<string, number>();
  const t = Date.UTC(2026, 10, 14, 12);
  for (let v = 0; v < visitors; v++) {
    const who = typeof address === "function" ? address(v) : address;
    for (const [method, pathTemplate, n] of perVisitor) {
      const path = pathTemplate.replaceAll("{v}", `v${v}`);
      for (let i = 0; i < n; i++) {
        for (const [rule, suffix] of rulesFor(method, path, `dock_approver=session-of-visitor-${v}`)) {
          if (limiter.hit(rule, suffix ?? who, t) !== null) refused.set(rule.name, (refused.get(rule.name) ?? 0) + 1);
        }
      }
    }
  }
  return refused;
}

const saved = { ...process.env };
afterEach(() => {
  for (const r of EDGE_RULES) {
    const k = limitVar(r.name);
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("edge rate limits", () => {
  it("hold ten visitors ordering at the same minute behind one venue address on one demo kitchen", () => {
    expect([...run(10, ONE_ORDER_AND_A_MINUTE_WAITING)]).toEqual([]);
  });

  it("hold a room: sixty visitors on the sign-off path in one minute behind one venue address, and behind two", () => {
    expect([...run(60, SIGN_OFF_PATH)]).toEqual([]);
    expect([...run(60, SIGN_OFF_PATH, (v) => `198.51.100.${(v % 2) + 1}`)]).toEqual([]);
  });

  it("hold sixty visitors each placing an order in the store, each on their own kitchen, behind one address", () => {
    const own = ONE_ORDER_AND_A_MINUTE_WAITING.map(([m, p, n]) => [m, p.replace("kaari", "sbx_{v}"), n] as [string, string, number]);
    expect([...run(60, own)]).toEqual([]);
  });

  it("keep one phone, one kitchen and one address bounded", () => {
    // one approver phone asking its agent again and again
    expect(run(1, [["POST", "/api/v1/approver/demo-order", 20]]).get("demo-order-session")).toBe(14);
    // one visitor kitchen's demo orders, from many addresses
    expect(run(20, [["POST", "/api/v1/sandboxes/sbx_one/demo-order", 1]], (v) => `203.0.113.${v}`).get("demo-order-kitchen")).toBe(14);
    // one kitchen's thread, typed into from many phones
    expect(run(40, [["POST", "/ui-api/kitchens/kaari/thread/turns", 1]], (v) => `203.0.113.${v}`).get("thread-kitchen")).toBe(10);
    // kitchens created from one address: the join-verify limit, then DOCK_SANDBOX_MAX in total
    expect(run(1, [["POST", "/api/v1/join/verify", 200]]).get("join-verify")).toBe(50);
  });

  it("take every limit from its environment variable", () => {
    const example = readFileSync(path.join(__dirname, "../.env.example"), "utf8");
    for (const r of [...EDGE_RULES, SIGN_IN_FAILURES_PER_ACCOUNT, SIGN_IN_FAILURES_PER_ADDRESS, SIGN_UPS_PER_ADDRESS]) expect(example).toContain(`\n${limitVar(r.name)}=\n`);
    process.env.DOCK_LIMIT_JOIN = "30";
    expect(run(20, [["POST", "/api/v1/join", 2]]).get("join")).toBe(10);
    process.env.DOCK_LIMIT_JOIN = "not a number";
    expect(run(20, [["POST", "/api/v1/join", 2]]).get("join")).toBeUndefined();
  });

  it("still stop a runaway client", () => {
    expect(run(1, [["POST", "/ui-api/kitchens/kaari/call", 2000]]).get("console-call-kitchen")).toBe(1400);
    // the same client spread over many kitchens: the per-address limit
    const manyKitchens = Array.from({ length: 4000 }, (_, i) => ["POST", `/ui-api/kitchens/sbx_${i}/call`, 1] as [string, string, number]);
    expect(run(1, manyKitchens).get("console-call")).toBe(1000);
    expect(run(1, [["POST", "/ui-api/kitchens/kaari/assistant", 100]]).get("assistant-kitchen")).toBe(40);
  });
});
