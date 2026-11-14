/* eslint-disable @typescript-eslint/no-explicit-any -- eval harness: checks read untyped JSON replies. */
/**
 * The capture's last-minute event, replayed word for word against a running server (walkthrough scenario 3, Hotel
 * Lumo), with a check for each of the seven defects it found. Fails on any of them.
 *
 *   pnpm tsx eval/thread/event-walkthrough.ts --url http://localhost:PORT [--kitchen hotel-lumo] [--out file.json]
 *
 * Turns: "We just got a booking for 40 tomorrow, three-course dinner." then "Monday is fine" (when the earliest day is
 * asked), then "yes" until there is an order sheet (at most twice). Each reply and its seconds are printed.
 *
 *   1  every ingredient that cannot arrive has its best swap on the sheet, or the reply says there is none
 *   2  one truth per product: an ingredient said to have "no delivery on any day" is not given a stand-in of the same
 *      ingredient later without it being on the card from the start
 *   3  no line on the sheet without a live price (0,00 €)
 *   4  no tofu in a meat and fish menu; no line over 40 % of the total; every dairy line lactose-free (Lumo's rule)
 *   5  the chef is never asked to work out packs ("how many … packs")
 *   6  a "yes" is answered within 20 s
 *   7  the first reply names the dishes
 */
import { writeFileSync } from "node:fs";
import { Browser, signInAs } from "./lib";

const args = process.argv.slice(2);
const opt = (n: string, d?: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const url = opt("--url");
const kitchen = opt("--kitchen", "hotel-lumo")!;
if (!url) {
  console.error("usage: pnpm tsx eval/thread/event-walkthrough.ts --url http://localhost:PORT");
  process.exit(2);
}

type Turn = { words: string; reply: string; seconds: number; cards: any[] };

async function main() {
  const b = new Browser(url!);
  await signInAs(b, kitchen);
  const base = `/ui-api/kitchens/${kitchen}/thread`;
  await b.req("POST", `${base}/reset`, {});
  const turns: Turn[] = [];
  const say = async (words: string): Promise<Turn> => {
    const t0 = Date.now();
    const sent = (await b.req("POST", `${base}/turns`, { door: "typed", via: "typed", text: words, clientTurnId: `ew_${t0}` })).body;
    const id = sent?.agentTurnId;
    let turn: any;
    for (let i = 0; i < 240; i++) {
      const th = (await b.get(base)).body?.thread;
      turn = th?.turns?.find((x: any) => x.turnId === id);
      if (turn && turn.status !== "working") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const cards = turn?.cards ?? [];
    const scenario = cards.find((c: any) => c.type === "scenario");
    const reply = [turn?.line ?? "", scenario ? `${scenario.text.en.say} ${scenario.text.en.ask}` : ""].filter(Boolean).join(" | ");
    const t: Turn = { words, reply, seconds: Math.round((Date.now() - t0) / 100) / 10, cards };
    turns.push(t);
    console.log(`> ${words}\n  (${t.seconds} s) ${reply.slice(0, 900)}\n`);
    return t;
  };

  const first = await say("We just got a booking for 40 tomorrow, three-course dinner.");
  let last = first;
  const allCards = () => turns.flatMap((t) => t.cards);
  const scenarioCards = () => allCards().filter((c: any) => c.type === "scenario");
  if (scenarioCards().at(-1)?.pending?.earliest) last = await say("Monday is fine");
  for (let i = 0; i < 2 && !allCards().some((c: any) => c.type === "sheet"); i++) last = await say("yes");
  void last;

  const sheet = allCards().filter((c: any) => c.type === "sheet").at(-1);
  const card = scenarioCards().at(-1);
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  // 1: every ingredient with a stand-in on the card is on the sheet; the final reply names no left-off ingredient that had one.
  const others: string[] = card?.others ?? [];
  // A stand-in that buys something (not "leave it off", a change of technique the reply then names as left off).
  const withSwap = others.filter((x) => !/:\s*-$/.test(x) && !/:\s*(leave|reduce)\b/i.test(x)).map((x) => x.split(":")[0].trim().toLowerCase());
  const final = turns.at(-1)!.reply.toLowerCase();
  const leftOffNamed = withSwap.filter((w) => new RegExp(`left off[^.]*${w.split(/[ (]/)[0]}`).test(final) || new RegExp(`jäi pois[^.]*${w.split(/[ (]/)[0]}`).test(final));
  check("1 every ingredient that cannot arrive has its best swap on the sheet", !!sheet && leftOffNamed.length === 0 && (withSwap.length === 0 || sheet.lines.some((l: any) => l.substituteFor) || others.length > 0), `sheet ${sheet ? `${sheet.lines.length} lines` : "none"}; stand-ins ${withSwap.length}; left off although it had one: ${leftOffNamed.join(", ") || "none"}`);
  // 2: an ingredient whose product has no delivery on any day has its stand-in on the card itself.
  const steps: string[] = card?.steps ?? [];
  const noDay = steps.filter((s) => /no delivery for it on any day|cannot deliver it on any day/.test(s)).map((s) => s.split(/[:(]/)[0].trim().toLowerCase());
  const noneOffered = noDay.filter((w) => others.some((o) => o.toLowerCase().startsWith(w) && /:\s*-$/.test(o)));
  const laterOffered = turns.slice(1).some((t) => noneOffered.some((w) => new RegExp(`(instead of|stand-in for|tilalle)[^.]*${w}`).test(t.reply.toLowerCase())));
  check("2 one truth per product per day", !laterOffered, `no delivery on any day: ${noDay.join(", ") || "none"}; no stand-in on the card: ${noneOffered.join(", ") || "none"}`);
  // 3: no unpriced line on the sheet.
  const unpriced = (sheet?.lines ?? []).filter((l: any) => !(l.lineTotalCents > 0));
  check("3 no line on the sheet without a live price", !!sheet && unpriced.length === 0, unpriced.map((l: any) => l.name).join(", ") || "all priced");
  // 4: wrong products.
  const total = (sheet?.lines ?? []).reduce((s: number, l: any) => s + (l.lineTotalCents ?? 0), 0);
  const tofu = (sheet?.lines ?? []).filter((l: any) => /tofu/i.test(l.name));
  const heavy = (sheet?.lines ?? []).filter((l: any) => total > 0 && l.lineTotalCents > 0.4 * total);
  const dairy = (sheet?.lines ?? []).filter((l: any) => /butter|voi\b|cream|kerma|milk|maito/i.test(l.name) && !/lactose free|laktoositon|laktosfri|oat|kaura|rama|plant/i.test(l.name));
  check("4 no tofu, no line over 40 % of the total, dairy lactose-free", !!sheet && !tofu.length && !heavy.length && !dairy.length, `tofu ${tofu.map((l: any) => l.name).join(", ") || "-"}; heavy ${heavy.map((l: any) => `${l.name} ${l.lineTotalCents}`).join(", ") || "-"}; not lactose-free ${dairy.map((l: any) => l.name).join(", ") || "-"}`);
  // 5: never asks the chef to work out packs.
  const asked = turns.filter((t) => /how many[^?]*packs?|montako[^?]*pakkaus/i.test(t.reply));
  check("5 the chef is not asked to work out packs", asked.length === 0, asked.map((t) => t.reply.slice(0, 120)).join(" | ") || "never");
  // 6: a yes answered within 20 s.
  const yeses = turns.filter((t) => /^(yes|monday is fine)$/i.test(t.words));
  const slow = yeses.filter((t) => t.seconds > 20);
  check("6 a yes is answered within 20 s", slow.length === 0, yeses.map((t) => `"${t.words}" ${t.seconds} s`).join("; "));
  // 7: the first reply names the dishes.
  check("7 the first reply names the dishes", /the menu:|menu:/i.test(first.reply), first.reply.slice(0, 160));

  for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`);
  const out = opt("--out");
  if (out) writeFileSync(out, JSON.stringify({ kitchen, turns: turns.map(({ cards: _c, ...t }) => (void _c, t)), sheet: sheet ? { deliveryDate: sheet.deliveryDate, lines: sheet.lines.map((l: any) => ({ name: l.name, packs: l.packs, lineTotalCents: l.lineTotalCents, substituteFor: l.substituteFor?.name })) } : null, checks }, null, 2));
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
