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

type Check = (replies: string[]) => string[];
type Case = { id: string; kitchen: string; turns: string[]; check: Check };
const unclear = /amount is unclear|did you mean \d|tarkoititko/i;
const noRepeat: Check = (r) => r.flatMap((x, i) => (i > 0 && x && x === r[i - 1] ? [`reply ${i + 1} repeats the one before: "${x.slice(0, 120)}"`] : []));
export const GUARD_LOOP_CASES: Case[] = [
  { id: "blue-cheese-sointu", kitchen: "kahvila-sointu", turns: ["Peltolan blue cheese 400 g, 5 packs for Tuesday", "yes, 5 packs of 400 g"], check: (r) => [...noRepeat(r), ...(unclear.test(r[0]) ? [`the pack and the count were named, yet: "${r[0].slice(0, 140)}"`] : []), ...(unclear.test(r[1] ?? "") ? [`asked again after the answer: "${r[1].slice(0, 140)}"`] : [])] },
  { id: "blue-cheese-lumo", kitchen: "hotel-lumo", turns: ["2 packs of the Peltolan blue cheese 400 g for Tuesday", "2 packs is right"], check: (r) => [...noRepeat(r), ...(unclear.test(r[0]) ? [`the pack and the count were named, yet: "${r[0].slice(0, 140)}"`] : []), ...(/another day/i.test(r[1] ?? "") && !/because|order time|cut-?off|stock|not sold/i.test(r[1] ?? "") ? [`"another day" without a reason: "${r[1]}"`] : [])] },
  { id: "event-reason", kitchen: "hotel-lumo", turns: ["4,000 litres of lactose-free milk for Tuesday", "it's for an event"], check: (r) => [...noRepeat(r), ...(/[.!?]["”]?$/.test((r[1] ?? "").replace(/\*\*|\{\{|\}\}/g, "").trim()) ? [] : [`not a whole sentence: "${r[1]}"`])] },
  { id: "litres-not-questioned", kitchen: "hotel-lumo", turns: ["20 litres of lactose-free milk for Tuesday"], check: (r) => (/wrong unit|did you mean \d+ packs/i.test(r[0]) ? [`litres questioned as a unit: "${r[0].slice(0, 140)}"`] : []) },
  { id: "which-order", kitchen: "hotel-lumo", turns: ["20 litres of lactose-free milk for Tuesday", "the first one", "20 litres of lactose-free milk for Tuesday", "which order?"], check: (r) => [...noRepeat(r), ...(/\d/.test(r[3] ?? "") && /(mon|tue|wed|thu|fri|sat|sun|\d{1,2} [A-Z][a-z]{2}|\d\.\d)/i.test(r[3] ?? "") ? [] : [`"which order?" not answered with the order: "${r[3]}"`])] },
];

async function run(c: Case) {
  const acc = TEST_ACCOUNTS.find((a) => a.username === c.kitchen)!;
  const r0 = await fetch(`${base}/ui-api/account/signin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: acc.username, password: acc.password }) });
  const cookie = (r0.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0]).join("; ");
  const call = (m: string, p: string, b?: unknown) => fetch(`${base}${p}`, { method: m, headers: { "content-type": "application/json", cookie }, ...(b ? { body: JSON.stringify(b) } : {}) }).then((r) => r.json());
  await call("POST", `/ui-api/kitchens/${c.kitchen}/thread/reset`, {});
  const replies: string[] = [];
  for (const text of c.turns) {
    const sent = await call("POST", `/ui-api/kitchens/${c.kitchen}/thread/turns`, { door: "typed", via: "typed", text, lang: "en" });
    let a: any;
    for (let i = 0; i < 480; i++) {
      await new Promise((r) => setTimeout(r, 500));
      a = (await call("GET", `/ui-api/kitchens/${c.kitchen}/thread`)).thread.turns.find((x: any) => x.turnId === sent.agentTurnId);
      if (a && a.status !== "working") break;
    }
    replies.push(a?.line ?? "");
  }
  return { id: c.id, replies, failures: c.check(replies) };
}

(async () => {
  let failed = 0;
  for (const c of GUARD_LOOP_CASES.filter((x) => !only || only.includes(x.id))) {
    const r = await run(c);
    console.log(`\n${r.failures.length ? "FAIL" : "PASS"} ${r.id}`);
    c.turns.forEach((t, i) => console.log(`  > ${t}\n    ${r.replies[i]}`));
    for (const f of r.failures) console.log(`  ! ${f}`);
    if (r.failures.length) failed++;
  }
  process.exit(failed ? 1 : 0);
})();
