import { describe, expect, it } from "vitest";
import { fakeValioApi } from "./fake-api";
import { ValioLiveClient } from "./live-client";
import { PartnerBusyError, PartnerGate } from "./partner-gate";

/** A clock the gate and the clients share; sleeping moves it. */
function world(cfg: Partial<ConstructorParameters<typeof PartnerGate>[0]> = {}) {
  let t = Date.parse("2026-11-14T10:00:00.000Z");
  const gate = new PartnerGate({ perSecond: 5, perMinute: 200, blockSeconds: 30, queueMs: 2000, now: () => t, sleep: async (ms) => void (t += ms), ...cfg });
  const client = (fetch: typeof globalThis.fetch) => new ValioLiveClient({ baseUrl: "https://valio.test", apiKey: "test-key", fetch, now: () => new Date(t), sleep: async (ms) => void (t += ms), gate, availabilityTtlMs: 60_000 });
  return { gate, client, at: () => t, advance: (ms: number) => (t += ms) };
}

describe("the partner gate: 429 blocks the whole process for 30 s", () => {
  it("after a 429 nothing calls the partner for 30 s, every client fails fast with the reason, and calls resume after", async () => {
    const w = world();
    let calls = 0;
    let answer429 = true;
    const api = fakeValioApi({ "1": { price: 1, amount: 5 }, "2": { price: 2, amount: 5 } });
    const fetch = (async (u: string, init?: RequestInit) => {
      calls += 1;
      return answer429 ? new Response("{}", { status: 429 }) : api.fetch(u, init);
    }) as typeof globalThis.fetch;
    const a = w.client(fetch);
    const b = w.client(fetch); // another conversation, the watch, the menu planner: the same process
    await expect(a.lookup(["1"], "2026-11-16")).rejects.toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: 30 });
    const sent = calls;
    answer429 = false;
    await expect(b.lookup(["2"], "2026-11-16")).rejects.toMatchObject({ code: "rate_limited", message: expect.stringMatching(/asked us to wait/) });
    expect(calls).toBe(sent); // nothing went out during the block
    expect(w.gate.state().blocks).toBeGreaterThan(0);
    expect(w.gate.state().blockedUntil).toEqual(expect.any(String));
    w.advance(30_001);
    const [r] = await b.lookup(["2"], "2026-11-16");
    expect(r.price?.ok).toBe(true);
    expect(w.gate.state().blockedUntil).toBeNull();
  });

  it("a longer Retry-After is honoured, and a cached answer still serves during the block", async () => {
    const w = world();
    const api = fakeValioApi({ "1": { price: 1, amount: 5 } });
    let limited = false;
    const fetch = (async (u: string, init?: RequestInit) => (limited ? new Response("{}", { status: 429, headers: { "retry-after": "90" } }) : api.fetch(u, init))) as typeof globalThis.fetch;
    const c = w.client(fetch);
    await c.lookup(["1"], "2026-11-16"); // cached now
    limited = true;
    await expect(c.lookup(["1", "9"], "2026-11-16")).rejects.toMatchObject({ retryAfterSeconds: 90 });
    const [cached] = await c.lookup(["1"], "2026-11-16");
    expect(cached.price?.ok).toBe(true);
    w.advance(60_000);
    expect(w.gate.blockedFor()).toBe(30);
  });
});

describe("the partner gate: pace", () => {
  it("lets 5 calls through in a second, queues the sixth briefly instead of dropping it", async () => {
    const w = world();
    for (let i = 0; i < 5; i++) await w.gate.acquire();
    const t0 = w.at();
    await w.gate.acquire();
    expect(w.at() - t0).toBeGreaterThan(0);
    expect(w.at() - t0).toBeLessThanOrEqual(1000);
    expect(w.gate.state()).toMatchObject({ calls: 6, queued: 1 });
  });

  it("keeps a minute's budget, and refuses as busy when the wait would be longer than the queue allows", async () => {
    const w = world({ perSecond: 1000, perMinute: 200 });
    for (let i = 0; i < 200; i++) await w.gate.acquire();
    await expect(w.gate.acquire()).rejects.toBeInstanceOf(PartnerBusyError);
    expect(w.gate.state()).toMatchObject({ refusedBusy: 1, callsLastMinute: 200 });
    w.advance(60_001);
    await w.gate.acquire();
  });

  it("several clients at once never exceed the pace together", async () => {
    const w = world({ queueMs: 60_000 });
    const api = fakeValioApi(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [String(i), { price: 1 }])));
    const clients = Array.from({ length: 6 }, () => w.client(api.fetch));
    await Promise.all(clients.map((c, i) => c.lookup([String(i)], "2026-11-16")));
    // When each call was let through (the gate's own record): never more than 5 in any second.
    const sent = (w.gate as unknown as { stamps: number[] }).stamps;
    expect(sent).toHaveLength(12);
    for (const t of sent) expect(sent.filter((x) => x > t - 1000 && x <= t).length).toBeLessThanOrEqual(5);
    expect(w.gate.state().queued).toBeGreaterThan(0);
  });

  it("reads its settings from the environment, with conservative defaults", () => {
    const g = new PartnerGate();
    expect(g.state()).toMatchObject({ perSecond: 5, perMinute: 200, blockSeconds: 30 });
  });
});
