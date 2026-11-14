/* eslint-disable @typescript-eslint/no-explicit-any -- eval harness: checks read untyped JSON replies. */
/**
 * The planner's acceptance cases from the captures, replayed word for word against a running server, each failing on
 * what went wrong there:
 *
 *   incomplete-dish-sointu   the café's meatballs: no order while a defining ingredient is not covered, and no total
 *                            said without the count of ingredients it covers
 *   event-pork-lumo          the booking: beef cheek replaced by "braised pork shoulder instead", an order reached
 *   school-strips-metsola    fish fingers refused, "the first one" chosen: one plan and one order with the mash
 *   cake-lactose-lumo        "make it lactose-free", then ordered; nothing refused without its product named
 *   seasonal-lumo            the beetroot lunch ordered; nothing missing silently, every finding named
 *
 *   pnpm tsx eval/thread/planner-cases.ts --url http://localhost:PORT [--only id,id] [--out file.json]
 */
import { writeFileSync } from "node:fs";
import { Browser, signInAs } from "./lib";

const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const url = opt("--url");
if (!url) {
  console.error("usage: pnpm tsx eval/thread/planner-cases.ts --url http://localhost:PORT");
  process.exit(2);
}

type Turn = { words: string; reply: string; seconds: number; cards: any[] };
type Case = { id: string; kitchen: string; turns: (prev: Turn[]) => string | undefined; checks: (t: Turn[]) => { name: string; ok: boolean; detail: string }[] };

const orders = (t: Turn[]) => t.flatMap((x) => x.cards).filter((c: any) => c.type === "order" || (c.type === "gate" && /placed_alone|waiting|approved/.test(c.state ?? c.outcome ?? "")));
const ordered = (t: Turn[]) => orders(t).length > 0;
const UNNAMED = /\b(one of (the|its) (products|lines|ingredients)|can'?t name|cannot name|didn'?t connect|which ingredient)\b/i;
const unnamed = (t: Turn[]) => t.filter((x) => UNNAMED.test(x.reply));
const text = (t: Turn[]) => t.map((x) => x.reply).join(" \n ");

const CASES: Case[] = [
  {
    id: "incomplete-dish-sointu",
    kitchen: "kahvila-sointu",
    turns: (p) => ["i Have a big lunch coming up next week need to plan a dish for 20 people", "Meatballs with mashed potatoes", "Yes looks good!"][p.length],
    checks: (t) => {
      const totals = t.filter((x) => /\d[\d\s]*,\d\d\s*€/.test(x.reply));
      const bare = totals.filter((x) => !/\b\d+\s*(of|\/|av)\s*(the\s+|its\s+)?\d+\b/i.test(x.reply) && !/raaka-ainetta|ingredients/i.test(x.reply));
      return [
        { name: "no order while a defining ingredient is not covered", ok: !ordered(t), detail: ordered(t) ? "an order was placed" : "no order" },
        { name: "no total said without the count of ingredients it covers", ok: bare.length === 0, detail: bare.map((x) => x.reply.slice(0, 160)).join(" | ") || "every total with its count" },
      ];
    },
  },
  {
    id: "event-pork-lumo",
    kitchen: "hotel-lumo",
    turns: (p) => {
      const last = p.at(-1)?.reply ?? "";
      if (!p.length) return "We just got a booking for 40 tomorrow, three-course dinner.";
      if (/instead\?|Mon 16 Nov.*\?/i.test(last) && p.length === 1) return "Monday is fine";
      if (/beef cheek/i.test(last) && /nothing in the range|another dish/i.test(last) && !p.some((x) => /pork shoulder/.test(x.words))) return "braised pork shoulder instead";
      return p.length < 7 && !ordered(p) ? "yes" : undefined;
    },
    checks: (t) => [
      { name: "an order is reached", ok: ordered(t), detail: ordered(t) ? "ordered" : "no order" },
      { name: "the pork shoulder reaches the order", ok: !t.some((x) => /pork shoulder/.test(x.words)) || /pork|porsa|possu/i.test(JSON.stringify(t.flatMap((x) => x.cards).filter((c: any) => c.type === "sheet" || c.type === "order"))), detail: "" },
      { name: "nothing asked about without being named", ok: unnamed(t).length === 0, detail: unnamed(t).map((x) => x.reply.slice(0, 160)).join(" | ") || "-" },
    ],
  },
  {
    id: "school-strips-metsola",
    kitchen: "koulu-metsola",
    turns: (p) => (p.length === 0 ? "kalapuikot ja perunamuusi 120 oppilaalle perjantaiksi" : p.length === 1 ? "the first one" : p.length < 5 && !ordered(p) ? "yes" : undefined),
    checks: (t) => [
      { name: "an order is reached", ok: ordered(t), detail: ordered(t) ? "ordered" : "no order" },
      { name: "a main and its side are one order", ok: !/can'?t put (the )?two menus|kahta menua/i.test(text(t)), detail: "" },
      { name: "nothing unnamed", ok: unnamed(t).length === 0, detail: unnamed(t).map((x) => x.reply.slice(0, 160)).join(" | ") || "-" },
    ],
  },
  {
    id: "cake-lactose-lumo",
    kitchen: "hotel-lumo",
    turns: (p) => ["chocolate cake", "10 portions", "make it lactose-free", "yes", "yes"][p.length] && (p.length < 3 || !ordered(p)) ? ["chocolate cake", "10 portions", "make it lactose-free", "yes", "yes"][p.length] : undefined,
    checks: (t) => [
      { name: "an order is reached", ok: ordered(t), detail: ordered(t) ? "ordered" : "no order" },
      { name: "nothing refused without its product named", ok: unnamed(t).length === 0, detail: unnamed(t).map((x) => x.reply.slice(0, 160)).join(" | ") || "-" },
    ],
  },
  {
    id: "seasonal-lumo",
    kitchen: "hotel-lumo",
    turns: (p) => (p.length === 0 ? "plan a lunch for 30 around beetroot for thursday" : p.length === 1 ? "the first one" : p.length < 5 && !ordered(p) ? "yes order it" : undefined),
    checks: (t) => [
      { name: "an order is reached", ok: ordered(t), detail: ordered(t) ? "ordered" : "no order" },
      { name: "every finding names its line", ok: unnamed(t).length === 0, detail: unnamed(t).map((x) => x.reply.slice(0, 160)).join(" | ") || "-" },
    ],
  },
];

async function run(c: Case) {
  const b = new Browser(url!);
  await signInAs(b, c.kitchen);
  const base = `/ui-api/kitchens/${c.kitchen}/thread`;
  await b.req("POST", `${base}/reset`, {});
  const turns: Turn[] = [];
  for (let words = c.turns(turns); words !== undefined; words = c.turns(turns)) {
    const t0 = Date.now();
    const sent = (await b.req("POST", `${base}/turns`, { door: "typed", via: "typed", text: words, clientTurnId: `pc_${t0}` })).body;
    let turn: any;
    for (let i = 0; i < 400; i++) {
      turn = (await b.get(base)).body?.thread?.turns?.find((x: any) => x.turnId === sent?.agentTurnId);
      if (turn && turn.status !== "working") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const cards = turn?.cards ?? [];
    const sc = cards.find((x: any) => x.type === "scenario");
    const reply = [turn?.line ?? "", sc ? `${sc.text.en.say} ${sc.text.en.ask}` : ""].filter(Boolean).join(" | ");
    turns.push({ words, reply, seconds: Math.round((Date.now() - t0) / 100) / 10, cards });
    console.log(`  > ${words}\n    (${turns.at(-1)!.seconds} s) ${reply.slice(0, 700)}`);
    if (turns.length > 8) break;
  }
  const checks = c.checks(turns);
  for (const x of checks) console.log(`  ${x.ok ? "ok  " : "FAIL"} ${x.name}${x.detail ? `: ${x.detail}` : ""}`);
  return { id: c.id, kitchen: c.kitchen, turns: turns.map(({ cards: _c, ...t }) => (void _c, t)), checks, pass: checks.every((x) => x.ok) };
}

async function main() {
  const only = opt("--only")?.split(",");
  const out = [];
  for (const c of CASES.filter((x) => !only || only.includes(x.id))) {
    console.log(`\n== ${c.id} (${c.kitchen})`);
    out.push(await run(c));
  }
  console.log(`\n${out.filter((x) => x.pass).length}/${out.length} passed`);
  if (opt("--out")) writeFileSync(opt("--out")!, JSON.stringify(out, null, 2));
  process.exit(out.every((x) => x.pass) ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
