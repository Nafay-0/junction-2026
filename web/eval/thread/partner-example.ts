/* eslint-disable @typescript-eslint/no-explicit-any -- eval harness: reads untyped JSON replies. */
/**
 * Valio's own example, exactly as a judge types it, on every kind of kitchen, twice in a row on the same kitchen:
 * "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and
 * availability." It must reach options, an order or a sign-off (after answering the mistake check if one is asked), and
 * never "couldn't get prices" or "Something went wrong". Run it against servers whose clock is set (a Sunday morning at
 * 10:30, a weekday): `DOCK_FAKE_NOW=2026-11-15T10:30:00+02:00 NODE_OPTIONS=--require fake-now.cjs pnpm start`.
 *
 *   pnpm tsx eval/thread/partner-example.ts --url http://localhost:4820 [--kitchens hotel-lumo,kaari,...]
 */
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";
import { loadLocalEnv } from "../../scripts/lib/env";

loadLocalEnv();

const SENTENCE = "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.";
const BAD = /couldn't get prices|don't have prices|no prices|Something went wrong|didn't manage|en saanut hintoja/i;

(async () => {
  const argv = process.argv.slice(2);
  const flag = (f: string) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  const base = flag("--url") ?? "http://localhost:4820";
  const kitchens = (flag("--kitchens") ?? "hotel-lumo,koulu-metsola,kahvila-sointu,kaari,fresh").split(",");
  let failed = 0;
  for (const k0 of kitchens) {
    let slug = k0;
    let cookie = "";
    if (k0 === "fresh") {
      const r = await fetch(`${base}/ui-api/account/fresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fresh: true }) });
      cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
      slug = String(((await r.json()) as any).next ?? "").split("/").filter(Boolean).at(-1) ?? "";
    } else {
      // The built-in stage kitchens sign in with their password from the environment (never printed).
      const stage = k0 === "kaari" || k0 === "laakso" ? process.env[`DOCK_${k0.toUpperCase()}_PASSWORD`] : undefined;
      const acc = stage ? { username: k0, password: stage } : TEST_ACCOUNTS.find((a) => a.username === k0);
      if (acc) {
        const r = await fetch(`${base}/ui-api/account/signin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: acc.username, password: acc.password }) });
        cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
      }
    }
    const call = (m: string, p: string, b?: unknown) => fetch(`${base}${p}`, { method: m, headers: { "content-type": "application/json", cookie }, ...(b ? { body: JSON.stringify(b) } : {}) }).then((r) => r.json() as Promise<any>);
    const say = async (text: string) => {
      const sent = await call("POST", `/ui-api/kitchens/${slug}/thread/turns`, { door: "typed", via: "typed", text, lang: "en" });
      for (let i = 0; i < 240; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const a = (await call("GET", `/ui-api/kitchens/${slug}/thread`)).thread?.turns?.find((x: any) => x.turnId === sent?.agentTurnId);
        if (a && a.status !== "working") return a;
      }
      return undefined;
    };
    for (const round of [1, 2]) {
      await call("POST", `/ui-api/kitchens/${slug}/thread/reset`, {});
      await call("GET", `/ui-api/kitchens/${slug}/thread`);
      let a = await say(SENTENCE);
      const lines = [a?.line ?? "(no answer)"];
      if (a?.cards?.some((c: any) => c.type === "anomaly")) {
        a = await say("yes, 1000 litres is right");
        lines.push(a?.line ?? "(no answer)");
      }
      const types = (a?.cards ?? []).map((c: any) => c.type);
      const reached = types.some((t: string) => ["options", "order", "gate", "price", "sheet"].includes(t));
      const ok = reached && !lines.some((l) => BAD.test(l)) && a?.status !== "failed";
      if (!ok) failed++;
      console.log(`${ok ? "PASS" : "FAIL"} ${k0} run ${round}: [${a?.status}; ${types.join(",")}]\n  ${lines.join("\n  ")}\n`);
    }
  }
  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
