/* eslint-disable @typescript-eslint/no-explicit-any -- QA harness: probes read untyped JSON replies. */
/**
 * The interpreter corpus: model-written buyer requests (12 categories x English, Finnish, Swedish, mixed) with the
 * facts a correct reading must contain. Two probes:
 *
 *   corpus.interpret   (only with --corpus) sends every text to POST /api/v1/agent/interpret with the corpus's
 *                      fixed "now" and caches the readings in qa/corpus/interpretations.json (paid model calls)
 *   corpus.invariants  (always; free) checks the cached readings and replays each need through the intake on
 *                      the server, placing the order, with the intake invariants (amounts, money, commitment, mandate)
 *
 * Invariants on a reading: a non-request is refused as one; the amount and unit are the ones written (a slip is
 * kept, not corrected); the date is the one asked, in Helsinki, and none is invented; no claim or allergen the buyer
 * did not state is asserted; every allergen the buyer excluded is kept.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { kaariAgent } from "../lib/actors";
import { driveIntake } from "../lib/intake";
import type { Probe } from "../lib/probe";

const DIR = path.join(process.cwd(), "qa", "corpus");
const REQUESTS = path.join(DIR, "requests.json");
const READINGS = process.env.QA_READINGS ? path.resolve(process.env.QA_READINGS) : path.join(DIR, "interpretations.json");
const CLAIM_TAGS = new Set(["lactose_free", "organic", "gluten_free", "vegan", "vegetarian", "low_lactose", "fat_free", "fat_1_5", "fat_3_5", "free_from_lactose", "milk_free"]);

type Case = { id: string; category: string; lang: string; text: string; expect: { amount: number | null; unit: string | null; deliverBy: string | null; statedClaims: string[]; statedAllergens: string[]; isPurchase: boolean; note: string } };
type Reading = { status: number; need?: any; code?: string; message?: string; model?: string; ms?: number };

const load = <T>(f: string, d: T): T => (existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T) : d);
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").replace(/^free_from_/, "").replace(/^contains_no_/, "");
const allergenNorm = (t: string) => ({ tree_nuts: "nuts", peanuts: "peanut", nut: "nuts", wheat: "gluten", lactose: "milk", milk_protein: "milk", dairy: "milk", eggs: "egg" } as Record<string, string>)[norm(t)] ?? norm(t);
const claimNorm = (t: string) => ({ lactose: "lactose_free", free_from_lactose: "lactose_free", laktoositon: "lactose_free", gluten: "gluten_free", eco: "organic", luomu: "organic" } as Record<string, string>)[norm(t)] ?? norm(t);

export function checkReading(c: Case, r: Reading): string[] {
  const p: string[] = [];
  const e = c.expect;
  if (!e.isPurchase) {
    if (r.status === 200) p.push(`decline: "${c.text.slice(0, 70)}" became a need (${JSON.stringify(r.need?.item)} ${JSON.stringify(r.need?.quantity)})`);
    return p;
  }
  if (r.status >= 500) p.push(`server: ${r.status} ${r.code}`);
  if (r.status !== 200) return p; // need_incomplete etc.: the intake asks; judged by category below
  const n = r.need;
  if (c.category === "multi_need") p.push(`multi: one need kept (${n.item?.text}, ${n.quantity?.amount} ${n.quantity?.unit}); any other item in the message is dropped without a word`);
  if (e.amount !== null && n.quantity) {
    const same = Math.abs(n.quantity.amount - e.amount) < 1e-6;
    const unitOk = !e.unit || n.quantity.unit === e.unit || (["pack", "pcs"].includes(e.unit) && ["pack", "pcs"].includes(n.quantity.unit));
    if (!same || !unitOk) p.push(`amount: wrote ${e.amount} ${e.unit}, read ${n.quantity.amount} ${n.quantity.unit}`);
  }
  if (e.deliverBy && n.deliverBy !== e.deliverBy) p.push(`date: asked ${e.deliverBy}, read ${n.deliverBy ?? "none"}`);
  if (!e.deliverBy && n.deliverBy) p.push(`date: none asked, read ${n.deliverBy}`);
  const statedC = new Set(e.statedClaims.map(claimNorm));
  // What the words themselves state: a milk type names its fat (semi-skimmed = 1.5 %, whole = 3.5 %, skimmed = 0.1 %);
  // "gluten-free" is the claim and the forbidden allergen at once.
  const t = c.text.toLowerCase();
  if (/semi|kevyt|mellan|lätt|1[,.]5|1,5|1\.5/.test(t)) statedC.add("fat_1_5");
  if (/whole|täys|standard|3[,.]5|helmjölk/.test(t)) statedC.add("fat_3_5");
  if (/skim|rasvaton|fettfri|skumm|0[,.]1/.test(t)) statedC.add("fat_free");
  const readC = [...(n.requiredClaims ?? []), ...(n.item?.attributes ?? [])].map(claimNorm).filter((x) => CLAIM_TAGS.has(x) || x.endsWith("_free"));
  const extraC = readC.filter((x) => !statedC.has(x));
  if (extraC.length) p.push(`asserted: claims ${extraC.join(", ")} not stated`);
  const statedA = new Set(e.statedAllergens.map(allergenNorm));
  for (const x of statedC) if (x.endsWith("_free") && x !== "lactose_free" && x !== "fat_free") statedA.add(allergenNorm(x.replace(/_free$/, "")));
  const readA = (n.forbiddenAllergens ?? []).map(allergenNorm);
  const extraA = readA.filter((x: string) => !statedA.has(x) && !statedC.has(`${x}_free`));
  if (extraA.length) p.push(`asserted: allergens ${extraA.join(", ")} not stated`);
  const readFree = new Set(readC.filter((x) => x.endsWith("_free")).map((x) => allergenNorm(x.replace(/_free$/, ""))));
  const lostA = [...statedA].filter((x) => !readA.includes(x) && !readFree.has(x) && !(x === "milk" && readC.includes("lactose_free")));
  if (lostA.length) p.push(`lost: excluded allergen(s) ${lostA.join(", ")} dropped`);
  return p;
}

export const corpusProbes = (opts: { corpus: boolean }): Probe[] => [
  ...(opts.corpus
    ? [
        {
          id: "corpus.interpret",
          area: "interpreter",
          kind: "language",
          title: "Interpret every corpus text through POST /api/v1/agent/interpret (paid; refreshes the cache)",
          async run({ http, check }) {
            const corpus = load<{ now: string; cases: Case[] }>(REQUESTS, { now: "", cases: [] });
            if (!corpus.cases.length) return { skip: "no corpus: pnpm qa --regen-corpus" };
            const cache = load<Record<string, Reading>>(READINGS, {});
            let a = await kaariAgent(http, { weeklyBudgetCents: 1e9 });
            let n = 0;
            for (const c of corpus.cases) {
              const prev = cache[c.id];
              if (process.env.QA_ONLY_MISSING && prev && ![429, 503].includes(prev.status) && prev.code !== "demo_limit_reached") continue; // re-ask only what a limit cut off
              if (n % 25 === 24) a = await kaariAgent(http, { weeklyBudgetCents: 1e9 }); // the interpreter allows 30 calls an hour per agent
              const r = await a.post("/api/v1/agent/interpret", { text: c.text, now: corpus.now });
              cache[c.id] = { status: r.status, need: r.body?.need, code: r.body?.error?.code, message: r.body?.error?.message?.slice(0, 200), model: r.body?.model, ms: r.ms };
              if (r.status === 429 || r.status === 503) check.note(`${c.id}: ${r.status} ${r.body?.error?.code}`);
              n++;
            }
            writeFileSync(READINGS, JSON.stringify(cache, null, 1));
            return { cases: n };
          },
        } satisfies Probe,
      ]
    : []),
  {
    id: "corpus.invariants",
    area: "interpreter",
    kind: "language",
    title: "Corpus readings keep what the buyer wrote and add nothing; each need replayed through the intake keeps the order invariants",
    findings: ["F-INTERPRET-MULTI-NEED", "F-INTERPRET-ALLERGY-DROPPED"],
    async run({ http, check }) {
      const corpus = load<{ cases: Case[] }>(REQUESTS, { cases: [] });
      const cache = load<Record<string, Reading>>(READINGS, {});
      if (!corpus.cases.length || !Object.keys(cache).length) return { skip: "no cached readings: pnpm qa --corpus" };
      const byKind: Record<string, number> = {};
      let cases = 0;
      let replayed = 0;
      for (const c of corpus.cases) {
        const r = cache[c.id];
        if (!r) continue;
        cases++;
        for (const p of checkReading(c, r)) {
          const kind = p.split(":")[0];
          byKind[kind] = (byKind[kind] ?? 0) + 1;
          // Safety-relevant kinds fail the run; amount/date differences are listed for review (the generator can be wrong too).
          if (["decline", "asserted", "lost", "server", "multi"].includes(kind)) check.expect(false, `${c.id}: ${p} | "${c.text.slice(0, 90)}"`);
          else check.note(`${c.id}: ${p} | "${c.text.slice(0, 90)}"`);
        }
        if (r.status === 200 && r.need) {
          const a = await kaariAgent(http, { weeklyBudgetCents: 1e9 });
          const t = await driveIntake((m, p, b) => (m === "GET" ? a.get(p) : a.post(p, b)), r.need, { by: "corpus", onConcern: "confirm" });
          replayed++;
          for (const p of t.problems) check.expect(false, `${c.id} intake: ${p}`);
          if (t.steps.some((s) => s.status >= 500)) check.expect(false, `${c.id} intake: server error ${JSON.stringify(t.steps)}`);
        }
      }
      check.note(`readings checked ${cases}, needs replayed through the intake ${replayed}; differences by kind ${JSON.stringify(byKind)}`);
      return { cases: cases + replayed };
    },
  },
];
