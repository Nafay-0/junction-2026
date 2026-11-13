// A stand-in for the partner's price and availability API, returning the documented response shapes.
// For tests only. Each product id maps to a scenario; unknown ids are answered as "no price, not deliverable".

export type FakeScenario = {
  price?: number | "error"; // EUR before tax per sales unit
  validFrom?: string;
  validTo?: string;
  amount?: number;
  date?: string; // availableDate
  unit?: string;
  logisticModel?: "Stock" | "Terminal";
  salesBlock?: boolean;
  lineBlock?: boolean;
  noLines?: boolean;
  closingTime?: string;
  omit?: "price" | "availability"; // leave the product out of that response
};

export type FakeCall = { path: string; body: { customer: string; requestedDate: string; products: string[] } | null; headers: Record<string, string> };

export function fakeValioApi(scenarios: Record<string, FakeScenario>, opts: { timeNow?: string; failFirst?: number[]; status?: number } = {}) {
  const calls: FakeCall[] = [];
  const failures = [...(opts.failFirst ?? [])];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = new URL(String(url)).pathname;
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init?.body ? (JSON.parse(String(init.body)) as FakeCall["body"]) : null;
    calls.push({ path, body, headers });
    const fail = failures.shift();
    if (fail) return new Response(JSON.stringify({ error: "fail" }), { status: fail, headers: fail === 429 ? { "retry-after": "1" } : {} });
    if (opts.status) return new Response("{}", { status: opts.status });
    if (headers["x-api-key"] !== "test-key") return new Response(JSON.stringify({ detail: "bad key" }), { status: 401 });
    if (path === "/api/ping") return Response.json({ ok: true });
    if (!body || body.products.length > 1000) return new Response("{}", { status: 422 });
    const ids = body.products;
    if (path === "/api/price") {
      return Response.json({
        customerId: body.customer,
        currency: "EUR",
        pricingDate: body.requestedDate,
        products: ids
          .filter((id) => scenarios[id]?.omit !== "price")
          .map((id) => {
            const s = scenarios[id];
            if (!s || s.price === undefined || s.price === "error") return { productId: id, quantity: 1, error: true };
            const vat = Math.round(s.price * 1.135 * 100) / 100;
            const window = { validFrom: s.validFrom ?? "2026-11-01", validTo: s.validTo ?? "2026-11-30" };
            return {
              productId: id,
              quantity: 1.0,
              catalogPrice: { value: s.price, valueWithTax: vat, ...window, currency: "EUR" },
              priceWithTax: { value: vat, ...window },
              comparisonPrice: s.price / 10,
              comparisonUnit: "L",
              tax: { taxRate: 13.5, taxValue: Math.round((vat - s.price) * 100) / 100 },
              listPrice: { value: s.price },
              netPriceFound: false,
              error: false,
            };
          }),
      });
    }
    if (path === "/api/availability") {
      return Response.json({
        timeNow: opts.timeNow ?? "2026-11-13T12:00:00",
        requestedDate: body.requestedDate,
        products: ids
          .filter((id) => scenarios[id]?.omit !== "availability")
          .map((id) => {
            const s = scenarios[id] ?? { noLines: true };
            const terminal = s.logisticModel === "Terminal";
            return {
              productId: id,
              closingTime: s.closingTime ?? "2026-11-13T14:00:00",
              salesBlock: s.salesBlock ?? false,
              logisticModel: s.logisticModel ?? "Stock",
              scheduleLines: s.noLines
                ? []
                : [{ availableAmount: terminal ? 999999 : (s.amount ?? 100), availableDate: s.date ?? body.requestedDate, salesUnit: s.unit ?? "KI", salesBlock: s.lineBlock ?? false }],
            };
          }),
      });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetch: fetchImpl as typeof fetch, calls };
}
