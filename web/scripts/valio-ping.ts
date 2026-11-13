/**
 * Check the partner API key and price three lactose-free milks. Gentle: one ping, one price and one availability
 * call for three products.
 *
 *   pnpm valio:ping               needs VALIO_API_KEY (in .env.local) and the index (pnpm index:build)
 *   pnpm valio:ping 2026-11-16    ask for delivery on that date (default: next weekday)
 *
 * Skips with a message, exit code 0, when there is no key, so it is safe in any checklist.
 */
import { MeteredCatalog } from "@/core/catalog";
import { addDays } from "@/core/util";
import { loadCatalogIndex } from "@/server/valio/index-store";
import { ValioApiError, ValioLiveClient, helsinkiDate } from "@/server/valio/live-client";
import { ValioCatalog } from "@/server/valio/valio-catalog";
import { env, loadLocalEnv } from "./lib/env";

async function main() {
  loadLocalEnv();
  const apiKey = env("VALIO_API_KEY");
  if (!apiKey) {
    console.log("SKIP valio:ping: VALIO_API_KEY is not set (put it in web/.env.local). Nothing was sent.");
    return;
  }
  const baseUrl = env("VALIO_API_BASE") ?? "https://junction26.valioaimo.fi";
  const live = new ValioLiveClient({ baseUrl, apiKey, customer: env("VALIO_CUSTOMER") });

  const ping = await live.ping();
  console.log(`ping ${baseUrl}/api/ping: HTTP ${ping.status} ${ping.ok ? "OK" : "FAILED"}`);
  if (!ping.ok) {
    process.exitCode = 1;
    return;
  }

  const loaded = loadCatalogIndex();
  if (!loaded) {
    console.log("SKIP pricing: no catalogue index. Run `pnpm index:build` first.");
    return;
  }
  const valio = new ValioCatalog(loaded.index, live);
  const catalog = new MeteredCatalog(valio);
  const milks = valio.search({ text: "lactose-free milk", category: "milk", limit: 3 }).map((h) => h.product);
  const date = process.argv[2] ?? nextWeekday();
  console.log(`Pricing ${milks.length} lactose-free milks for delivery ${date}:`);
  const statuses = await catalog.getLiveStatus(
    milks.map((p) => p.id),
    { deliveryDate: date },
  );
  for (const s of statuses) {
    const p = milks.find((m) => m.id === s.productId)!;
    console.log(`  ${s.orderable ? "OK  " : "NO  "} ${p.names.en ?? p.names.fi} [${p.pack.label}]`);
    console.log(`       ${s.message}`);
  }
  console.log(`Partner traffic: ${JSON.stringify(catalog.stats())}`);
}

function nextWeekday(): string {
  let d = addDays(new Date(), 1);
  while ([0, 6].includes(new Date(`${helsinkiDate(d)}T12:00:00Z`).getUTCDay())) d = addDays(d, 1);
  return helsinkiDate(d);
}

main().catch((err) => {
  console.error(err instanceof ValioApiError ? `valio:ping failed (${err.code}): ${err.message}` : err);
  process.exitCode = 1;
});
