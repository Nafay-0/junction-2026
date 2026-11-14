import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeJwt } from "jose";
import { LaunchCaps, PRESETS, outcomeOf, recordedRun, toRunMessages, mintMandate, AIVEN_BUYER } from "./launcher";

const T0 = Date.parse("2026-11-14T09:00:00Z");

describe("the Aiven agent launcher's caps", () => {
  it("lets one run start, then refuses a second while it runs", () => {
    const c = new LaunchCaps(3, 45_000, T0);
    expect(c.check(T0)).toBeNull();
    c.start("a", T0);
    expect(c.check(T0 + 1_000)).toMatchObject({ code: "running", recording: false });
    c.finish("a");
    expect(c.check(T0 + 1_000)).toMatchObject({ code: "too_soon", retryInS: 44, recording: false });
    expect(c.check(T0 + 45_000)).toBeNull();
  });

  it("plays a recording once the day's runs are used, and counts again the next UTC day", () => {
    const c = new LaunchCaps(2, 0, T0);
    c.start("a", T0);
    c.finish("a");
    c.start("b", T0 + 10);
    c.finish("b");
    expect(c.left(T0 + 20)).toBe(0);
    expect(c.check(T0 + 20)).toMatchObject({ code: "day_used", recording: true });
    const tomorrow = Date.parse("2026-11-15T00:00:01Z");
    expect(c.left(tomorrow)).toBe(2);
    expect(c.check(tomorrow)).toBeNull();
  });

  it("takes runs counted elsewhere (telemetry, another process) into account", () => {
    const c = new LaunchCaps(5, 0, T0);
    c.atLeast(5, T0);
    expect(c.left(T0)).toBe(0);
    expect(c.check(T0)).toMatchObject({ code: "day_used" });
  });

  it("stops for the day when Aiven's free tier refuses a run", () => {
    const c = new LaunchCaps(10, 0, T0);
    c.aivenRefused(T0);
    expect(c.left(T0)).toBe(0);
    expect(c.check(T0)).toMatchObject({ code: "aiven_limit", recording: true });
    expect(c.check(Date.parse("2026-11-15T08:00:00Z"))).toBeNull();
  });

  it("with no runs allowed at all, only recordings play", () => {
    expect(new LaunchCaps(0, 0, T0).check(T0)).toMatchObject({ code: "day_used", recording: true });
  });
});

describe("the launcher's mandate", () => {
  it("is minted for the Aiven buyer, short-lived, within the demo org's per-order limit", async () => {
    const now = new Date(T0);
    const jws = await mintMandate(now);
    const m = (decodeJwt(jws) as { mandate: { agentId: string; validUntil: string; perOrderLimitCents: number; issuer: { orgId: string } } }).mandate;
    expect(m.agentId).toBe(AIVEN_BUYER.agentId);
    expect(m.issuer.orgId).toBe("org_laakso_catering");
    expect(Date.parse(m.validUntil) - T0).toBe(AIVEN_BUYER.mandateMinutes * 60_000);
    expect(m.perOrderLimitCents).toBe(100_000);
  });
});

describe("reading a run", () => {
  afterEach(() => vi.restoreAllMocks());

  it("finds the request, the order and how it ended in Dock's tool answers, and redacts tokens", () => {
    const msgs = toRunMessages([
      { role: "user", message_type: "user_message", content: "I need milk" },
      { role: "tool", message_type: "tool_call_message", tool_call: { name: "dock-aiven_place_order", arguments: { quoteToken: "eyJhbGciOiJFZDI1NTE5In0.eyJxIjoxfQ.c2lnbmF0dXJlc2ln" } } },
      { role: "tool", message_type: "tool_return_message", name: "dock-aiven_place_order", tool_return: '{"ok":true,"order":{"orderId":"ord_abc123","requestId":"req_def456","status":"pending_approval"}}' },
    ]);
    expect(msgs[1].text).not.toContain("eyJhbGci");
    expect(outcomeOf(msgs)).toEqual({ requestId: "req_def456", orderId: "ord_abc123", outcome: "pending_approval" });
    const refused = toRunMessages([{ role: "tool", message_type: "tool_return_message", name: "dock-aiven_place_order", tool_return: '{"ok":false,"error":{"code":"order_mismatch","rule":"order_matches_quote"}}' }]);
    expect(outcomeOf(refused).outcome).toBe("refused: order_matches_quote");
  });

  it("labels a recording as one and says why it plays", () => {
    const r = recordedRun("valio", "Today's 12 runs are used.");
    expect(r.recorded).toBe(true);
    expect(r.recordedAt).toBeTruthy();
    expect(r.error).toMatch(/Today's 12 runs are used\. Playing a recording of a real run instead/);
    expect(r.messages.length).toBeGreaterThan(3);
    expect(JSON.stringify(r)).not.toMatch(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./);
  });

  it("has three presets: Valio's example, inside the mandate, and one the gate refuses", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["valio", "within", "refused"]);
    expect(PRESETS[0].message).toMatch(/1,000 litres of lactose-free milk by Monday/);
  });
});
