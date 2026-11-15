// Shifts the process clock to DOCK_FAKE_NOW (moving from there in real time). Date only; timers stay real.
const target = Date.parse(process.env.DOCK_FAKE_NOW || "");
if (Number.isFinite(target)) {
  const RealDate = Date;
  const offset = target - RealDate.now();
  function FakeDate(...a) {
    if (!new.target) return new RealDate(RealDate.now() + offset).toString();
    return a.length === 0 ? new RealDate(RealDate.now() + offset) : new RealDate(...a);
  }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => RealDate.now() + offset;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  Object.defineProperty(FakeDate, Symbol.hasInstance, { value: (x) => x instanceof RealDate });
  globalThis.Date = FakeDate;
}
