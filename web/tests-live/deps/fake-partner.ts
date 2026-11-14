/**
 * A stand-in for the partner's live price and availability API (POST /api/price, POST /api/availability,
 * GET /api/ping). Never the real one. Adapted from the QA branch's qa/bin/fake-partner.ts, with a control port
 * apart from the API port, so the API can stop listening (connection refused) and come back.
 *
 *   pnpm exec tsx tests-live/deps/fake-partner.ts 4691 4692      # API on 4691, control on 4692
 *   VALIO_API_BASE=http://127.0.0.1:4691 VALIO_API_KEY=fake DOCK_CATALOG= ... next start   (real catalogue index)
 *
 * POST http://127.0.0.1:<control>/__mode {"mode": "...", "delayMs"?, "retryAfter"?, "flapMs"?}; GET /__stats.
 *   ok        plausible answers: price 13.50 EUR per sales unit, 500 in stock, cut-off tomorrow 15:00, delivery on the requested date
 *   slow      answers after delayMs (default 20 000)
 *   hang      accepts and never answers
 *   r429      429 with Retry-After (default "30")
 *   e503      503 JSON error
 *   refused   the API port stops listening: connection refused
 *   reset     accepts, then destroys the socket at once
 *   garbage   200 with an HTML body
 *   flap      alternates refused / ok every flapMs (default 3 000), starting with refused
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

export type PartnerMode = "ok" | "slow" | "hang" | "r429" | "e503" | "refused" | "reset" | "garbage" | "flap";
export type PartnerState = { mode: PartnerMode; delayMs: number; retryAfter: string; flapMs: number; listening: boolean; since: number };
export type PartnerStats = { calls: number; byMode: Record<string, number>; byPath: Record<string, number>; productsPriced: number };

const day = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

function price(ids: string[]) {
  return {
    customerId: "dock",
    currency: "EUR",
    pricingDate: day(0),
    products: ids.map((productId) => ({ productId, quantity: 1, catalogPrice: { value: 13.5, valueWithTax: 15.39, validFrom: day(-10), validTo: day(30), currency: "EUR" }, priceWithTax: { value: 15.39 }, comparisonPrice: 1.35, comparisonUnit: "L", tax: { taxRate: 14, taxValue: 1.89 }, listPrice: 13.5, netPriceFound: false, error: false })),
  };
}

function availability(ids: string[], requestedDate: string) {
  return {
    timeNow: new Date().toISOString(),
    requestedDate,
    products: ids.map((productId) => ({ productId, closingTime: `${day(1)}T15:00:00+0200`, salesBlock: false, logisticModel: "Stock", scheduleLines: [{ availableAmount: 500, availableDate: requestedDate || day(2), salesUnit: "KI", salesBlock: false }] })),
  };
}

export async function startFakePartner(apiPort: number, controlPort: number, host = "127.0.0.1") {
  const state: PartnerState = { mode: (process.env.FAKE_PARTNER_MODE as PartnerMode) ?? "ok", delayMs: 20_000, retryAfter: "30", flapMs: 3_000, listening: false, since: Date.now() };
  const stats: PartnerStats = { calls: 0, byMode: {}, byPath: {}, productsPriced: 0 };
  const sockets = new Set<Socket>();
  const hanging = new Set<ServerResponse>();
  let flapTimer: NodeJS.Timeout | undefined;

  const api: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      stats.calls++;
      const effective = state.mode === "flap" ? "ok" : state.mode; // while flapping, an accepted call is an "up" phase
      stats.byMode[effective] = (stats.byMode[effective] ?? 0) + 1;
      const path = (req.url ?? "").split("?")[0];
      stats.byPath[path] = (stats.byPath[path] ?? 0) + 1;
      const send = (status: number, json: unknown, headers: Record<string, string> = {}) => {
        if (res.destroyed) return;
        res.writeHead(status, { "content-type": "application/json", ...headers }).end(typeof json === "string" ? json : JSON.stringify(json));
      };
      if (effective === "reset") return void req.socket.destroy();
      if (effective === "hang") {
        hanging.add(res);
        res.on("close", () => hanging.delete(res));
        return;
      }
      if (effective === "e503") return send(503, { error: "down" });
      if (effective === "r429") return send(429, { error: "slow down" }, { "retry-after": state.retryAfter });
      if (effective === "garbage") return send(200, "<html>Service temporarily unavailable</html>", { "content-type": "text/html" });
      let parsed: { products?: string[]; requestedDate?: string } = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        /* empty */
      }
      const ids = (parsed.products ?? []).map(String);
      if (path.endsWith("/price")) stats.productsPriced += ids.length;
      const answer = () => (path.endsWith("/price") ? send(200, price(ids)) : path.endsWith("/availability") ? send(200, availability(ids, parsed.requestedDate ?? "")) : send(200, { ok: true }));
      if (effective === "slow") {
        const t = setTimeout(answer, state.delayMs);
        res.on("close", () => clearTimeout(t));
      } else answer();
    });
  });
  api.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });

  const listen = () =>
    new Promise<void>((r) => {
      if (state.listening) return r();
      api.listen(apiPort, host, () => {
        state.listening = true;
        r();
      });
    });
  const unlisten = () =>
    new Promise<void>((r) => {
      for (const h of hanging) h.destroy();
      for (const s of sockets) s.destroy();
      if (!state.listening) return r();
      state.listening = false;
      api.close(() => r());
    });

  async function setMode(next: Partial<PartnerState>) {
    if (flapTimer) clearInterval(flapTimer);
    flapTimer = undefined;
    Object.assign(state, next, { since: Date.now() });
    if (state.mode !== "hang") for (const h of hanging) h.destroy();
    if (state.mode === "refused") await unlisten();
    else if (state.mode === "flap") {
      await unlisten();
      let up = false;
      flapTimer = setInterval(() => {
        up = !up;
        void (up ? listen() : unlisten());
      }, state.flapMs);
    } else await listen();
  }

  const control = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      if (req.url === "/__mode") await setMode(JSON.parse(body || "{}") as Partial<PartnerState>);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ...state, stats }));
    });
  });

  await new Promise<void>((r) => control.listen(controlPort, host, () => r()));
  await setMode({ mode: state.mode });
  return {
    state,
    stats,
    setMode,
    close: async () => {
      if (flapTimer) clearInterval(flapTimer);
      await unlisten();
      control.closeAllConnections();
      await new Promise<void>((r) => control.close(() => r()));
    },
  };
}

if (process.argv[1] && /fake-partner\.ts$/.test(process.argv[1])) {
  const apiPort = Number(process.argv[2] ?? 4691);
  const controlPort = Number(process.argv[3] ?? apiPort + 1);
  void startFakePartner(apiPort, controlPort).then(() => console.log(`fake partner API on 127.0.0.1:${apiPort}, control on ${controlPort}`));
}
