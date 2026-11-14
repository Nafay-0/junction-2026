/**
 * A stand-in for the partner's price and availability API, for dependency-failure probes. Never the real one.
 *
 *   pnpm tsx qa/bin/fake-partner.ts 4399
 *   VALIO_API_BASE=http://localhost:4399 VALIO_API_KEY=x qa/bin/fresh-server.sh 4315 real
 *
 * POST /__mode {"mode": "..."} switches behaviour:
 *   ok       plausible answers (price 150 c, 500 in stock, cut-off tomorrow 15:00, delivery in two days)
 *   down     connection-level 503 on every call
 *   slow     answers after 20 s
 *   garbage  200 with a body that is not JSON
 *   weird    200 JSON with hostile values: negative, zero and NaN-like prices, validTo in the past,
 *            sentinel and negative stock, cut-off already passed, products missing, unknown extra products,
 *            salesBlock true on one line, dates that are not dates
 *   r429     429 with Retry-After on every call
 */
import { createServer } from "node:http";

let mode = process.env.FAKE_MODE ?? "ok";
const port = Number(process.argv[2] ?? 4399);
let calls = 0;

const day = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

function price(ids: string[]) {
  return {
    customerId: "dock",
    currency: "EUR",
    pricingDate: day(0),
    products: ids.map((productId, i) => {
      if (mode === "weird") {
        const v = [-150, 0, 1e12, 150][i % 4];
        return { productId, quantity: 1, catalogPrice: { value: v, valueWithTax: v * 1.14, validFrom: "2020-01-01", validTo: i % 3 === 0 ? "2001-01-01" : "not-a-date", currency: "EUR" }, priceWithTax: { value: v * 1.14 }, comparisonPrice: v / 10, comparisonUnit: "L", tax: { taxRate: 14, taxValue: v * 0.14 }, listPrice: v, netPriceFound: false, error: i % 5 === 4 };
      }
      return { productId, quantity: 1, catalogPrice: { value: 150, valueWithTax: 171, validFrom: day(-10), validTo: day(30), currency: "EUR" }, priceWithTax: { value: 171 }, comparisonPrice: 1.5, comparisonUnit: "L", tax: { taxRate: 14, taxValue: 21 }, listPrice: 150, netPriceFound: false, error: false };
    }),
  };
}

function availability(ids: string[], requestedDate: string) {
  const list = mode === "weird" ? [...ids.slice(1), "999999999"] : ids;
  return {
    timeNow: new Date().toISOString(),
    requestedDate,
    products: list.map((productId, i) => {
      if (mode === "weird") {
        return { productId, closingTime: i % 2 ? "2001-01-01T15:00:00+0200" : "tomorrow", salesBlock: i % 4 === 3, logisticModel: "Stock", scheduleLines: [{ availableAmount: [-5, 9999999999, 0, 3.7][i % 4], availableDate: i % 3 ? "31.12.2026" : day(400), salesUnit: "KI", salesBlock: false }] };
      }
      return { productId, closingTime: `${day(1)}T15:00:00+0200`, salesBlock: false, logisticModel: "Stock", scheduleLines: [{ availableAmount: 500, availableDate: requestedDate || day(2), salesUnit: "KI", salesBlock: false }] };
    }),
  };
}

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/__mode") {
      mode = (JSON.parse(body || "{}") as { mode?: string }).mode ?? mode;
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ mode, calls }));
      return;
    }
    calls++;
    const send = (status: number, json: unknown, headers: Record<string, string> = {}) => res.writeHead(status, { "content-type": "application/json", ...headers }).end(typeof json === "string" ? json : JSON.stringify(json));
    if (mode === "down") return send(503, { error: "down" });
    if (mode === "r429") return send(429, { error: "slow down" }, { "retry-after": "30" });
    if (mode === "garbage") return send(200, "<html>Service temporarily unavailable</html>");
    const parsed = (() => {
      try {
        return JSON.parse(body) as { products?: string[]; requestedDate?: string };
      } catch {
        return {};
      }
    })();
    const ids = parsed.products ?? [];
    const answer = () => (req.url?.includes("price") ? send(200, price(ids)) : req.url?.includes("availability") ? send(200, availability(ids, parsed.requestedDate ?? "")) : send(200, { ok: true }));
    if (mode === "slow") setTimeout(answer, 20_000);
    else answer();
  });
}).listen(port, () => console.log(`fake partner on ${port}, mode ${mode}`));
