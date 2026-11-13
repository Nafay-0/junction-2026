import type { MenuDraft } from "../draft";
import type { PlanView } from "../plan";

/**
 * The menu planner's evaluation set: realistic requests, each with checks on what the model drafted (dishes,
 * ingredients, amounts, dates, dietary rules) and on what plain code made of it. The same checks run on recorded
 * model outputs in `pnpm test` and on fresh model output with `pnpm menu:eval` (live, opt-in).
 *
 * Amount ranges are per cover, as eaten, for Finnish food-service portions (lunch soup as a main about 3.5 dl;
 * a school lunch smaller). A check names the mistake it catches, so the report can say what went wrong.
 */

export type Check = { name: string; ok: boolean; detail?: string };
export type EvalCase = {
  id: string;
  kitchen: "kaari" | "laakso";
  covers: string;
  text: string;
  expect: (d: MenuDraft, today: string) => Check[];
  /** Checks on the computed plan (any catalogue). */
  plan?: (v: PlanView, d: MenuDraft) => Check[];
};

// ---------- helpers ----------

const ing = (d: MenuDraft) => d.dishes.flatMap((x) => x.ingredients.map((i) => ({ dish: x.name, ...i })));
const words = (i: { key: string; name: string; searchTerms: string[] }) => ` ${[i.key.replace(/_/g, " "), i.name, ...i.searchTerms].join(" ").toLowerCase()} `;
const has = (d: MenuDraft, re: RegExp) => ing(d).filter((i) => re.test(words(i)));
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** The next given ISO weekday (1 = Monday) strictly after `today`. */
export function nextWeekday(today: string, weekday: number): string {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today, i);
    const wd = ((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    if (wd === weekday) return d;
  }
  return today;
}

function check(name: string, ok: boolean, detail?: string): Check {
  return { name, ok, ...(ok || !detail ? {} : { detail }) };
}
function present(d: MenuDraft, name: string, re: RegExp): Check {
  const found = has(d, re);
  return check(`has ${name}`, found.length > 0, `no ${name} among: ${ing(d).map((i) => i.key).join(", ")}`);
}
function absent(d: MenuDraft, name: string, re: RegExp): Check {
  const found = has(d, re).filter((i) => !/nut[- ]free|pahkinaton|pähkinätön/.test(words(i)));
  return check(`no ${name}`, found.length === 0, `planned ${found.map((i) => `${i.key} (${i.dish})`).join(", ")}`);
}
function perCover(d: MenuDraft, name: string, re: RegExp, unit: "g" | "ml", min: number, max: number): Check {
  const found = has(d, re).filter((i) => i.perCover.unit === unit);
  if (!found.length) return check(`${name} per cover in ${unit}`, false, `no ${name} in ${unit}`);
  const total = found.reduce((s, i) => s + i.perCover.amount, 0);
  return check(`${name} ${min} to ${max} ${unit} per cover`, total >= min && total <= max, `${total} ${unit} per cover`);
}
function covers(d: MenuDraft, n: number | null): Check {
  return check(n === null ? "covers left open" : `covers ${n}`, d.covers === n, `covers ${d.covers}`);
}
function date(d: MenuDraft, want: string): Check {
  const got = d.serviceDate ?? d.dishes.map((x) => x.serviceDate).filter(Boolean).sort()[0] ?? null;
  return check(`service day ${want}`, got === want, `got ${got}`);
}
function dishes(d: MenuDraft, min: number, max: number): Check {
  return check(`${min} to ${max} dishes`, d.dishes.length >= min && d.dishes.length <= max, `${d.dishes.length} dishes: ${d.dishes.map((x) => x.name).join(", ")}`);
}
function noCorrections(d: MenuDraft): Check {
  return check("no amount or date the code had to correct", d.corrections.length === 0, d.corrections.join(" | "));
}
const NUTS = /\b(nut|nuts|pahkina|pähkinä|peanut|maapahkina|maapähkinä|almond|manteli|hazelnut|hasselpahkina|cashew|walnut|saksanpahkina|pistachio|pecan|satay)\b/;

// Plan checks that hold for every case, on any catalogue.
export function invariants(v: PlanView, d: MenuDraft, opts: { forbidden: string[] }): Check[] {
  const out: Check[] = [];
  const chosen = v.lines.filter((l) => l.chosen);
  for (const l of chosen) {
    const c = l.chosen!;
    const delivered = c.delivered.amount;
    out.push(check(`${l.name}: packs cover the amount`, !l.gross || delivered + 1e-6 >= l.gross.amount || c.match === "compromise", `${delivered} for ${l.gross?.amount}`));
    for (const s of c.safety) if (opts.forbidden.some((a) => s.rule.startsWith(`no ${a}`))) out.push(check(`${l.name}: ${s.rule} shown safe by data`, s.verdict === "ok" || l.doubts.some((x) => x.kind === "allergen_unknown"), s.reason));
  }
  out.push(check("a quote is never asked with open doubts", !v.totals.canQuote || v.totals.openDoubts === 0));
  out.push(check("one quote: at most 10 products, or the plan says why not", v.totals.products <= 10 || v.totals.blockers.some((b) => b.includes("at most 10"))));
  void d;
  return out;
}

// ---------- the cases ----------

/** Mistakes the model made in recorded runs and what catches them, for the report (see eval.test.ts). */
export const KNOWN_MODEL_MISTAKES = [
  { case: "lohikeitto-fi", mistake: "avoid list for lactose-free cream contained 'laktoosi', a word every right product's name has", caughtBy: "match.ts ignores avoid words found in the ingredient's own name or search terms" },
  { case: "week-menu-school", mistake: "eggs counted in pieces (0.1 and 0.5 per cover) matched to a 180-egg case sold per case: 270 cases, €8,372", caughtBy: "plan.ts holds any pieces line (packs are not counted in pieces) and any line over €4 per cover; the prompt now asks for grams" },
  { case: "peanut-satay-school", mistake: "conflict about peanuts named the chicken too, so it landed on the chicken line", caughtBy: "plan.ts puts a rule clash only on a line whose products were refused for an allergen" },
];

export const CASES: EvalCase[] = [
  {
    id: "salmon-soup",
    kitchen: "kaari",
    covers: "a plain dish",
    text: "Salmon soup for 300 on Friday",
    expect: (d, today) => [
      covers(d, 300),
      date(d, nextWeekday(today, 5)),
      dishes(d, 1, 1),
      present(d, "salmon", /salmon|lohi/),
      present(d, "potatoes", /potato|peruna/),
      present(d, "cream or milk", /cream|kerma|milk|maito/),
      present(d, "dill", /dill|tilli/),
      perCover(d, "salmon", /salmon|lohi/, "g", 60, 150),
      perCover(d, "potatoes", /potato|peruna/, "g", 60, 220),
      check("dairy marked lactose-free (kitchen rule)", has(d, /cream|kerma|milk|maito/).every((i) => /lactose|laktoositon/.test(words(i))), has(d, /cream|kerma/).map((i) => i.name).join(", ")),
      noCorrections(d),
    ],
  },
  {
    id: "lohikeitto-fi",
    kitchen: "kaari",
    covers: "Finnish-language request",
    text: "Lohikeitto 300 annosta perjantaiksi",
    expect: (d, today) => [
      covers(d, 300),
      date(d, nextWeekday(today, 5)),
      present(d, "salmon", /salmon|lohi/),
      present(d, "potatoes", /potato|peruna/),
      present(d, "cream", /cream|kerma/),
      check("Finnish search terms first", has(d, /salmon|lohi/).some((i) => /lohi/.test(i.searchTerms[0]?.toLowerCase() ?? "")), has(d, /salmon/).map((i) => i.searchTerms.join("/")).join(", ")),
      perCover(d, "salmon", /salmon|lohi/, "g", 60, 150),
      noCorrections(d),
    ],
    // The model's avoid list for the cream said "laktoosi", which every lactose-free cream's name contains: the code
    // must ignore a word that contradicts the ingredient's own terms, or it throws out every right product.
    plan: (v) => {
      const cream = v.lines.find((l) => /cream/.test(l.name.toLowerCase()));
      return [check("lactose-free cream found despite the model's contradictory avoid word", !!cream?.chosen, cream?.doubts.map((x) => x.text).join(" "))];
    },
  },
  {
    id: "christmas-party",
    kitchen: "kaari",
    covers: "a large event",
    text: "Company Christmas party next Thursday for 450 guests: Karelian stew with mashed potatoes and lingonberries, then rice porridge with plum kissel",
    expect: (d, today) => [
      covers(d, 450),
      date(d, nextWeekday(today, 4)),
      dishes(d, 2, 5),
      present(d, "beef or pork for the stew", /beef|nauta|pork|sika|porsas|karjalanpaisti/),
      present(d, "potatoes", /potato|peruna/),
      present(d, "lingonberries", /lingonberr|puolukka/),
      present(d, "rice for porridge", /rice|riisi|puuroriisi/),
      present(d, "plums", /plum|luumu/),
      perCover(d, "meat for the stew", /beef|nauta|pork|sika|porsas|karjalanpaisti|lamb|lammas/, "g", 120, 300),
      noCorrections(d),
    ],
  },
  {
    id: "tomorrow-three-course",
    kitchen: "kaari",
    covers: "a tight deadline (order cut-offs)",
    text: "Tomorrow, unexpected booking: 120 covers, three-course lunch, lactose-free and nut-free",
    expect: (d, today) => [
      covers(d, 120),
      date(d, addDays(today, 1)),
      dishes(d, 3, 4),
      check("nut-free taken as a rule", d.forbiddenAllergens.includes("nuts"), `forbidden: ${d.forbiddenAllergens.join(", ")}`),
      check("lactose-free taken as a rule", d.requiredClaims.includes("lactose_free") || d.forbiddenAllergens.includes("lactose"), `claims: ${d.requiredClaims.join(", ")}`),
      absent(d, "nuts", NUTS),
      noCorrections(d),
    ],
  },
  {
    id: "school-salmon",
    kitchen: "laakso",
    covers: "a strict allergen kitchen",
    text: "School lunch for 450 on Monday: salmon soup, rye bread, berry quark for dessert",
    expect: (d, today) => [
      covers(d, 450),
      date(d, nextWeekday(today, 1)),
      dishes(d, 3, 3),
      absent(d, "nuts", NUTS),
      present(d, "rye bread", /rye|ruis/),
      present(d, "quark", /quark|rahka/),
      present(d, "berries", /berr|marja|mustikka|vadelma|puolukka/),
      perCover(d, "salmon", /salmon|lohi/, "g", 40, 120),
      noCorrections(d),
    ],
  },
  {
    id: "chanterelles-week",
    kitchen: "kaari",
    covers: "a seasonal ingredient",
    text: "Next week's lunch menu around chanterelles: two dishes, 250 covers a day, Wednesday and Thursday",
    expect: (d, today) => [
      covers(d, 250),
      dishes(d, 2, 2),
      check("chanterelles in both dishes", d.dishes.every((x) => x.ingredients.some((i) => /chanterelle|kantarelli/.test(words(i)))), d.dishes.map((x) => `${x.name}: ${x.ingredients.map((i) => i.key).join("/")}`).join("; ")),
      check("one dish Wednesday, one Thursday", [...new Set(d.dishes.map((x) => x.serviceDate))].sort().join() === [nextWeekday(today, 3), nextWeekday(today, 4)].join(), d.dishes.map((x) => x.serviceDate).join(", ")),
      perCover(d, "chanterelles", /chanterelle|kantarelli/, "g", 20, 160),
      noCorrections(d),
    ],
  },
  {
    id: "vague-staff-lunch",
    kitchen: "kaari",
    covers: "a vague request",
    text: "Something warming for the staff lunch on Monday",
    expect: (d, today) => [covers(d, null), date(d, nextWeekday(today, 1)), dishes(d, 1, 3), check("assumptions say what was chosen", d.assumptions.length > 0)],
  },
  {
    id: "decline-table",
    kitchen: "kaari",
    covers: "one that should be declined",
    text: "Can you book us a table for four at a nice restaurant on Saturday evening?",
    expect: (d) => [check("declined: not a food order", !d.isFoodOrderRequest, `isFoodOrderRequest ${d.isFoodOrderRequest}`), check("no dishes", d.dishes.length === 0), check("a reason is given", !!d.declineReason)],
  },
  {
    id: "peanut-satay-school",
    kitchen: "laakso",
    covers: "an allergen clash the code must hold",
    text: "Peanut satay chicken with rice for 200 pupils on Tuesday",
    expect: (d, today) => [
      covers(d, 200),
      date(d, nextWeekday(today, 2)),
      check("the clash with the no-nuts rule is stated", d.conflicts.length > 0, "no conflict stated"),
      present(d, "chicken", /chicken|broileri|kana/),
    ],
    plan: (v) => {
      const nutLines = v.lines.filter((l) => /peanut|maapahkina|satay/.test(l.name.toLowerCase()));
      return [
        check("no peanut product is ever chosen", nutLines.every((l) => !l.chosen || l.chosen.safety.every((s) => s.verdict === "ok")), nutLines.map((l) => l.chosen?.title).join(", ")),
        check("no quote while the clash is open", !v.totals.canQuote || nutLines.every((l) => l.status === "struck" || l.doubts.every((x) => x.accepted))),
      ];
    },
  },
  {
    id: "week-menu-school",
    kitchen: "laakso",
    covers: "a pasted week menu",
    text: "Next week's menu, 450 pupils a day:\nMon meatball sauce with potatoes\nTue fish fingers with mashed potatoes\nWed vegetable soup with bread\nThu chicken curry with rice\nFri pea soup with pancakes",
    expect: (d, today) => [
      covers(d, 450),
      dishes(d, 5, 10),
      check("each day has its own date", new Set(d.dishes.map((x) => x.serviceDate).filter(Boolean)).size >= 5, d.dishes.map((x) => x.serviceDate).join(", ")),
      check("Monday first", d.dishes.map((x) => x.serviceDate).filter(Boolean).sort()[0] === nextWeekday(today, 1), d.dishes.map((x) => x.serviceDate).join(", ")),
      present(d, "peas for the pea soup", /pea|herne/),
      absent(d, "nuts", NUTS),
    ],
  },
];
