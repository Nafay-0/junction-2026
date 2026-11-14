/**
 * The tester's acceptance path for the two watch scenarios on a public test kitchen, over HTTP against a running
 * server, through the conversation itself (no adapter called directly):
 *
 *   1. as the kitchen, in words: "switch auto-renew on for the weekly milk order"
 *   2. operations stage creeping portions on that kitchen's milk (/ops/watch) and run the watch
 *   3. the kitchen's agent says the held renewal; the kitchen answers "go back to the usual"
 *   4. operations stage a stock-out of the kitchen's cream; the agent says it with the substitute's amount; "yes"
 *
 *   pnpm watch:acceptance --url http://localhost:4733 [--kitchen hotel-lumo]
 *
 * Model spend: the conversation reads each of the four turns (a few cents).
 */
import { Browser, signInAs, sleep, type Json } from "../eval/thread/lib";
import { loadLocalEnv } from "./lib/env";

loadLocalEnv();
const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const url = opt("url") ?? "http://localhost:4733";
const slug = opt("kitchen") ?? "hotel-lumo";

async function main() {
  const k = new Browser(url);
  await signInAs(k, slug);
  const ops = new Browser(url);
  await ops.req("POST", "/ops-api/session", { name: "Acceptance", ...(process.env.DOCK_OPS_PASSCODE ? { passcode: process.env.DOCK_OPS_PASSCODE } : {}) });
  const root = `/ui-api/kitchens/${slug}/thread`;
  await k.post(`${root}/reset`, {});
  await k.get(root);

  const said = (turn: Json): string => {
    const lines: string[] = [];
    if (turn.line) lines.push(turn.line);
    if (turn.text) lines.push(turn.text);
    for (const c of turn.cards ?? []) {
      if (c.type === "watch") lines.push(`[watch ${c.kind}${c.staged ? ", staged" : ""}] ${c.text?.en?.say ?? ""} ${c.text?.en?.ask ?? ""}`);
      else if (c.type === "today") lines.push(`[today] ${(c.items ?? []).map((i: Json) => i.kind).join(", ")}`);
      else if (c.type === "order" || c.type === "gate") lines.push(`[${c.type}] ${c.status ?? c.outcome ?? ""} ${c.totalCents ? `${(c.totalCents / 100).toFixed(2)} €` : ""}`);
      else if (c.type === "line" || c.type === "text") lines.push(c.text ?? "");
    }
    return lines.filter(Boolean).join("\n      ");
  };
  async function say(text: string): Promise<string> {
    const r = await k.post(`${root}/turns`, { door: "typed", via: "typed", text, lang: "en", clientTurnId: `acc_${Date.now().toString(36)}` });
    const id = r.body?.agentTurnId;
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      const t = ((await k.get(root)).body?.thread?.turns ?? []).find((x: Json) => x.turnId === id);
      if (t && t.status && !["working", "queued", "pending"].includes(t.status)) return said(t);
    }
    return "(no answer in 60 s)";
  }

  console.log(`Kitchen ${slug} at ${url}\n`);
  console.log(`1. buyer: "switch auto-renew on for the weekly milk order"`);
  console.log(`   agent: ${await say("switch auto-renew on for the weekly milk order")}`);

  console.log(`\n2. operations stage creeping portions on the milk, and run the watch`);
  const st = await ops.req("POST", "/ops-api/watch", { action: "stage_drift", kitchen: slug, family: "milk" });
  console.log(`   stage_drift: ${st.status} ${st.body?.error?.message ?? ""}`);
  const run = (await ops.req("POST", "/ops-api/watch", { action: "run", kitchens: [slug], fresh: true })).body?.run?.[0];
  console.log(`   run: ${run?.findings?.length ?? 0} findings, renewals ${(run?.renewals ?? []).map((r: Json) => `${r.family} ${r.state}`).join(", ") || "none"}`);

  console.log(`\n3. buyer opens the agent: "Is this week's milk order sorted?"`);
  console.log(`   agent: ${await say("Is this week's milk order sorted?")}`);
  console.log(`   buyer: "go back to the usual"`);
  console.log(`   agent: ${await say("go back to the usual")}`);

  console.log(`\n4. operations stage a stock-out of the kitchen's cream; buyer: "anything else I should know this week?"`);
  const v = (await ops.req("GET", "/ops-api/watch")).body;
  const cream = (v?.kitchens ?? []).find((x: Json) => x.slug === slug)?.standing.find((s: Json) => s.family === "cream");
  if (cream) {
    await ops.req("POST", "/ops-api/watch", { action: "stage_stock_out", kitchen: slug, productId: cream.productId });
    await ops.req("POST", "/ops-api/watch", { action: "run", kitchens: [slug], fresh: true });
    console.log(`   agent: ${await say("anything else I should know this week?")}`);
  }
  const w = (await ops.req("GET", "/ops-api/watch")).body;
  console.log(`\n   operations: ${JSON.stringify(w?.stats)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
