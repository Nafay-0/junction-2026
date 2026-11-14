/* eslint-disable @typescript-eslint/no-explicit-any -- eval harness: reads untyped JSON replies. */
/**
 * "Nothing is left out, swapped, reduced or moved silently", as an evaluation rule over whole conversations:
 *
 *   pnpm tsx eval/thread/told-before.ts [--url http://localhost:4522] [--only meatballs-en,...]
 *
 * For every turn that places an order: (1) every ingredient of the plan it came from is on the order, already in the
 * kitchen, or was named in a reply BEFORE the yes; (2) every item of a request that is not on the order was named
 * before the yes; (3) the order's day is the day the question that was answered named. A failure quotes the replies.
 */
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";

const args = process.argv.slice(2);
const opt = (f: string, d?: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const base = opt("--url", "http://localhost:4522")!;
const only = opt("--only")?.split(",");

type Case = { id: string; kitchen: string; lang: "en" | "fi"; turns: string[] };
export const TOLD_BEFORE_CASES: Case[] = [
  { id: "meatballs-en", kitchen: "kahvila-sointu", lang: "en", turns: ["i Have a big lunch coming up next week need to plan a dish for 20 people", "Meatballs with mashed potatoes", "Yes looks good!", "order just those"] },
  { id: "meatballs-direct-en", kitchen: "kahvila-sointu", lang: "en", turns: ["meatballs and mash for 20 on Tuesday", "yes", "just those"] },
  { id: "lihapullat-fi", kitchen: "kahvila-sointu", lang: "fi", turns: ["lihapullat ja perunamuusi 20 hengelle tiistaiksi", "kyllä", "tilaa vain ne"] },
  { id: "cake-lumo-en", kitchen: "hotel-lumo", lang: "en", turns: ["chocolate cake", "10 portions", "yes", "yes"] },
  { id: "several-items-en", kitchen: "kahvila-sointu", lang: "en", turns: ["20 litres of milk, 5 kg of minced meat and 10 litres of cream for Tuesday", "yes"] },
  { id: "rounded-up-en", kitchen: "hotel-lumo", lang: "en", turns: ["25 litres of whipping cream for Tuesday", "yes"] },
];

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const head = (s: string) => fold(s).replace(/[^a-zäöå ]/g, " ").split(/\s+/).filter((w) => w.length >= 4)[0] ?? fold(s);

async function run(c: Case) {
  const acc = TEST_ACCOUNTS.find((a) => a.username === c.kitchen)!;
  const r0 = await fetch(`${base}/ui-api/account/signin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: acc.username, password: acc.password }) });
  const cookie = (r0.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0]).join("; ");
  const call = (m: string, p: string, b?: unknown) => fetch(`${base}${p}`, { method: m, headers: { "content-type": "application/json", cookie }, ...(b ? { body: JSON.stringify(b) } : {}) }).then((r) => r.json());
  await call("POST", `/ui-api/kitchens/${c.kitchen}/thread/reset`, {});
  const replies: { words: string; line: string; cards: any[] }[] = [];
  for (const text of c.turns) {
    const sent = await call("POST", `/ui-api/kitchens/${c.kitchen}/thread/turns`, { door: "typed", via: "typed", text, lang: c.lang });
    let a: any;
    for (let i = 0; i < 480; i++) {
      await new Promise((r) => setTimeout(r, 500));
      a = (await call("GET", `/ui-api/kitchens/${c.kitchen}/thread`)).thread.turns.find((x: any) => x.turnId === sent.agentTurnId);
      if (a && a.status !== "working") break;
    }
    replies.push({ words: text, line: a?.line ?? "", cards: a?.cards ?? [] });
    if (a?.cards?.some((x: any) => x.type === "order")) break;
  }
  const failures: string[] = [];
  const at = replies.findIndex((r) => r.cards.some((x: any) => x.type === "order"));
  if (at >= 0) {
    const order = replies[at].cards.find((x: any) => x.type === "order");
    const before = replies.slice(0, at);
    const saidBefore = fold(before.map((r) => r.line).join(" "));
    const onOrder = fold(order.lines.map((l: any) => l.name).join(" "));
    // (1) the plan's ingredients
    const dishes = before.flatMap((r) => r.cards.filter((x: any) => x.type === "dishes")).at(-1);
    for (const it of (dishes?.dishes ?? []).flatMap((d: any) => d.items)) {
      if (it.note?.code === "have") continue;
      const name = it.name[c.lang] ?? it.name.en;
      const bought = it.productId && order.lines.some((l: any) => l.productId === it.productId);
      if (!bought && !saidBefore.includes(head(name)) && !onOrder.includes(head(name))) failures.push(`ingredient "${name}" is not on the order and was not named before the yes`);
    }
    // (2) the request's items
    for (const u of before.flatMap((r) => r.cards.filter((x: any) => x.type === "understood"))) {
      const onIt = order.requestId === u.requestId || order.lines.some((l: any) => fold(l.name).includes(head(u.item)));
      if (!onIt && !saidBefore.includes(head(u.item))) failures.push(`item "${u.item}" is not on the order and was not named before the yes`);
    }
    // (3) the day
    const asked = before.at(-1)?.line.split(/(?<=[.!?])\s+/).filter((s) => /\?\s*$/.test(s)).at(-1) ?? "";
    const day = /\{\{([^}]+)\}\}/.exec(asked)?.[1];
    const d = new Date(`${order.deliveryDate}T12:00:00Z`);
    const want = day && (/(\d{1,2}) ([A-Z][a-z]{2})/.exec(day) ?? /(\d{1,2})\.(\d{1,2})\./.exec(day));
    if (want && (Number(want[1]) !== d.getUTCDate())) failures.push(`the question named ${day}, the order is for ${order.deliveryDate}`);
  }
  return { id: c.id, placed: at >= 0, failures, replies };
}

(async () => {
  let failed = 0;
  for (const c of TOLD_BEFORE_CASES.filter((x) => !only || only.includes(x.id))) {
    const r = await run(c);
    console.log(`\n${r.failures.length ? "FAIL" : "PASS"} ${r.id}${r.placed ? "" : " (no order placed)"}`);
    for (const x of r.replies) console.log(`  > ${x.words}\n    ${x.line}`);
    for (const f of r.failures) console.log(`  ! ${f}`);
    if (r.failures.length) failed++;
  }
  process.exit(failed ? 1 : 0);
})();
