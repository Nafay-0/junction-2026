/**
 * A server on a fixed clock, for a browser run that gives the same result any day of the week: preloaded into
 * `next start` (NODE_OPTIONS=--require), it starts the process's clock at DOCK_FAKE_NOW (an ISO time with its offset)
 * and lets it run from there. Date.now() and new Date() follow it; everything else about Date is the real one. Nothing
 * when neither is set. DOCK_FAKE_OFFSET_MS (milliseconds to add to the real clock) is used before DOCK_FAKE_NOW, so the
 * servers of one run and its tests share one offset. Used by start-server.mjs when E2E_NOW is set (e2e/README.md
 * "A fixed clock").
 */
const given = Number(process.env.DOCK_FAKE_OFFSET_MS);
const target = Date.parse(process.env.DOCK_FAKE_NOW || "");
if (process.env.DOCK_FAKE_OFFSET_MS ? Number.isFinite(given) : Number.isFinite(target)) {
  const RealDate = Date;
  const offset = process.env.DOCK_FAKE_OFFSET_MS ? given : target - RealDate.now();
  const now = () => RealDate.now() + offset;
  globalThis.Date = new Proxy(RealDate, {
    construct(T, args, newTarget) { return Reflect.construct(T, args.length ? args : [now()], newTarget === globalThis.Date ? T : newTarget); },
    apply() { return new RealDate(now()).toString(); },
    get(T, p) { return p === "now" ? now : Reflect.get(T, p); },
  });
}
