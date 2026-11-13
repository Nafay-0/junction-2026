/**
 * Short smoke test of a running Dock over HTTP(S), as a stranger and as an outside agent would see it.
 *
 *   pnpm smoke --url https://<app-host>                 against a deployed server
 *   pnpm smoke --url http://localhost:3100 --commit <sha>  also require /api/health to report that commit
 *
 * Signs the demo mandate with DOCK_DEMO_ORG_JWK (web/.env.local), which must match the server's.
 * Costs a handful of live partner lookups and no model calls. Prints one line per check and PASS or FAIL;
 * exits 1 on failure.
 */
import { base64url } from "jose";
import { signMandate } from "@/core/mandate";
import { addDays, isoDate } from "@/core/util";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "@/server/dev-fixtures";
import { loadLocalEnv } from "./lib/env";
import { DockClient, type Step } from "./lib/client";

loadLocalEnv();
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const baseUrl = (flag("--url") ?? "http://localhost:3100").replace(/\/$/, "");
const wantCommit = flag("--commit");

type Check = { name: string; ok: boolean; detail: string };
const results: Check[] = [];
const record = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"}  ${name.padEnd(34)} ${detail}`);
};

async function get(path: string, init: RequestInit = {}) {
  const res = await fetch(baseUrl + path, { redirect: "manual", ...init, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, text, json: json as Record<string, any>, headers: res.headers }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function check(name: string, fn: () => Promise<[boolean, string]>) {
  try {
    const [ok, detail] = await fn();
    record(name, ok, detail);
  } catch (err) {
    record(name, false, `threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** A delivery day three working days out, so cut-offs and lead times never get in the way. */
function deliveryDay(): string {
  let d = new Date();
  let n = 0;
  while (n < 3) {
    d = addDays(d, 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++;
  }
  return isoDate(d);
}

async function main() {
  console.log(`Smoke test of ${baseUrl}${wantCommit ? ` (expecting commit ${wantCommit.slice(0, 12)})` : ""}\n`);

  await check("health", async () => {
    const r = await get("/api/health");
    const h = r.json;
    if (r.status !== 200 || !h) return [false, `HTTP ${r.status}`];
    const commitOk = !wantCommit || h.version?.commit === wantCommit;
    const services = Object.entries(h.services ?? {})
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
    return [commitOk && h.catalog?.products > 0, `commit ${String(h.version?.commit).slice(0, 12)}, catalogue ${h.catalog?.source} (${h.catalog?.products} products, index from ${h.catalog?.index?.from ?? "-"}), ${services}`];
  });

  // The wall first: rendering it used to break every later API error (500 instead of 401/422).
  await check("wall page /", async () => {
    const r = await get("/");
    return [r.status === 200 && r.text.includes("<html"), `HTTP ${r.status}, ${r.text.length} bytes`];
  });
  await check("buyer console /k/kaari", async () => {
    const r = await get("/k/kaari");
    return [r.status === 200 && r.text.includes("<html"), `HTTP ${r.status}, ${r.text.length} bytes`];
  });
  await check("join page /join", async () => {
    const r = await get("/join");
    const title = /<title>([^<]*)/.exec(r.text)?.[1];
    return [r.status === 200 && /approver/i.test(title ?? ""), `HTTP ${r.status}, title "${title}"`];
  });
  await check("passkey options (POST /api/v1/join)", async () => {
    const r = await get("/api/v1/join", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const rp = r.json?.options?.rp?.id;
    const host = new URL(baseUrl).hostname;
    return [r.status === 200 && rp === host && r.json?.secureOrigin === true, `HTTP ${r.status}, rp.id ${rp}, secure origin ${r.json?.secureOrigin}`];
  });

  for (const path of ["/.well-known/dock.json", "/.well-known/api-catalog", "/.well-known/jwks.json", "/api/v1/openapi.json", "/llms.txt"]) {
    await check(`discovery ${path}`, async () => {
      const r = await get(path);
      const ok = r.status === 200 && (path === "/llms.txt" ? r.text.length > 100 : !!r.json);
      return [ok, `HTTP ${r.status}${path.includes("jwks") ? `, kid ${r.json?.keys?.[0]?.kid}` : ""}`];
    });
  }

  await check("console back end /ui-api", async () => {
    const info = await get("/ui-api/kitchens/kaari");
    const call = await get("/ui-api/kitchens/kaari/call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method: "GET", path: "/api/v1/kitchen" }) });
    const wall = await get("/ui-api/wall");
    return [info.status === 200 && call.status === 200 && wall.status === 200, `kitchen ${info.status}, call GET /api/v1/kitchen ${call.status} (${call.json?.kitchen?.name ?? "?"}), wall ${wall.status}`];
  });

  const token = await signMandate(demoMandate(new Date()), await demoOrgKeyPair());
  const agent = new DockClient((req) => fetch(req), baseUrl).as(token, DEMO_ORG.agentId);

  await check("search (request + products)", async () => {
    const req = await agent.openRequest("Smoke test: lactose-free milk");
    if (req.status !== 201) return [false, `open request HTTP ${req.status} ${JSON.stringify(req.body.error)}`];
    const s = await agent.search(req.body.request.requestId, { q: "maito", category: "milk", attributes: ["lactose_free"] });
    return [s.status === 200 && s.body.products.length > 0, `HTTP ${s.status}, ${s.body.products?.length ?? 0} products, first ${s.body.products?.[0]?.id ?? "-"}`];
  });

  let quoted: Step | undefined;
  await check("intake -> quote", async () => {
    const by = "Smoke test";
    let s = (await agent.intakeOpen({ item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 200, unit: "L" }, deliverBy: deliveryDay(), optimise: "price" }, by)).body.step;
    const trail = [s?.state];
    for (let i = 0; i < 5 && s && s.state !== "quoted"; i++) {
      if (s.state === "needs_confirmation") s = (await agent.intakeConcerns(s.requestId, by, s.concerns.map((c) => ({ key: c.key, choice: c.confirmable ? "confirm" : c.corrections[0].id })))).body.step;
      else if (s.state === "needs_input") s = (await agent.intakeAnswers(s.requestId, by, s.questions.map((q) => ({ questionId: q.id, optionId: (q.options.find((o) => o.id === "no_preference") ?? q.options[0]).id })))).body.step;
      else if (s.state === "options_ready") s = (await agent.intakeChoice(s.requestId, by, s.options[0].optionId)).body.step;
      else break;
      trail.push(s?.state);
    }
    if (s?.state === "quoted") quoted = s;
    const q = s?.quote?.quote;
    return [s?.state === "quoted", `${trail.join(" -> ")}${q ? `; quote ${q.quoteId} €${(q.totalCents / 100).toFixed(2)}, gate preview ${s!.quote!.policyPreview.outcome}` : ""}`];
  });

  await check("refusal: tampered mandate", async () => {
    const [h, p, sig] = token.split(".");
    const claims = JSON.parse(new TextDecoder().decode(base64url.decode(p)));
    claims.mandate.weeklyBudgetCents = 100_000_000;
    const forged = new DockClient((req) => fetch(req), baseUrl).as([h, base64url.encode(JSON.stringify(claims)), sig].join("."), DEMO_ORG.agentId);
    const r = await forged.openRequest("more milk");
    const e = r.body.error;
    return [r.status === 401 && e?.rule === "mandate_signature", `HTTP ${r.status}, rule ${e?.rule}, code ${e?.code}`];
  });

  await check("refusal: order below the quoted price", async () => {
    if (!quoted?.quote) return [false, "no quote from the intake step"];
    const lines = quoted.quote.quote.lines.map(({ productId, quantity }) => ({ productId, quantity, unitPriceCents: 1 }));
    const r = await agent.placeOrder(quoted.requestId, quoted.quote.quoteToken, lines);
    const e = r.body.error;
    return [r.status === 422 && e?.rule === "order_matches_quote", `HTTP ${r.status}, rule ${e?.rule}, code ${e?.code}`];
  });

  await check("no dev routes in production", async () => {
    const r = await get("/api/v1/dev/outbox");
    return [r.status === 404, `GET /api/v1/dev/outbox -> HTTP ${r.status}`];
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? "FAIL" : "PASS"}: ${results.length - failed.length} of ${results.length} checks passed${failed.length ? ` (failed: ${failed.map((f) => f.name).join(", ")})` : ""}.`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`FAIL: smoke test crashed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
