/**
 * pnpm mail:proof [--out dir] [--no-send]
 *
 * Email to the kitchen end to end, in process on the seed catalogue (web/docs/mail.md): a kitchen gives an address and
 * confirms it from the link, then real events make real mails: an order placed by the agent alone (the receipt), one
 * that needs an OK, a product that cannot come (the watch, on a staged stock-out), an order the kitchen's rules refuse.
 * A Finnish kitchen gets its receipt in Finnish. Every mail is written to --out as .html and .txt.
 *
 * Sends ONLY to Resend's own test inboxes (delivered@resend.dev, bounced@resend.dev): never to a person. Reads only
 * RESEND_API_KEY from web/.env.local (nothing else, so no database or hosted service is touched); --no-send renders
 * without sending. Prints each mail's outcome and Resend id, never the key.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = resolve(opt("out") ?? ".data/mail-proof");
const send = !args.includes("--no-send");

// Nothing from .env.local but the mail key: the runtime stays in memory, on the seed, off every hosted service.
for (const k of Object.keys(process.env)) if (/^(DOCK_|DATABASE_URL|VALKEY|KAFKA|OPENSEARCH|VALIO_|AIVEN)/.test(k)) delete process.env[k];
process.env.DOCK_CATALOG = "seed";
process.env.DOCK_MEMORY_LLM = "off";
process.env.DOCK_RATE_LIMITS = "off";
process.env.DOCK_WATCH_MINUTES = "0";
process.env.RADAR_POLL = "off";
process.env.DOCK_TEST_ACCOUNTS_RESET_MINUTES = "0";
if (send) {
  try {
    const line = readFileSync(resolve(".env.local"), "utf8").split(/\r?\n/).find((l) => l.startsWith("RESEND_API_KEY="));
    const v = line?.slice("RESEND_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
    if (v) process.env.RESEND_API_KEY = v;
  } catch {
    // no .env.local: render only
  }
  if (!process.env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not in web/.env.local: run with --no-send to render only.");
    process.exit(1);
  }
}

const DELIVERED = "delivered@resend.dev";
const RUN = Date.now().toString(36);
const BOUNCED = "bounced@resend.dev";

async function main() {
  const { getRuntime } = await import("../src/server/runtime");
  const { resolveKitchen } = await import("../src/server/console-kitchens");
  const svc = await import("../src/server/notify/service");
  const { FakeTransport, ResendTransport } = await import("../src/server/notify/transport");
  const { stageStockOut, stageDrift, setAutoRenew, runWatch } = await import("../src/server/watch/service");
  const rt = await getRuntime();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  // Every outgoing mail is written to disk, then handed to Resend (or nowhere with --no-send).
  const inner = send ? new ResendTransport(process.env.RESEND_API_KEY!) : new FakeTransport();
  let n = 0;
  const files: string[] = [];
  const recording = {
    name: inner.name,
    async send(m: Parameters<typeof inner.send>[0]) {
      if (m.to !== DELIVERED && m.to !== BOUNCED) throw new Error(`refusing to send to anyone but Resend's test inboxes`);
      const base = `${String(++n).padStart(2, "0")}-${m.tags?.map((t) => t.value).join("-") ?? "mail"}`;
      writeFileSync(join(out, `${base}.html`), m.html);
      writeFileSync(join(out, `${base}.txt`), `Subject: ${m.subject}\n\n${m.text}`);
      files.push(base);
      // Event keys are stable (a kitchen's stock-out on a day): a run repeated within Resend's 24 hours would be
      // refused as a repeat, so the proof makes its keys its own.
      return inner.send({ ...m, idempotencyKey: `${m.idempotencyKey}-proof-${RUN}` });
    },
    status: (id: string) => inner.status!(id),
  };
  svc.setMailTransport(rt, recording);

  const kitchen = async (slug: "kaari" | "laakso") => {
    const k = (await resolveKitchen(slug))!;
    const session = await rt.dock.authenticate(k.mandateToken, k.agentId, { via: "onsite", path: "/scripts/mail-proof", method: "POST" } as never);
    return { k, session, ref: { orgId: k.info.orgId, slug, name: k.info.name } };
  };
  const flush = async () => {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 20));
      await svc.settled(rt);
    }
  };
  const confirmFrom = async (orgId: string) => {
    const html = readFileSync(join(out, `${files.at(-1)}.html`), "utf8");
    const t = /\/mail\/confirm\?t=([\w.-]+)/.exec(html)?.[1];
    const r = await svc.confirmAddress(rt, t);
    if (!r.ok) throw new Error(`confirmation failed for ${orgId}`);
  };
  const order = async (s: Awaited<ReturnType<typeof kitchen>>, productId: string, packs: number) => {
    const req = await rt.dock.openRequest(s.session, { text: `${packs} packs of ${productId}` });
    await rt.dock.requestQuote(s.session, { requestId: req.requestId, lines: [{ productId, quantity: packs }] });
    return rt.dock.placeOrder(s.session, { requestId: req.requestId });
  };

  // Kaari, in English: address, confirmation, then the events.
  const kaari = await kitchen("kaari");
  await svc.setAddress(rt, kaari.ref, DELIVERED, { by: "Sanna Koskinen (head chef)", via: "mail-proof", lang: "en" });
  await flush();
  await confirmFrom(kaari.ref.orgId);
  const alone = await order(kaari, "VA-3101", 6); // yoghurt, inside the €100 the agent may spend alone
  const cream = await order(kaari, "VA-2301", 4);
  void cream;
  const big = await order(kaari, "VA-3101", 40); // over the limit: waits for an OK
  const refused = await order(kaari, "PK-4001", 5).catch(() => undefined); // plant drink: outside the kitchen's rules
  await rt.dock.withdrawOrder(kaari.session, big.orderId, { reason: "the buyer changed their mind", by: "Sanna Koskinen" } as never).catch((e: Error) => console.log(`withdraw: ${e.message}`));
  await stageStockOut(rt, { kitchen: "kaari", productId: "VA-1010", by: "mail-proof" });
  await runWatch(rt, { kitchens: ["kaari"], fresh: true, by: "mail-proof" });
  await flush();
  // A creeping recurring order with auto-renew on: held (drift) or renewed with a substitute (the usual cannot come).
  await stageDrift(rt, { kitchen: "kaari", family: "milk", by: "mail-proof" });
  await setAutoRenew(rt, kaari.session, { family: "milk", on: true, by: "Sanna Koskinen", via: "mail-proof" });
  await runWatch(rt, { kitchens: ["kaari"], fresh: true, renew: "now", by: "mail-proof" });
  await flush();

  // Laakso, in Finnish: its receipt.
  const laakso = await kitchen("laakso");
  await svc.setAddress(rt, laakso.ref, DELIVERED, { by: "Laakso kitchen", via: "mail-proof", lang: "fi" });
  await flush();
  await confirmFrom(laakso.ref.orgId);
  const fi = await order(laakso, "VA-1035", 6); // lactose-free milk: inside Laakso's rules
  await flush();

  // A bounce, straight to Resend's bouncing inbox (not through a kitchen).
  let bounceId: string | undefined;
  if (send) {
    const r = await inner.send({ from: svc.mailFrom(), to: BOUNCED, subject: "AimoPilot bounce test", html: "<p>Bounce test.</p>", text: "Bounce test.", idempotencyKey: `aimopilot-bounce-test-${Date.now()}` });
    bounceId = r.ok ? r.id : undefined;
    console.log(`bounce test to ${BOUNCED}: ${r.ok ? `accepted, id ${r.id}` : `${r.code}: ${r.message}`}`);
  }

  const view = await svc.mailView(rt);
  console.log(`\norders: alone ${alone.orderId} ${alone.status}; big ${big.orderId} ${big.status}; refused ${refused?.status ?? "threw"}; Finnish ${fi.orderId} ${fi.status}`);
  console.log(`\n${view.mails.length} mails (${view.transport}, from ${view.from}):`);
  for (const m of [...view.mails].reverse()) console.log(`  ${m.kind}${m.change ? `/${m.change}` : ""} ${m.lang} ${m.outcome}${m.providerId ? ` id ${m.providerId}` : ""}${m.reason ? ` (${m.reason})` : ""}  "${m.subject}"`);
  if (send) {
    await new Promise((r) => setTimeout(r, 8000));
    console.log("\ndelivery as Resend reports it after 8 s:");
    for (const m of [...view.mails].reverse()) if (m.providerId) console.log(`  ${m.providerId}: ${await svc.checkDelivery(rt, m.mailId)}`);
    if (bounceId) console.log(`  ${bounceId} (bounce test): ${await inner.status(bounceId)}`);
  }
  const ledger = JSON.stringify(rt.dock.ledger.entries());
  console.log(`\nledger: ${rt.dock.ledger.entries().filter((e) => e.type === "mail").length} mail entries; the address appears in the ledger: ${ledger.includes(DELIVERED) ? "YES (bug)" : "no"}; chain ok: ${rt.dock.ledger.verify().ok}`);
  console.log(`files: ${out}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
