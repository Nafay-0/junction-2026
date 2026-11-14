/* eslint-disable @typescript-eslint/no-explicit-any -- eval harness: checks read untyped JSON replies. */
/**
 * The set-up interview, evaluated over HTTP against a running server (docs/agent-thread.md "Set-up interview"):
 * a new account in English and one in Finnish answer the interview the way a buyer taps it, and each run records
 *   taps      what the buyer did after step 1: each chip tapped, each Next, typing the signer's name, the final sign
 *   seconds   from the first interview call to the signed mandate (the buyer script has no think time)
 *   checks    the signed mandate carries every answer; nothing the restaurant's name answers was asked; the answers
 *             are in the kitchen's memory; the ledger entry lists what was asked and skipped
 *
 *   pnpm tsx eval/thread/interview.ts --url http://localhost:3125 [--out eval/thread/results/interview.json]
 *
 * Plain code end to end: no model is called, so the run costs nothing and its timings are the server's own.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Browser } from "./lib";

const args = process.argv.slice(2);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const base = opt("--url") ?? "http://localhost:3125";

type Script = {
  id: string;
  lang: "en" | "fi";
  restaurant: string;
  /** What the buyer answers, by question; a question not listed takes the suggestion (one tap on Next). */
  answers: Record<string, unknown>;
  /** Taps a buyer makes to give that answer (chips tapped before Next; typing a name counts as one). */
  taps: Record<string, number>;
  /** The kind of kitchen the name says: it must not be asked. */
  knownKind?: string;
  expect: { limitEur: number; budgetEur?: number; require: string[]; forbid: string[]; signer: string };
};

const SCRIPTS: Script[] = [
  {
    id: "setup-en",
    lang: "en",
    restaurant: "Harbour Kitchen",
    answers: { kind: "restaurant", diet: [], allergens: ["nuts", "sesame"], usualEur: 300, limitEur: 450, signer: "Aino Virtanen" },
    taps: { kind: 1, diet: 1, allergens: 3, days: 1, usualEur: 2, limitEur: 1, budgetEur: 1, signer: 2 },
    expect: { limitEur: 450, require: [], forbid: ["nuts", "sesame"], signer: "Aino Virtanen" },
  },
  {
    id: "setup-fi",
    lang: "fi",
    restaurant: "Päiväkoti Satu",
    knownKind: "daycare_school",
    answers: { diet: ["lactose_free"], allergens: ["nuts", "peanuts", "fish"], days: [1, 3], usualEur: 400, limitEur: 600, signer: "Maija Laine" },
    taps: { diet: 2, allergens: 4, days: 3, usualEur: 1, limitEur: 1, budgetEur: 1, signer: 2 },
    expect: { limitEur: 600, require: ["lactose_free"], forbid: ["nuts", "peanuts", "fish"], signer: "Maija Laine" },
  },
];

async function run(s: Script) {
  const b = new Browser(base);
  const stamp = Date.now().toString(36).slice(-6);
  const username = `eval-${s.lang}-${stamp}`;
  const up = await b.post("/ui-api/account/signup", { restaurant: s.restaurant, username, password: `eval-password-${stamp}`, email: "delivered@resend.dev" });
  if (up.status !== 201) throw new Error(`signup ${up.status}: ${up.text.slice(0, 200)}`);
  const t0 = performance.now();
  const answers: Record<string, unknown> = {};
  const asked: string[] = [];
  let taps = 0;
  let step = (await b.post("/ui-api/account/interview", { answers })).body as any;
  for (let guard = 0; step?.question && guard < 20; guard++) {
    const q = step.question;
    asked.push(q.id);
    const v = q.id in s.answers ? s.answers[q.id] : q.input.kind === "weekdays" ? (q.suggested as string[]).map(Number) : q.suggested;
    answers[q.id] = v;
    taps += s.taps[q.id] ?? 1;
    step = (await b.post("/ui-api/account/interview", { answers })).body;
  }
  if (!step?.terms) throw new Error(`no terms to sign: ${JSON.stringify(step).slice(0, 300)}`);
  const signed = await b.post("/ui-api/account/interview", { answers, finish: true, ms: Math.round(performance.now() - t0) });
  taps += 1;
  const seconds = (performance.now() - t0) / 1000;
  const mandate = (await b.get("/ui-api/account/mandate")).body as any;
  const memory = (await b.get(`/ui-api/memory/kitchens/${username}`)).body as any;
  const t = mandate?.current;
  const checks: { name: string; ok: boolean; why?: string }[] = [];
  const check = (name: string, ok: boolean, why?: string) => checks.push({ name, ok, ...(ok ? {} : { why }) });
  check("signed (201) and the kitchen has a mandate", signed.status === 201 && !!signed.body?.mandateId && !!t, `${signed.status} ${signed.text.slice(0, 160)}`);
  check("spend-alone limit as answered", t?.perOrderLimitEur === s.expect.limitEur, String(t?.perOrderLimitEur));
  check("weekly budget at least the limit", (t?.weeklyBudgetEur ?? 0) >= s.expect.limitEur, String(t?.weeklyBudgetEur));
  check("required claims as answered", JSON.stringify(t?.require) === JSON.stringify(s.expect.require), JSON.stringify(t?.require));
  check("forbidden allergens as answered", JSON.stringify(t?.forbid) === JSON.stringify(s.expect.forbid), JSON.stringify(t?.forbid));
  check("signer as answered", t?.signer === s.expect.signer, t?.signer);
  if (s.knownKind) check("the kind the name says was not asked", !asked.includes("kind") && step.known?.kind?.value === s.knownKind, `asked ${asked.join(",")}; known ${JSON.stringify(step.known)}`);
  else check("the kind was asked (the name does not say it)", asked[0] === "kind", asked.join(","));
  const kinds = JSON.stringify(memory?.items?.map((i: any) => i.fact?.kind) ?? memory);
  check("answers in memory (allergens, delivery days, usual order)", /allergen/.test(kinds) && /delivery_days/.test(kinds) && /budget/.test(kinds), kinds.slice(0, 200));
  return { id: s.id, lang: s.lang, restaurant: s.restaurant, pass: checks.every((c) => c.ok), questions: asked.length, asked, taps, seconds: Math.round(seconds * 100) / 100, checks, calls: b.calls };
}

async function main() {
  const rows = [];
  for (const s of SCRIPTS) {
    try {
      rows.push(await run(s));
    } catch (err) {
      rows.push({ id: s.id, lang: s.lang, pass: false, error: (err as Error).message });
    }
  }
  for (const r of rows as any[]) {
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} (${r.lang}): ${r.error ?? `${r.questions} questions, ${r.taps} taps, ${r.seconds} s`}`);
    for (const c of r.checks ?? []) if (!c.ok) console.log(`   ✗ ${c.name}: ${c.why}`);
  }
  const out = opt("--out");
  if (out) {
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), base, rows }, null, 2));
  }
  process.exit((rows as any[]).every((r) => r.pass) ? 0 : 1);
}

void main();
