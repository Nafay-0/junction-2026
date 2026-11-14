import { describe, expect, it } from "vitest";
import { fakeValioApi } from "./fake-api";
import { ValioApiError, ValioLiveClient, helsinkiDate, validFromMs, validUntilMs } from "./live-client";

const NOW = new Date("2026-11-13T10:00:00.000Z");

function client(api: ReturnType<typeof fakeValioApi>, over: Partial<ConstructorParameters<typeof ValioLiveClient>[0]> = {}) {
  let t = NOW.getTime();
  const sleeps: number[] = [];
  const c = new ValioLiveClient({
    baseUrl: "https://valio.test/",
    apiKey: "test-key",
    fetch: api.fetch,
    now: () => new Date(t),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...over,
  });
  return { c, sleeps, advance: (ms: number) => (t += ms) };
}

describe("ValioLiveClient", () => {
  it("sends the key, the customer and the requested date, and maps the documented fields", async () => {
    const api = fakeValioApi({ "1": { price: 12.9, amount: 40, date: "2026-11-16", unit: "KI" } });
    const { c } = client(api);
    const [r] = await c.lookup(["1"], "2026-11-16");
    expect(api.calls.map((x) => x.path).sort()).toEqual(["/api/availability", "/api/price"]);
    expect(api.calls[0].headers["x-api-key"]).toBe("test-key");
    expect(api.calls[0].body).toEqual({ customer: "dock", requestedDate: "2026-11-16", products: ["1"] });
    expect(r.price).toEqual({
      ok: true,
      valueCents: 1290,
      valueWithTaxCents: 1464,
      currency: "EUR",
      validFrom: "2026-11-01",
      validTo: "2026-11-30",
      comparisonPriceCents: 129,
      comparisonUnit: "L",
      taxRatePct: 13.5,
      listPriceCents: 1290,
      netPriceFound: false,
    });
    expect(r.availability).toMatchObject({ salesBlock: false, logisticModel: "Stock", closingTime: "2026-11-13T14:00:00", line: { availableAmount: 40, availableDate: "2026-11-16", salesUnit: "KI" } });
  });

  it("maps error: true to no price, and empty schedule lines to no line", async () => {
    const { c } = client(fakeValioApi({ "1": { price: "error" }, "2": { price: 3, noLines: true } }));
    const [a, b] = await c.lookup(["1", "2"], "2026-11-16");
    expect(a.price).toEqual({ ok: false, reason: "no_price" });
    expect(b.availability?.line).toBeUndefined();
  });

  it("splits long lists into batches", async () => {
    const api = fakeValioApi(Object.fromEntries(Array.from({ length: 25 }, (_, i) => [String(i), { price: 1 }])));
    const { c } = client(api, { batchSize: 10 });
    await c.lookup(Array.from({ length: 25 }, (_, i) => String(i)), "2026-11-16");
    const sizes = api.calls.filter((x) => x.path === "/api/price").map((x) => x.body!.products.length);
    expect(sizes).toEqual([10, 10, 5]);
    expect(c.upstreamStats().httpRequests).toBe(6);
  });

  it("caches: availability for a minute, prices until their validity ends", async () => {
    const api = fakeValioApi({ "1": { price: 2, validTo: "2026-11-13" } });
    const { c, advance } = client(api);
    await c.lookup(["1"], "2026-11-16");
    await c.lookup(["1"], "2026-11-16");
    expect(api.calls).toHaveLength(2);
    expect(c.upstreamStats().cacheHits).toBe(2);
    advance(61_000); // availability expired, price still valid
    await c.lookup(["1"], "2026-11-16");
    expect(api.calls.map((x) => x.path).slice(2)).toEqual(["/api/availability"]);
    advance(10 * 60_000); // price cache is capped at ten minutes
    await c.lookup(["1"], "2026-11-16");
    expect(api.calls.filter((x) => x.path === "/api/price")).toHaveLength(2);
    await c.lookup(["1"], "2026-11-17"); // another date is another question
    expect(api.calls.filter((x) => x.path === "/api/price")).toHaveLength(3);
  });

  it("caps the cache even when a price is valid until 9999-12-31", async () => {
    const api = fakeValioApi({ "1": { price: 2, validTo: "9999-12-31" } });
    const { c, advance } = client(api);
    const [r] = await c.lookup(["1"], "2026-11-16");
    expect(r.price).toMatchObject({ ok: true, validTo: "9999-12-31" });
    advance(10 * 60_000 + 1);
    await c.lookup(["1"], "2026-11-16");
    expect(api.calls.filter((x) => x.path === "/api/price")).toHaveLength(2);
  });

  it("does not cache a price past its validity window", async () => {
    // valid to 13 Nov (ends 20:59 UTC); asking at 20:55 UTC caches for 4 minutes at most
    const api = fakeValioApi({ "1": { price: 2, validTo: "2026-11-13" } });
    let at = Date.parse("2026-11-13T20:55:00Z");
    const { c } = client(api, { now: () => new Date(at) });
    await c.lookup(["1"], "2026-11-16");
    at += 5 * 60_000;
    await c.lookup(["1"], "2026-11-16");
    expect(api.calls.filter((x) => x.path === "/api/price")).toHaveLength(2);
  });

  it("retries 429 and 5xx with backoff, honouring Retry-After", async () => {
    const api = fakeValioApi({ "1": { price: 1 } }, { failFirst: [429, 503] });
    const { c, sleeps } = client(api);
    const [r] = await c.lookup(["1"], "2026-11-16");
    expect(r.price?.ok).toBe(true);
    expect(sleeps[0]).toBe(1000); // Retry-After: 1
    expect(sleeps).toHaveLength(2);
    expect(c.upstreamStats()).toMatchObject({ retries: 2, failures: 0 });
  });

  it("gives up after the retries and says why", async () => {
    const api = fakeValioApi({}, { status: 503 });
    const { c } = client(api, { maxRetries: 2 });
    await expect(c.lookup(["1"], "2026-11-16")).rejects.toMatchObject({ code: "server_error", status: 503 });
  });

  it("does not retry a refused key", async () => {
    const api = fakeValioApi({ "1": { price: 1 } });
    const { c, sleeps } = client(api, { apiKey: "wrong" });
    await expect(c.lookup(["1"], "2026-11-16")).rejects.toMatchObject({ code: "unauthorized" });
    expect(sleeps).toHaveLength(0);
  });

  it("times out a hanging request and retries it", async () => {
    let n = 0;
    const hanging = (async (_u: unknown, init?: RequestInit) => {
      n += 1;
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" }))));
    }) as typeof fetch;
    const c = new ValioLiveClient({ baseUrl: "https://valio.test", apiKey: "k", fetch: hanging, timeoutMs: 20, maxRetries: 1, sleep: async () => {} });
    await expect(c.ping()).rejects.toMatchObject({ code: "timeout" });
    expect(n).toBe(2);
  });

  // QA F-SLOW-PARTNER-WAIT: a partner answering 429 with Retry-After: 30, or hanging, kept the buyer 30 to 36 s.
  it("does not sleep on a Retry-After longer than the lookup's deadline: it fails at once, saying when to retry", async () => {
    const limited = (async () => new Response("{}", { status: 429, headers: { "retry-after": "30" } })) as unknown as typeof fetch;
    const { c, sleeps } = client(fakeValioApi({}), { fetch: limited });
    await expect(c.lookup(["1"], "2026-11-16")).rejects.toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: 30 });
    expect(sleeps).toHaveLength(0);
  });

  it("gives a hanging partner the deadline in all, not a timeout per retry", async () => {
    let n = 0;
    const hanging = (async (_u: unknown, init?: RequestInit) => {
      n += 1;
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" }))));
    }) as typeof fetch;
    const c = new ValioLiveClient({ baseUrl: "https://valio.test", apiKey: "k", fetch: hanging, timeoutMs: 5000, deadlineMs: 300, maxRetries: 3 });
    const t0 = Date.now();
    await expect(c.lookup(["1"], "2026-11-16")).rejects.toMatchObject({ code: "timeout", retryAfterSeconds: 30 });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(n).toBe(2); // one call each for price and availability, cut at the deadline; no retry past it
  });

  it("still retries short waits within the deadline", async () => {
    const api = fakeValioApi({ "1": { price: 1 } }, { failFirst: [429] });
    const { c, sleeps } = client(api, { deadlineMs: 8000 });
    const [r] = await c.lookup(["1"], "2026-11-16");
    expect(r.price?.ok).toBe(true);
    expect(sleeps).toEqual([1000]);
  });

  it("checks inputs and needs a key", () => {
    expect(() => new ValioLiveClient({ baseUrl: "x", apiKey: "" })).toThrow(ValioApiError);
    const { c } = client(fakeValioApi({}));
    return expect(c.lookup(["1"], "16.11.2026")).rejects.toMatchObject({ code: "bad_request" });
  });

  it("pings", async () => {
    const { c } = client(fakeValioApi({}));
    expect(await c.ping()).toMatchObject({ ok: true, status: 200 });
  });

  it("reads dates in Helsinki time, conservatively at the edges", () => {
    expect(helsinkiDate(new Date("2026-11-13T22:30:00Z"))).toBe("2026-11-14");
    expect(validUntilMs("2026-11-13")).toBe(Date.parse("2026-11-13T20:59:59Z"));
    expect(validFromMs("2026-11-13")).toBe(Date.parse("2026-11-12T22:00:00Z"));
    expect(validUntilMs("2026-11-13T12:00:00Z")).toBe(Date.parse("2026-11-13T12:00:00Z"));
    expect(validUntilMs("garbage")).toBeUndefined();
  });
});
