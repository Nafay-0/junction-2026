import { describe, expect, it } from "vitest";
import { rulesFor } from "./proxy";
import { RateLimiter } from "./server/limits";

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

function run(visitors: number, perVisitor: [string, string, number][], address = "198.51.100.7") {
  const limiter = new RateLimiter();
  const refused = new Map<string, number>();
  const t = Date.UTC(2026, 10, 14, 12);
  for (let v = 0; v < visitors; v++) {
    for (const [method, path, n] of perVisitor) {
      for (let i = 0; i < n; i++) {
        for (const [rule, suffix] of rulesFor(method, path)) {
          if (limiter.hit(rule, suffix ?? address, t) !== null) refused.set(rule.name, (refused.get(rule.name) ?? 0) + 1);
        }
      }
    }
  }
  return refused;
}

describe("edge rate limits", () => {
  it("hold ten visitors ordering at the same minute behind one venue address on one demo kitchen", () => {
    expect([...run(10, ONE_ORDER_AND_A_MINUTE_WAITING)]).toEqual([]);
  });

  it("still stop a runaway client", () => {
    const refused = run(1, [["POST", "/ui-api/kitchens/kaari/call", 2000]]);
    expect(refused.get("console-call")).toBeGreaterThan(0);
    expect(run(1, [["POST", "/ui-api/kitchens/kaari/assistant", 100]]).get("assistant")).toBeGreaterThan(0);
  });
});
