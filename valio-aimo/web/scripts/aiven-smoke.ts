/**
 * pnpm aiven:smoke
 *
 * The real partner catalogue through the Aiven adapters, gently: three product searches (answered by OpenSearch,
 * in-process as the fallback), then live price/availability for the same two or three products twice per kitchen
 * agent request. The second lookup is served from Valkey, so the partner's rate-limited API sees one call, not
 * two. Prints the health report's counters. Needs VALIO_API_KEY, VALIO_INDEX_PATH (or the index under .data/)
 * and the Aiven addresses in web/.env.local; switches every configured adapter on (DOCK_AIVEN=1).
 */
import { loadLocalEnv } from "./lib/env";

loadLocalEnv();
process.env.DOCK_AIVEN ??= "1";

async function main() {
  const { getRuntime } = await import("@/server/runtime");
  const { shutdownAiven } = await import("@/server/aiven");
  const { signMandate } = await import("@/core/mandate");
  const { DEMO_ORG, demoMandate, demoOrgKeyPair } = await import("@/server/dev-fixtures");
  const rt = await getRuntime();
  if (rt.catalogSource.kind !== "valio") {
    console.log("SKIP: the partner catalogue is not loaded (set VALIO_API_KEY and VALIO_INDEX_PATH).");
    await shutdownAiven();
    return;
  }
  const session = await rt.dock.authenticate(await signMandate(demoMandate(new Date()), await demoOrgKeyPair()), DEMO_ORG.agentId);
  const req = await rt.dock.openRequest(session, { text: "Smoke test: lactose-free milk and cream for the week." });
  for (const text of ["laktoositon maito", "vispgrädde", "oat drink barista"]) {
    const t0 = performance.now();
    const hits = await rt.dock.searchProducts(session, { requestId: req.requestId, text, limit: 3 });
    console.log(`search "${text}": ${hits.length} hits in ${Math.round(performance.now() - t0)} ms`);
  }
  const ids = (await rt.dock.searchProducts(session, { requestId: req.requestId, text: "laktoositon maito", limit: 3 })).map((p) => p.id);
  for (const round of [1, 2]) {
    const t0 = performance.now();
    const offers = await rt.dock.checkAvailability(session, { requestId: req.requestId, productIds: ids });
    console.log(`live lookup ${round} for ${ids.length} products: ${offers.length} offers in ${Math.round(performance.now() - t0)} ms`);
  }
  const report = await rt.aiven.health();
  console.log("counters", JSON.stringify(report.counters));
  console.log("search routing", JSON.stringify(report.search));
  await shutdownAiven();
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
