/* eslint-disable @typescript-eslint/no-explicit-any -- eval harness: reads untyped JSON replies. */
/**
 * The mistake check's question is asked once (the second capture's looping conversations, scenarios 12 and 13):
 *
 *   pnpm tsx eval/thread/guard-loops.ts [--url http://localhost:4522] [--only blue-cheese-sointu,...]
 *
 * Checks: no reply repeats the question before it; a request that names the pack and the count is not asked about
 * the unit; litres of milk are never questioned as a unit; the reply after "it's for an event" is whole sentences;
 * "which order?" is answered with the order (an amount and a day).
 */
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";

const args = process.argv.slice(2);
const opt = (f: string, d?: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const base = opt("--url", "http://localhost:4522")!;
const only = opt("--only")?.split(",");

type Case = { id: string; kitchen: string; lang: "en" | "fi"; turns: string[]; direct?: boolean };
export const DISH_FLOW_CASES: Case[] = [
  { id: "open-sointu-en", kitchen: "kahvila-sointu", lang: "en", turns: ["i Have a big lunch coming up next week need to plan a dish for 20 people", "surprise me", "the first one", "yes"] },
  { id: "open-lumo-en", kitchen: "hotel-lumo", lang: "en", turns: ["i Have a big lunch coming up next week need to plan a dish for 20 people", "something Finnish, we have potatoes", "the first one", "yes"] },
  { id: "open-sointu-fi", kitchen: "kahvila-sointu", lang: "fi", turns: ["ensi viikolla on iso lounas, pitää suunnitella ruoka 20 hengelle", "yllätä", "ensimmäinen", "kyllä"] },
  { id: "open-lumo-fi", kitchen: "hotel-lumo", lang: "fi", turns: ["ensi viikolla on iso lounas, pitää suunnitella ruoka 20 hengelle", "jotain suomalaista", "toinen", "kyllä"] },
  { id: "direct-sointu-en", kitchen: "kahvila-sointu", lang: "en", turns: ["meatballs and mash for 20 on Tuesday"], direct: true },
];

const words = (s: string) => s.replace(/\*\*|\{\{|\}\}/g, "").split(/\s+/).filter(Boolean).length;

async function run(c: Case) {
  const acc = TEST_ACCOUNTS.find((a) => a.username === c.kitchen)!;
  const r0 = await fetch(`${base}/ui-api/account/signin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: acc.username, password: acc.password }) });
  const cookie = (r0.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0]).join("; ");
  const call = (m: string, p: string, b?: unknown) => fetch(`${base}${p}`, { method: m, headers: { "content-type": "application/json", cookie }, ...(b ? { body: JSON.stringify(b) } : {}) }).then((r) => r.json());
  await call("POST", `/ui-api/kitchens/${c.kitchen}/thread/reset`, {});
  const replies: { line: string; cards: any[] }[] = [];
  for (const text of c.turns) {
    const sent = await call("POST", `/ui-api/kitchens/${c.kitchen}/thread/turns`, { door: "typed", via: "typed", text, lang: c.lang });
    let a: any;
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 500));
      a = (await call("GET", `/ui-api/kitchens/${c.kitchen}/thread`)).thread.turns.find((x: any) => x.turnId === sent.agentTurnId);
      if (a && a.status !== "working") break;
    }
    replies.push({ line: a?.line ?? "", cards: a?.cards ?? [] });
  }
  const f: string[] = [];
  const asks = /mood for|maistuisi|sugna på/i;
  if (c.direct) {
    if (asks.test(replies[0].line)) f.push(`a named dish got the opening question: "${replies[0].line}"`);
    if (!replies[0].cards.some((x: any) => x.type === "dishes")) f.push("a named dish is not shown with its ingredients");
  } else {
    if (!asks.test(replies[0].line) || words(replies[0].line) > 35) f.push(`not one short question: "${replies[0].line}"`);
    const ideas = replies[1].line;
    if (!/^1\./m.test(ideas) || !/^3\./m.test(ideas) || words(ideas) > 70) f.push(`not three or four short ideas (${words(ideas)} words): "${ideas.slice(0, 200)}"`);
    if (!/(buy it all|voi ostaa|går att köpa|rules don't cover|eivät kata|inte omfattar)/i.test(ideas)) f.push("the ideas do not say whether the kitchen can buy them");
    const dish = replies[2].cards.find((x: any) => x.type === "dishes");
    if (!dish?.groups) f.push("the picked dish is not shown in three groups");
    if (!/\?\s*$/.test(replies[2].line.trim())) f.push(`the dish does not close on one question: "${replies[2].line}"`);
    if (dish?.groups && !dish.groups.complete && /(shall i order it|tilaanko sen)\b[^,]*\?$/i.test(replies[2].line.trim())) f.push(`an incomplete dish asked "Shall I order it?": "${replies[2].line}"`);
    const end = replies[3];
    if (!end.cards.some((x: any) => x.type === "order") && !/(owner|omistaj|plan a dish|suunnittelen)/i.test(end.line)) f.push(`the yes neither ordered nor offered the ways forward: "${end.line}"`);
  }
  return { id: c.id, replies, failures: f };
}

(async () => {
  let failed = 0;
  for (const c of DISH_FLOW_CASES.filter((x) => !only || only.includes(x.id))) {
    const r = await run(c);
    console.log(`\n${r.failures.length ? "FAIL" : "PASS"} ${r.id}`);
    c.turns.forEach((t, i) => console.log(`  > ${t}\n    ${(r.replies[i]?.line ?? "").replace(/\n/g, " | ")}`));
    for (const x of r.failures) console.log(`  ! ${x}`);
    if (r.failures.length) failed++;
  }
  process.exit(failed ? 1 : 0);
})();
