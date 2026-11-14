/**
 * The backup scenario on the three public test kitchens, through the conversation over HTTP against a running server
 * (a production build): the buyer asks for the kitchen's weekly poor-record product in a chef's words, says yes to the
 * order, answers the record sentence with "you choose"; operations stage that product out of stock on /ops/watch and
 * run the watch; the buyer asks what they should know; /ops/watch shows the backup used.
 *
 *   pnpm backup:acceptance --url http://localhost:4733 [--lang fi]
 *
 * Model spend: the conversation reads each turn (a few cents a kitchen).
 */
import { Browser, signInAs, sleep, type Json } from "../eval/thread/lib";
import { POOR_RECORD } from "@/server/accounts/test-accounts";
import { loadLocalEnv } from "./lib/env";

loadLocalEnv();
const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const url = opt("url") ?? "http://localhost:4733";
const lang = (opt("lang") ?? "en") as "en" | "fi";

const CASES = [
  { slug: "hotel-lumo", productId: POOR_RECORD.lumo, pick: { en: "the Vaasan rye rice pie", fi: "Vaasan ruisriisipiirakka" }, en: "16 kg of Vaasan rye rice pies for Thursday", fi: "16 kg Vaasan ruisriisipiirakoita torstaiksi" },
  { slug: "koulu-metsola", productId: POOR_RECORD.metsola, pick: { en: "the Lollorosso FI", fi: "Lollorosso FI" }, en: "3 kg of Finnish lollo rosso for Wednesday", fi: "3 kg suomalaista lollo rosso -salaattia keskiviikoksi" },
  { slug: "kahvila-sointu", productId: POOR_RECORD.sointu, pick: { en: "the Peltolan churned butter", fi: "Peltolan kirnuvoi" }, en: "2 kg of the Peltolan churned butter for Tuesday", fi: "2 kg Peltolan kirnuvoita tiistaiksi" },
];
const WORDS = { en: { yes: "yes", choose: "you choose", know: "anything I should know this week?" }, fi: { yes: "kyllä", choose: "valitse sinä", know: "onko tällä viikolla jotain, mitä minun pitää tietää?" } };

async function main() {
  const ops = new Browser(url);
  await ops.req("POST", "/ops-api/session", { name: "Acceptance", ...(process.env.DOCK_OPS_PASSCODE ? { passcode: process.env.DOCK_OPS_PASSCODE } : {}) });
  for (const c of CASES) {
    const k = new Browser(url);
    await signInAs(k, c.slug);
    const root = `/ui-api/kitchens/${c.slug}/thread`;
    await k.post(`${root}/reset`, {});
    await k.get(root);
    const said = (t: Json) => [t.line ?? "", ...((t.cards ?? []) as Json[]).flatMap((x) => (x.type === "backup" ? [`[backup] ${x.text}`] : x.type === "watch" ? [`[watch ${x.kind}] ${x.text?.[lang]?.say ?? ""} ${x.text?.[lang]?.ask ?? ""}`] : x.type === "order" || x.type === "gate" ? [`[${x.type} ${x.status ?? x.outcome ?? ""}]`] : []))].filter(Boolean).join("\n        ");
    const say = async (text: string) => {
      const r = await k.post(`${root}/turns`, { door: "typed", via: "typed", text, lang, clientTurnId: `bk_${Date.now().toString(36)}` });
      const id = r.body?.agentTurnId;
      for (let i = 0; i < 120; i++) {
        await sleep(500);
        const t = ((await k.get(root)).body?.thread?.turns ?? []).find((x: Json) => x.turnId === id);
        if (t && t.status && !["working", "queued", "pending"].includes(t.status)) return said(t);
      }
      return "(no answer in 60 s)";
    };
    console.log(`\n=== ${c.slug} (${lang})`);
    // The request, then whatever the conversation asks (yes; which one: the product), until the backup sentence; then "you choose".
    let reply = await say(c[lang]);
    console.log(`   buyer: "${c[lang]}"\n   agent: ${reply}`);
    for (let i = 0; i < 4 && !reply.includes("[backup]"); i++) {
      const next = /which one|mikä niistä|vilken/i.test(reply) ? c.pick[lang] : WORDS[lang].yes;
      reply = await say(next);
      console.log(`   buyer: "${next}"\n   agent: ${reply}`);
    }
    if (reply.includes("[backup]")) console.log(`   buyer: "${WORDS[lang].choose}"\n   agent: ${await say(WORDS[lang].choose)}`);
    await ops.req("POST", "/ops-api/watch", { action: "stage_stock_out", kitchen: c.slug, productId: c.productId });
    const run = (await ops.req("POST", "/ops-api/watch", { action: "run", kitchens: [c.slug], fresh: true })).body?.run?.[0];
    console.log(`   operations: staged ${c.productId} out of stock, ran the watch: ${run?.findings?.length ?? 0} findings`);
    console.log(`   buyer: "${WORDS[lang].know}"\n   agent: ${await say(WORDS[lang].know)}`);
    const b = ((await ops.req("GET", "/ops-api/watch")).body?.backups ?? []).find((x: Json) => x.kitchen === c.slug && x.product?.productId === c.productId);
    console.log(`   /ops/watch: ${b ? `${b.state}; ${b.record?.words}; backup ${b.chosen?.name ?? "-"} chosen by ${b.chosen?.by ?? "-"}${b.used ? `; used: ${b.used.orderId} ${b.used.status}` : ""}` : "no backup listed"}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
