import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRuntime } from "../runtime";
import { OPS_COOKIE, enterOps } from "./access";
import { TryCaps, inWords, scrubMail, tryCaps } from "./try-caps";

/**
 * The third door (opsTry): what a visitor may try without the passcode, and the caps on it. Pure counters first, then
 * the real routes with a viewer: answered, counted per address, refused with a sentence that says when it frees up,
 * a recording or a failure given back, and every other action still 403 staff_only.
 */
const BASE = "http://dock.test";
const T0 = Date.parse("2026-11-14T12:00:00Z");

beforeEach(() => {
  resetRuntime();
  tryCaps().reset();
});
afterEach(() => {
  delete process.env.DOCK_TRY;
  delete process.env.DOCK_TRY_COPILOT_DAILY;
  delete process.env.DOCK_TRY_COPILOT_PER_ADDRESS;
});

describe("TryCaps", () => {
  it("allows 3 Aiven agent runs an hour per address, then says when the next frees up", () => {
    const c = new TryCaps();
    for (let i = 0; i < 3; i++) c.take("aiven-agent", "a", T0 + i * 1000);
    expect(c.room("aiven-agent", "a", T0 + 3000).left).toBe(0);
    expect(() => c.take("aiven-agent", "a", T0 + 4000)).toThrow(/used your 3 Aiven agent runs an hour from this address\. The next one frees up in 60 minutes/);
    // Another address is not affected; the first frees up after the hour.
    expect(c.room("aiven-agent", "b", T0 + 4000).left).toBe(3);
    expect(c.room("aiven-agent", "a", T0 + 3_600_001).left).toBe(3);
  });

  it("allows one search timing per 10 minutes per address", () => {
    const c = new TryCaps();
    c.take("search-timing", "a", T0);
    const r = c.room("search-timing", "a", T0 + 4 * 60_000);
    expect(r.blocked).toBe("You have used your timing run per 10 minutes from this address. The next one frees up in 6 minutes.");
    expect(c.room("search-timing", "a", T0 + 10 * 60_000).blocked).toBeUndefined();
  });

  it("stops every visitor when the day's shared count is used, until midnight UTC", () => {
    process.env.DOCK_TRY_COPILOT_DAILY = "2";
    const c = new TryCaps();
    c.take("copilot", "a", T0);
    c.take("copilot", "b", T0);
    const r = c.room("copilot", "c", T0);
    expect(r.dayLeft).toBe(0);
    expect(r.blocked).toBe("Today's 2 questions for visitors on this server are used. They start again at midnight UTC, in 12 h 0 min.");
    expect(c.room("copilot", "c", Date.parse("2026-11-15T00:00:01Z")).blocked).toBeUndefined();
  });

  it("gives a try back once, however often asked", () => {
    process.env.DOCK_TRY_COPILOT_PER_ADDRESS = "1";
    const c = new TryCaps();
    const t = c.take("copilot", "a", T0);
    t.giveBack();
    t.giveBack();
    expect(c.room("copilot", "a", T0).left).toBe(1);
    expect(c.room("copilot", "a", T0).dayLeft).toBe(400);
  });

  it("a try taken yesterday, given back today, does not lower today's count", () => {
    const c = new TryCaps();
    const yesterday = c.take("copilot", "a", T0);
    const nextDay = T0 + 24 * 3600_000;
    c.take("copilot", "b", nextDay);
    yesterday.giveBack();
    expect(c.room("copilot", "b", nextDay).dayLeft).toBe(399);
  });

  it("closes every door with DOCK_TRY=off", () => {
    process.env.DOCK_TRY = "off";
    expect(() => new TryCaps().take("copilot", "a", T0)).toThrow(/staff with the passcode can/);
  });

  it("says durations in words and withholds mail addresses", () => {
    expect(inWords(1)).toBe("1 second");
    expect(inWords(59)).toBe("59 seconds");
    expect(inWords(61)).toBe("2 minutes");
    expect(inWords(3 * 3600 + 300)).toBe("3 h 5 min");
    expect(scrubMail({ a: ["write to aino.virtanen@example.fi now"] })).toEqual({ a: ["write to [mail address withheld] now"] });
  });
});

describe("the try door on the real routes", () => {
  const post = async (file: "agent" | "copilot" | "recall-probe", body: unknown, headers: Record<string, string> = {}) => {
    const mod = (await import(`@/app/ops-api/platform/${file}/route`)) as { POST: (r: Request) => Promise<Response> };
    const res = await mod.POST(new Request(`${BASE}/ops-api/platform/${file}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", ...headers }, body: JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> & { error?: { code: string; message: string; details?: { retryInS?: number } }; visitor?: { left: number } } };
  };

  it("answers a visitor's copilot question with a card and the room left, then refuses past the limit with when", async () => {
    process.env.DOCK_TRY_COPILOT_PER_ADDRESS = "2";
    const a = await post("copilot", { question: "How many orders were committed today?" });
    expect(a.status).toBe(200);
    expect(typeof a.body.answer).toBe("string");
    expect(a.body.visitor?.left).toBe(1);
    await post("copilot", { question: "Is anything unhealthy?" });
    const c = await post("copilot", { question: "Is anything unhealthy?" });
    expect(c.status).toBe(429);
    expect(c.body.error?.code).toBe("try_limit");
    expect(c.body.error?.message).toMatch(/frees up in \d+ minutes/);
    expect(c.body.error?.details?.retryInS).toBeGreaterThan(0);
    // Another address still may.
    expect((await post("copilot", { question: "Is anything unhealthy?" }, { "x-forwarded-for": "203.0.113.10" })).status).toBe(200);
  });

  it("plays a recording for a visitor where the launcher is not configured, and does not count it", async () => {
    const r = await post("agent", { preset: "refused" });
    expect(r.status).toBe(200);
    expect((r.body.run as { recorded: boolean }).recorded).toBe(true);
    expect(r.body.visitor?.left).toBe(3);
  });

  it("gives back a search timing that could not run here", async () => {
    const r = await post("recall-probe", {});
    if (r.status !== 200) {
      expect(r.body.error?.code).not.toBe("staff_only");
      const { GET } = await import("@/app/ops-api/platform/try/route");
      const t = (await (await GET(new Request(`${BASE}/ops-api/platform/try`, { headers: { "x-forwarded-for": "203.0.113.9" } }))).json()) as { staff: boolean; doors: Record<string, { left: number }> };
      expect(t.staff).toBe(false);
      expect(t.doors["search-timing"].left).toBe(1);
    }
  });

  it("still refuses every other action to a visitor: suspending an agent is 403 staff_only", async () => {
    const { POST } = await import("@/app/ops-api/control/route");
    const res = await POST(new Request(`${BASE}/ops-api/control`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" }, body: JSON.stringify({ action: "suspend", scope: "agent", target: "agent_demo", reason: "test" }) }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("staff_only");
  });

  it("does not count staff", async () => {
    const s = enterOps({ name: "Staff" });
    process.env.DOCK_TRY_COPILOT_PER_ADDRESS = "0";
    const r = await post("copilot", { question: "Is anything unhealthy?" }, { cookie: `${OPS_COOKIE}=${s.token}` });
    expect(r.status).toBe(200);
    expect(r.body.visitor).toBeUndefined();
  });
});
