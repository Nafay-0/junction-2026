/**
 * The second reader's evaluation: does an independent Nemotron reading catch the first reader's mistakes without
 * costing the buyer needless questions?
 *
 *   pnpm eval:second-reader                       read what is not recorded yet, then score (default models below)
 *   pnpm eval:second-reader --offline             score the recorded readings only: no model call, no spend
 *   pnpm eval:second-reader --second featherless:nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16,featherless:...#think
 *   pnpm eval:second-reader --runs 2              read each second model this many times (variance)
 *
 * Set: web/eval/second-reader/set.json (77 requests, English, Finnish and Swedish, each with the reading that is
 * right on the fields the comparison reads; many chosen to be easy to misread). Readings are recorded in
 * readings.json (the model's need, its time, or its failure), so the numbers can be recomputed for free; the
 * results are written to results.json and summarised in web/docs/second-reader.md.
 *
 * What is measured, per second model:
 *   alone        how often its reading is right on every field (and per field)
 *   false alarm  the first reading is right, and the comparison still finds a material difference: a needless question
 *   natural      the first reading is wrong, and the comparison flags the wrong field
 *   injected     known wrong first readings (x10 the amount, a dropped claim, a negated claim, a dropped allergen,
 *                another kind of product, another day, ...) compared with the second reading: caught on that field?
 *   latency      the second reader's own time, and how much later than the first reading it would arrive
 *   unavailable  failures, plus answers later than the production deadline
 * The comparison's rules are swept (amount factor, one-sided claims and dates, kind) to choose what is material.
 *
 * `#think` after a model id leaves Nemotron's thinking on; without it the second reader runs as in production,
 * thinking off. A suffix of `@<n>` in the readings file is run n.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fold } from "@/core/catalog/search";
import { localNow } from "@/core/kitchen";
import { compareReadings, readingFacts, READING_RULES, type ReadField, type Reading, type ReadingRules } from "@/core/second-reading";
import { interpretNeed, vocabularyFrom } from "@/server/agent/interpret";
import { readingOf, readSecondTime, SECOND_READER_DEADLINE_MS, NEMOTRON_NO_THINKING, secondFor, toReadings, unavailableReason, type SecondRead } from "@/server/agent/second-reader";
import { DockError } from "@/core/errors";
import { buildCatalog } from "@/server/runtime";
import { demoMandate } from "@/server/dev-fixtures";
import { dailyUsage } from "@/server/limits";
import { flag, loadLocalEnv } from "../lib/agent-cli";

const DIR = join(process.cwd(), "eval", "second-reader");
const FIRST = "anthropic:claude-opus-5-5";
const DEFAULT_SECOND = ["featherless:nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16"];

type Pair = [number, string];
type Expect = { amount: Pair[] | null; kind: string[]; date: string | string[] | null; claims: string[]; excluded: string[][]; avoid: string[]; fat: string[] };
type Case = { id: string; lang: string; text: string; tags: string[]; expect: Expect };
type Recorded = { ok: true; need?: unknown; raw?: SecondRead; ms: number; incomplete?: boolean; costUsd: number | null } | { ok: false; reason: string; detail: string; ms: number };
type Readings = Record<string, Record<string, Recorded>>; // model(@run) -> case id -> reading

const FIELDS: ReadField[] = ["amount", "claims", "allergens", "kind", "date"];

// ---------- scoring a reading against the truth ----------

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const unitOf = (u: string) => (u === "pcs" ? "pack" : u);

export function fieldsWrong(r: Reading | undefined, e: Expect): ReadField[] {
  if (!r) return [...FIELDS];
  const wrong: ReadField[] = [];
  const q = r.quantity;
  const amountOk = e.amount === null ? !q : !!q && e.amount.some(([a, u]) => Math.abs(a - q.amount) < 1e-6 && unitOf(u) === unitOf(q.unit));
  if (!amountOk) wrong.push("amount");
  const f = readingFacts(r);
  // Fat content is not one of the compared fields (not a dietary or allergen claim), so it is not scored either.
  if (!same(f.wanted, [...e.claims].sort()) || !e.excluded.some((x) => same(f.excluded, [...x].sort()))) wrong.push("claims");
  if (!same(f.avoid, [...e.avoid].sort())) wrong.push("allergens");
  const text = fold(r.item.text);
  if (!text || !e.kind.some((k) => text.includes(k))) wrong.push("kind");
  const d = r.deliverOn ?? r.deliverBy ?? null;
  const dateOk = e.date === null ? d === null : Array.isArray(e.date) ? !!d && e.date.includes(d) : d === e.date;
  if (!dateOk) wrong.push("date");
  return wrong;
}

// ---------- known wrong first readings ----------

type Injection = { name: string; field: ReadField; apply: (r: Reading) => Reading | undefined };
const clone = (r: Reading): Reading => structuredClone(r);
const OTHER_KIND: Record<string, string> = { en: "whipping cream", fi: "kermaa", sv: "grädde" };
const INJECTIONS: (lang: string) => Injection[] = (lang) => [
  { name: "amount x10", field: "amount", apply: (r) => (r.quantity ? { ...clone(r), quantity: { ...r.quantity, amount: r.quantity.amount * 10 } } : undefined) },
  { name: "amount /10", field: "amount", apply: (r) => (r.quantity && r.quantity.amount >= 10 ? { ...clone(r), quantity: { ...r.quantity, amount: r.quantity.amount / 10 } } : undefined) },
  { name: "1.000 read as 1", field: "amount", apply: (r) => (r.quantity && r.quantity.amount >= 1000 ? { ...clone(r), quantity: { ...r.quantity, amount: r.quantity.amount / 1000 } } : undefined) },
  { name: "litres read as packs", field: "amount", apply: (r) => (r.quantity && r.quantity.unit === "L" ? { ...clone(r), quantity: { ...r.quantity, unit: "pack" } } : undefined) },
  {
    name: "claim dropped",
    field: "claims",
    apply: (r) => {
      const f = readingFacts(r);
      if (!f.wanted.length) return undefined;
      const x = clone(r);
      const drop = (xs: string[]) => xs.filter((t) => !f.wanted.some((w) => fold(t).replace(/[^a-z]/g, "").includes(w.replace(/_/g, ""))) && !/laktoos|laktos|lactose|luomu|organic|ekolog|vegan|vegaan/.test(fold(t)));
      x.item.attributes = drop(x.item.attributes);
      x.requiredClaims = drop(x.requiredClaims);
      return readingFacts(x).wanted.length < f.wanted.length ? x : undefined;
    },
  },
  { name: "lactose-free added", field: "claims", apply: (r) => (readingFacts(r).wanted.includes("lactose_free") || readingFacts(r).excluded.includes("lactose_free") ? undefined : { ...clone(r), item: { ...r.item, attributes: [...r.item.attributes, "lactose_free"] } }) },
  {
    name: "claim negated",
    field: "claims",
    apply: (r) => {
      const f = readingFacts(r);
      if (f.excluded.length) {
        const t = f.excluded[0];
        return { ...clone(r), item: { ...r.item, excludedAttributes: r.item.excludedAttributes.filter((x) => !fold(x).includes(t.split("_")[0].slice(0, 5))), attributes: [...r.item.attributes, t] } };
      }
      if (f.wanted.includes("lactose_free")) return { ...clone(r), item: { ...r.item, attributes: r.item.attributes.filter((x) => !/lact|lakto/.test(fold(x))), excludedAttributes: [...r.item.excludedAttributes, "lactose_free"] }, requiredClaims: r.requiredClaims.filter((x) => !/lact|lakto/.test(fold(x))) };
      return undefined;
    },
  },
  {
    name: "allergen dropped",
    field: "allergens",
    apply: (r) => {
      const f = readingFacts(r);
      if (!f.avoid.length) return undefined;
      const x = clone(r);
      x.forbiddenAllergens = [];
      x.requiredClaims = x.requiredClaims.filter((t) => !/free|ton$|fri$/.test(fold(t)) || /lact|lakto/.test(fold(t)));
      x.item.attributes = x.item.attributes.filter((t) => !/gluten|egg|soy|nut/.test(fold(t)));
      return readingFacts(x).avoid.length < f.avoid.length ? x : undefined;
    },
  },
  { name: "nuts added", field: "allergens", apply: (r) => (readingFacts(r).avoid.includes("nuts") ? undefined : { ...clone(r), forbiddenAllergens: [...r.forbiddenAllergens, "nuts"] }) },
  { name: "another kind of product", field: "kind", apply: (r) => (/kerm|cream|gradd/.test(fold(r.item.text)) ? { ...clone(r), item: { ...r.item, text: lang === "fi" ? "maitoa" : lang === "sv" ? "mjölk" : "milk" } } : { ...clone(r), item: { ...r.item, text: OTHER_KIND[lang] ?? OTHER_KIND.en } }) },
  { name: "a week later", field: "date", apply: (r) => (r.deliverBy ? { ...clone(r), deliverBy: shift(r.deliverBy, 7), deliverOn: r.deliverOn ? shift(r.deliverOn, 7) : undefined } : undefined) },
  { name: "the day before", field: "date", apply: (r) => (r.deliverBy ? { ...clone(r), deliverBy: shift(r.deliverBy, -1), deliverOn: r.deliverOn ? shift(r.deliverOn, -1) : undefined } : undefined) },
  { name: "date dropped", field: "date", apply: (r) => (r.deliverBy ? { ...clone(r), deliverBy: undefined, deliverOn: undefined } : undefined) },
];
/** Injections that add what nobody said: left to the grounding check by design (READING_RULES.onlyWhatTheWordsSay). */
const INVENTED = new Set(["lactose-free added", "nuts added"]);

function shift(d: string, days: number): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

// ---------- reading ----------

/**
 * One reading. A second model is read the production way (the transcription, readSecondTime) unless its key carries
 * `~interpret`: then it fills the interpreter's own schema with the interpreter's prompt, as the first design did.
 */
async function readOnce(spec: string, text: string, now: Date, vocabulary: ReturnType<typeof vocabularyFrom>, timeoutMs: number): Promise<Recorded> {
  if (spec !== FIRST && !spec.includes("~interpret")) {
    const o = await readSecondTime({ text, now }, spec, timeoutMs);
    return o.ok ? { ok: true, raw: o.raw, ms: o.ms, costUsd: o.costUsd } : { ok: false, reason: o.reason, detail: o.detail, ms: o.ms };
  }
  const think = spec.endsWith("#think");
  const model = spec.replace(/#think$/, "").replace(/~interpret/, "");
  const extraBody = /nemotron-3/i.test(model) && !think ? NEMOTRON_NO_THINKING : undefined;
  const t0 = Date.now();
  try {
    const r = await interpretNeed({ text, now, vocabulary, model, timeoutMs, ...(extraBody ? { modelOptions: { extraBody } } : {}) });
    return { ok: true, need: r.need, ms: Date.now() - t0, costUsd: r.costUsd };
  } catch (err) {
    if (err instanceof DockError && err.code === "need_incomplete") return { ok: true, need: (err.details as { partial?: unknown })?.partial, ms: Date.now() - t0, incomplete: true, costUsd: null };
    const u = unavailableReason(err);
    return { ok: false, reason: u.reason, detail: u.detail, ms: Date.now() - t0 };
  }
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

// ---------- scoring ----------

const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

/** The second reading to compare, as production picks it (secondFor), and the rules it is compared with. */
function asSecond(rec: Recorded, first: unknown, text: string, now: Date): { reading?: Reading; rules: Partial<ReadingRules> } {
  if (!rec.ok) return { rules: {} };
  if (!rec.raw) return { reading: readingOf(rec.need), rules: {} };
  // Readings of earlier designs kept one item flat, and (~transcribe-v1, -v2) the day in one "delivery" object.
  const raw0 = rec.raw as unknown as Record<string, unknown> & { delivery?: { kind: string; weekday: string | null; day: number | null; month: number | null } };
  const old = raw0.delivery;
  const raw = {
    ...raw0,
    ...(old
      ? {
          deliveryDate: old.kind === "date" && old.day ? { day: old.day, month: old.month } : null,
          deliveryWeekday: old.kind === "weekday" ? old.weekday : null,
          deliveryRelative: ["today", "tomorrow", "day_after_tomorrow"].includes(old.kind) ? old.kind : null,
        }
      : {}),
    items: Array.isArray(raw0.items) ? raw0.items : [{ item: raw0.item, amount: raw0.amount, unit: raw0.unit, packSize: raw0.packSize, wanted: raw0.wanted, notWanted: raw0.notWanted, avoid: raw0.avoid }],
  } as unknown as SecondRead;
  const readings = toReadings(raw, now);
  if (!first) return { reading: readings[0], rules: {} };
  const pick = secondFor(first, readings, text);
  return { reading: pick.reading, rules: pick.rules };
}

function score(set: Case[], readings: Readings, second: string, rules: ReadingRules, deadlineMs: number, now: Date) {
  const firsts = readings[FIRST] ?? {};
  const seconds = readings[second] ?? {};
  const today = localNow(now).date;
  let alone = 0;
  let available = 0;
  const aloneByField: Record<string, number> = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  let firstRight = 0;
  let falseAlarms = 0;
  const falseAlarmByField: Record<string, number> = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  const falseAlarmCases: { id: string; field: string; first: string; second: string }[] = [];
  let naturalWrong = 0;
  let naturalCaught = 0;
  const naturalCases: { id: string; wrong: ReadField[]; caught: ReadField[] }[] = [];
  let injected = 0;
  let injectedCaught = 0;
  let injectedWithSecond = 0;
  const byInjection: Record<string, { n: number; caught: number }> = {};
  const ms: number[] = [];
  const waited: number[] = [];
  const failures: Record<string, number> = {};
  let late = 0;
  const firstIncomplete: string[] = [];
  for (const c of set) {
    const f = firsts[c.id];
    const s = seconds[c.id];
    const fr = f?.ok ? readingOf(f.need) : undefined;
    const picked = s?.ok ? asSecond(s, f?.ok ? f.need : undefined, c.text, now) : { rules: {} };
    let sr = picked.reading;
    const rulesHere = { ...rules, ...picked.rules };
    if (s) {
      ms.push(s.ms);
      if (f) waited.push(Math.max(0, Math.min(s.ms, deadlineMs) - f.ms));
      if (!s.ok) failures[s.reason] = (failures[s.reason] ?? 0) + 1;
      else if (s.ms > deadlineMs) {
        late++;
        sr = undefined; // production would have cut it off
      }
    }
    if (sr) available++;
    const sWrong = fieldsWrong(sr, c.expect);
    if (s?.ok && !sWrong.length) alone++;
    for (const fld of FIELDS) if (s?.ok && !sWrong.includes(fld)) aloneByField[fld]++;
    if (!fr) continue;
    // The first reader found the request incomplete: the buyer is asked for what is missing, and nothing is compared.
    if (f?.ok && f.incomplete) {
      firstIncomplete.push(c.id);
      continue;
    }
    const fWrong = fieldsWrong(fr, c.expect);
    const cmp = sr ? compareReadings(fr, sr, { text: c.text, today, rules: rulesHere }) : undefined;
    if (!fWrong.length) {
      firstRight++;
      if (cmp && !cmp.agreed) {
        falseAlarms++;
        for (const d of cmp.differences) {
          falseAlarmByField[d.field]++;
          falseAlarmCases.push({ id: c.id, field: d.field, first: d.first, second: d.second });
        }
      }
    } else {
      naturalWrong++;
      const caught = (cmp?.differences ?? []).map((d) => d.field).filter((x) => fWrong.includes(x));
      if (caught.length) naturalCaught++;
      naturalCases.push({ id: c.id, wrong: fWrong, caught });
    }
    // Known wrong first readings, made from a right one, so exactly one field is wrong.
    if (!fWrong.length) {
      for (const inj of INJECTIONS(c.lang)) {
        const bad = inj.apply(fr);
        if (!bad || !fieldsWrong(bad, c.expect).includes(inj.field)) continue;
        injected++;
        const b = (byInjection[inj.name] ??= { n: 0, caught: 0 });
        b.n++;
        if (!sr) continue;
        injectedWithSecond++;
        const got = compareReadings(bad, sr, { text: c.text, today, rules: rulesHere }).differences.some((d) => d.field === inj.field);
        if (got) {
          injectedCaught++;
          b.caught++;
        }
      }
    }
  }
  const n = set.length;
  return {
    second,
    cases: n,
    alone: { right: alone, of: n, pct: pct(alone, n), byField: Object.fromEntries(FIELDS.map((f) => [f, pct(aloneByField[f], n)])) },
    unavailable: { failed: failures, lateBeyondDeadline: late, total: n - available, pct: pct(n - available, n) },
    firstIncomplete,
    falseAlarm: { firstRight, alarms: falseAlarms, pct: pct(falseAlarms, firstRight), byField: falseAlarmByField, cases: falseAlarmCases },
    natural: { firstWrong: naturalWrong, caught: naturalCaught, cases: naturalCases },
    injected: {
      n: injected,
      withSecond: injectedWithSecond,
      caught: injectedCaught,
      pctOfAll: pct(injectedCaught, injected),
      pctWhenAvailable: pct(injectedCaught, injectedWithSecond),
      // An invented claim or allergen is not the second reader's to catch (the grounding check removes what nobody said).
      misreadings: (() => {
        const kinds = Object.entries(byInjection).filter(([k]) => !INVENTED.has(k));
        const n = kinds.reduce((s, [, v]) => s + v.n, 0);
        const caught = kinds.reduce((s, [, v]) => s + v.caught, 0);
        return { n, caught, pct: pct(caught, n) };
      })(),
      byKind: byInjection,
    },
    latencyMs: { p50: quantile(ms, 0.5), p90: quantile(ms, 0.9), max: ms.length ? Math.max(...ms) : null, waitedP50: quantile(waited, 0.5), waitedP90: quantile(waited, 0.9), waitedMax: waited.length ? Math.max(...waited) : null },
  };
}

function firstSummary(set: Case[], readings: Readings) {
  const firsts = readings[FIRST] ?? {};
  const wrong = set.map((c) => ({ id: c.id, wrong: fieldsWrong(firsts[c.id]?.ok ? readingOf((firsts[c.id] as { need: unknown }).need) : undefined, c.expect) })).filter((x) => x.wrong.length);
  const ms = set.map((c) => firsts[c.id]?.ms).filter((x): x is number => typeof x === "number");
  const cost = set.reduce((s, c) => s + ((firsts[c.id] as { costUsd?: number | null })?.costUsd ?? 0), 0);
  return { model: FIRST, right: set.length - wrong.length, of: set.length, pct: pct(set.length - wrong.length, set.length), wrong, latencyMs: { p50: quantile(ms, 0.5), p90: quantile(ms, 0.9) }, costUsd: Math.round(cost * 1000) / 1000 };
}

const SWEEP: { name: string; rules: Partial<ReadingRules> }[] = [
  { name: "production", rules: {} },
  { name: "amount factor 1.25", rules: { amountFactor: 1.25 } },
  { name: "amount factor 1.5", rules: { amountFactor: 1.5 } },
  { name: "amount factor 5", rules: { amountFactor: 5 } },
  { name: "ask when only the first has a date", rules: { askWhenOnlyFirstHasDate: true } },
  { name: "no question when only the second has a date", rules: { askWhenOnlySecondHasDate: false } },
  { name: "ask when only the first has a claim", rules: { askWhenOnlyFirstHasClaim: true } },
  { name: "no question when only the second has a claim", rules: { askWhenOnlySecondHasClaim: false } },
  { name: "kind not compared", rules: { compareKind: false } },
  { name: "fat content compared", rules: { compareFat: true } },
  { name: "every difference, not only what the words say", rules: { onlyWhatTheWordsSay: false } },
  { name: "ask when one excludes a claim and the other is silent", rules: { askExcludedAgainstUnstated: true } },
];

async function main() {
  loadLocalEnv();
  // The eval's own budget: every call is counted, and the run stops at $6 (the daily cap the server would apply).
  process.env.DOCK_LLM_DAILY_CALLS = "100000";
  process.env.DOCK_LLM_DAILY_USD = process.env.EVAL_MAX_USD ?? "6";
  const args = process.argv.slice(2);
  const offline = args.includes("--offline");
  const seconds = (flag(args, "--second") ?? DEFAULT_SECOND.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const runs = Number(flag(args, "--runs") ?? 1);
  // --set holdout: the held-out set, written after tuning (holdout.json, readings-holdout.json, results-holdout.json).
  const setName = flag(args, "--set") ?? "set";
  const suffix = setName === "set" ? "" : `-${setName}`;
  const doc = JSON.parse(readFileSync(join(DIR, `${setName}.json`), "utf8")) as { now: string; cases: Case[] };
  const only = flag(args, "--only")?.split(",");
  const set = only ? doc.cases.filter((c) => only.includes(c.id)) : doc.cases;
  const now = new Date(doc.now);
  const file = join(DIR, `readings${suffix}.json`);
  const readings: Readings = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const save = () => writeFileSync(file, `${JSON.stringify(readings, null, 1)}\n`);

  if (!offline) {
    const { catalog, catalogSource } = buildCatalog();
    const m = demoMandate(now);
    const vocabulary = vocabularyFrom(await catalog.searchProducts({ limit: 100 }), { categories: m.allowedCategories, attributes: m.requiredAttributes, allergens: m.forbiddenAllergens });
    console.log(`vocabulary from the ${catalogSource.kind} catalogue: ${vocabulary.attributes.length} attributes, ${vocabulary.allergens.length} allergens`);
    const jobs: { key: string; spec: string; c: Case; timeoutMs: number }[] = [];
    readings[FIRST] ??= {};
    for (const c of set) if (!readings[FIRST][c.id]) jobs.push({ key: FIRST, spec: FIRST, c, timeoutMs: 30_000 });
    for (const s of seconds)
      for (let r = 1; r <= runs; r++) {
        const key = r === 1 ? s : `${s}@${r}`;
        readings[key] ??= {};
        // A model that was at capacity is tried again on the next run of the script.
        for (const c of set) if (!readings[key][c.id] || (!readings[key][c.id].ok && (readings[key][c.id] as { reason: string }).reason === "at_capacity" && args.includes("--retry-capacity"))) jobs.push({ key, spec: s, c, timeoutMs: 30_000 });
      }
    console.log(`${jobs.length} readings to make`);
    const firstJobs = jobs.filter((j) => j.key === FIRST);
    const secondJobs = jobs.filter((j) => j.key !== FIRST);
    let done = 0;
    const one = async (j: (typeof jobs)[number]) => {
      readings[j.key][j.c.id] = await readOnce(j.spec, j.c.text, now, vocabulary, j.timeoutMs);
      if (++done % 10 === 0) {
        save();
        console.log(`  ${done}/${jobs.length}, spend so far $${dailyUsage(now).llm.usd}`);
      }
    };
    await Promise.all([pool(firstJobs, 4, one), pool(secondJobs, 2, one)]);
    save();
  }

  const models = Object.keys(readings).filter((k) => k !== FIRST);
  const results = {
    at: new Date().toISOString(),
    set: { cases: set.length, byLanguage: Object.fromEntries(["en", "fi", "sv"].map((l) => [l, set.filter((c) => c.lang === l).length])), tags: [...new Set(set.flatMap((c) => c.tags))] },
    deadlineMs: SECOND_READER_DEADLINE_MS,
    rules: READING_RULES,
    first: firstSummary(set, readings),
    second: models.map((m) => score(set, readings, m, READING_RULES, SECOND_READER_DEADLINE_MS, now)),
    sweep: models.filter((m) => !m.includes("@")).map((m) => ({
      second: m,
      variants: SWEEP.map((v) => {
        const s = score(set, readings, m, { ...READING_RULES, ...v.rules }, SECOND_READER_DEADLINE_MS, now);
        return { name: v.name, falseAlarmPct: s.falseAlarm.pct, falseAlarms: s.falseAlarm.alarms, injectedCaughtPct: s.injected.pctWhenAvailable, misreadingsCaughtPct: s.injected.misreadings.pct, naturalCaught: `${s.natural.caught}/${s.natural.firstWrong}` };
      }),
    })),
    spendUsd: offline ? 0 : dailyUsage(now).llm.usd,
  };
  writeFileSync(join(DIR, `results${suffix}.json`), `${JSON.stringify(results, null, 1)}\n`);
  console.log(`\nFirst reader ${FIRST}: ${results.first.right}/${results.first.of} right; wrong: ${results.first.wrong.map((w) => `${w.id} (${w.wrong.join(", ")})`).join("; ") || "none"}`);
  for (const s of results.second) {
    console.log(`\n${s.second}`);
    console.log(`  alone right ${s.alone.right}/${s.alone.of} (${s.alone.pct} %), by field ${JSON.stringify(s.alone.byField)}`);
    console.log(`  unavailable ${s.unavailable.total} (${s.unavailable.pct} %): ${JSON.stringify(s.unavailable.failed)}, late ${s.unavailable.lateBeyondDeadline}`);
    console.log(`  false alarms ${s.falseAlarm.alarms}/${s.falseAlarm.firstRight} (${s.falseAlarm.pct} %) ${JSON.stringify(s.falseAlarm.byField)}`);
    for (const fa of s.falseAlarm.cases) console.log(`    ${fa.id} ${fa.field}: ${fa.first} | ${fa.second}`);
    console.log(`  natural misreadings caught ${s.natural.caught}/${s.natural.firstWrong} ${JSON.stringify(s.natural.cases)}`);
    console.log(`  injected caught ${s.injected.caught}/${s.injected.withSecond} when available (${s.injected.pctWhenAvailable} %), ${s.injected.pctOfAll} % of all ${s.injected.n}; misreadings (not inventions) ${s.injected.misreadings.caught}/${s.injected.misreadings.n} (${s.injected.misreadings.pct} %)`);
    console.log(`  by kind ${Object.entries(s.injected.byKind).map(([k, v]) => `${k} ${v.caught}/${v.n}`).join("; ")}`);
    if (s.firstIncomplete.length) console.log(`  first reader asked for a missing field (not compared): ${s.firstIncomplete.join(", ")}`);
    console.log(`  latency p50 ${s.latencyMs.p50} ms, p90 ${s.latencyMs.p90} ms; waited after the first p50 ${s.latencyMs.waitedP50} ms, p90 ${s.latencyMs.waitedP90} ms`);
  }
  for (const sw of results.sweep) {
    console.log(`\nsweep ${sw.second}`);
    for (const v of sw.variants) console.log(`  ${v.name.padEnd(56)} false alarms ${v.falseAlarmPct} % (${v.falseAlarms}), misreadings caught ${v.misreadingsCaughtPct} %, all injected ${v.injectedCaughtPct} %, natural ${v.naturalCaught}`);
  }
  console.log(`\nspend this run $${results.spendUsd}; results in eval/second-reader/results${suffix}.json`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
