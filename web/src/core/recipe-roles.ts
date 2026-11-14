import type { LiveStatus } from "./catalog";

/**
 * Substitution through recipe logic, not a product with a similar name: what an ingredient does in the dish (its
 * role), and what else does that job, with the amount adjusted, the trade-off said, and good, better, best. Plain code
 * and plain data, no model: a model may propose more ideas elsewhere (server/agent/menu/fixes.ts), but every option,
 * from here or from a model, is verified by `verifyOption` before anyone sees it.
 *
 *   roleOf           fat, acid, thickener, protein, aromatic, garnish, liquid, sweetener or body, from the planner's
 *                    words for what the ingredient does and its name
 *   ROLE_SUBS        culinary knowledge as data: crème fraîche -> cream + lemon (0.9 + 0.1), fresh dill -> frozen dill
 *                    (1:1) or dried (a third), butter -> rapeseed oil (0.8) for frying, flour -> potato starch (half) ...
 *   techniqueFor     a change to the component instead of a product: reduce instead of thickening, leave a garnish off
 *   arrivalOf        whether a product can come by the day, and if not, why in the wholesaler's own terms (the order
 *                    cut-off passed at a time, out of stock, no delivery that day) and the earliest day it could
 *   verifyOption     every product of an option exists, can arrive by the day, and passes the kitchen's rules; nothing
 *                    that fails one is shown
 *   rankOptions      good, better, best among the verified ones, by how faithfully each does the job, its cost and work
 */

export const ROLES = ["fat", "acid", "thickener", "protein", "aromatic", "garnish", "liquid", "sweetener", "body"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_TEXT: Record<Role, string> = {
  fat: "the fat (richness, frying)",
  acid: "the acid (freshness, tang)",
  thickener: "the thickener",
  protein: "the protein",
  aromatic: "an aromatic (flavour base)",
  garnish: "the garnish",
  liquid: "the liquid",
  sweetener: "the sweetener",
  body: "the body of the dish",
};

const ROLE_WORDS: [Role, RegExp][] = [
  ["garnish", /garnish|topping|decorat|finish(?:ing)? on top|sprinkle|koriste|garner/],
  ["thickener", /thicken|binds?\b|binding|roux|starch|suurus|sakeu|redning/],
  ["acid", /acid|tang|sour(?:ness)?\b|freshness|brightness|hapan|happo|syrlig/],
  ["fat", /\bfat\b|richness|frying|fry\b|saut[eé]|butter(?:y)?\b|rasva|paist|fett/],
  ["protein", /protein|main (?:fish|meat)|the fish|the meat|centre of the plate|kala|liha/],
  ["sweetener", /sweet|sugar|honey|makeut|sötma/],
  ["aromatic", /aromatic|flavour base|flavor base|seasoning|herb|aroma|mauste|yrtt|smak/],
  ["liquid", /liquid|stock|broth|base of the soup|cooking liquid|liemi|neste|vätska/],
];
const NAME_ROLE: [Role, RegExp][] = [
  ["fat", /\b(butter|oil|lard|margarine|voi|öljy|smör|olja)\b/],
  ["acid", /\b(lemon|lime|vinegar|sitruun|limet|etikka|citron|vinäger)/],
  ["thickener", /\b(flour|starch|cornflour|jauho|tärkkel|mjöl|stärkelse)/],
  ["protein", /\b(salmon|fish|chicken|beef|pork|lamb|moose|egg|tofu|lohi|kala|broiler|kana|nauta|possu|hirvi|lax|fisk|kyckling)/],
  ["garnish", /\b(chive|ruohosipuli|gräslök|cress|krassi|krasse)/],
  ["aromatic", /\b(dill|parsley|thyme|garlic|onion|shallot|tilli|persilja|timjami|valkosipuli|sipuli|salottisipuli|dill|persilja|vitlök|lök)/],
  ["liquid", /\b(stock|broth|milk|water|liemi|fond|buljong|maito|mjölk)/],
  ["sweetener", /\b(sugar|honey|syrup|sokeri|hunaja|siirappi|socker)/],
];

/** The role of an ingredient, from the planner's words for what it does, else from its name; "body" when nothing says. */
export function roleOf(roleText: string, name: string): Role {
  const r = roleText.toLowerCase();
  for (const [role, re] of ROLE_WORDS) if (re.test(r)) return role;
  const n = name.toLowerCase();
  for (const [role, re] of NAME_ROLE) if (re.test(n)) return role;
  return "body";
}

export type SubForm = "fresh" | "frozen" | "dried" | "canned_or_jarred" | "any";
/** One product to buy for an option: `ratio` of the original amount per cover, in `unit` when it changes measure. */
export type SubPart = { name: string; searchTerms: string[]; ratio: number; unit?: "g" | "ml"; form: SubForm; main: boolean };
export type Tradeoff = { taste: string; texture: string; work: string };
export type RoleSub = {
  id: string;
  /** Which ingredient this replaces: stems in its key, name or search words (English, Finnish, Swedish). */
  match: { words: string[]; not?: string[] };
  roles?: Role[];
  title: string;
  parts: SubPart[];
  tradeoff: Tradeoff;
  /** 0..1: how faithfully it does the same job in the dish. */
  fidelity: number;
};

/** A plant-based ingredient ("oat whipping cream") is not replaced by a dairy one: the dish chose it for a reason. */
const PLANT = ["oat", "kaura", "havre", "soy", "soija", "plant", "kasvi", "vegan", "coconut", "kookos"];
const part = (name: string, searchTerms: string[], ratio: number, form: SubForm = "any", main = true, unit?: "g" | "ml"): SubPart => ({ name, searchTerms, ratio, form, main, ...(unit ? { unit } : {}) });

export const ROLE_SUBS: RoleSub[] = [
  // ---- cultured cream ----
  { id: "creme_fraiche_smetana", match: { words: ["creme fraiche", "crème fraîche", "ranskankerm", "creme-fraiche"] }, title: "Smetana instead, same amount", parts: [part("smetana", ["smetana", "smetana 20 %"], 1)], tradeoff: { taste: "the closest: the same mild tang", texture: "slightly less thick", work: "none" }, fidelity: 0.9 },
  { id: "creme_fraiche_sour_cream", match: { words: ["creme fraiche", "crème fraîche", "ranskankerm"] }, title: "Sour cream instead, same amount", parts: [part("sour cream", ["hapankerma", "sour cream", "gräddfil"], 1)], tradeoff: { taste: "tangier and leaner", texture: "thinner; it splits if boiled hard", work: "stir it in at the end, off the boil" }, fidelity: 0.82 },
  { id: "creme_fraiche_cream_lemon", match: { words: ["creme fraiche", "crème fraîche", "ranskankerm"] }, title: "Cream and lemon juice: 9 parts cream to 1 part lemon", parts: [part("cooking cream", ["ruokakerma", "kerma", "cooking cream"], 0.9, "any", true, "ml"), part("lemon juice", ["sitruunamehu", "lemon juice", "sitruuna"], 0.1, "any", false, "ml")], tradeoff: { taste: "milder tang", texture: "thinner, pours rather than dollops", work: "stir the lemon into the cream ten minutes before it is used" }, fidelity: 0.75 },
  { id: "sour_cream_creme_fraiche", match: { words: ["sour cream", "hapankerm", "gräddfil"] }, title: "Crème fraîche instead, same amount", parts: [part("crème fraîche", ["ranskankerma", "creme fraiche"], 1)], tradeoff: { taste: "milder, richer", texture: "thicker; holds when boiled", work: "none" }, fidelity: 0.85 },
  { id: "smetana_creme_fraiche", match: { words: ["smetana"] }, title: "Crème fraîche instead, same amount", parts: [part("crème fraîche", ["ranskankerma", "creme fraiche"], 1)], tradeoff: { taste: "the same mild tang", texture: "a little thicker", work: "none" }, fidelity: 0.88 },
  // ---- cream ----
  { id: "cream_cooking", match: { words: ["cream", "kerma", "grädde"], not: ["whip", "vispi", "visp", "sour", "hapan", "fraiche", "fraîche", "ranskan", "cheese", "juusto", "ice", "jäätelö", "smetana", ...PLANT] }, title: "Cooking cream instead, same amount", parts: [part("cooking cream", ["ruokakerma", "cooking cream", "matlagningsgrädde"], 1)], tradeoff: { taste: "a little leaner", texture: "holds when boiled; will not whip", work: "none" }, fidelity: 0.85 },
  { id: "whipping_cream_other", match: { words: ["whipping cream", "vispikerm", "vispgrädde", "kuohukerm"], not: PLANT }, title: "Another whipping cream, same amount", parts: [part("whipping cream", ["vispikerma", "whipping cream", "kuohukerma"], 1)], tradeoff: { taste: "the same", texture: "the same when it is 35 % or more", work: "none" }, fidelity: 0.92 },
  // ---- herbs ----
  { id: "dill_frozen", match: { words: ["dill", "tilli"], not: ["pickle", "suolakurk", "kurkku"] }, title: "Frozen dill, same amount", parts: [part("frozen dill", ["tilli pakaste", "pakastettu tilli", "frozen dill"], 1, "frozen")], tradeoff: { taste: "the same fresh taste", texture: "limp: in the dish, not as a sprig on top", work: "add it at the end, straight from frozen" }, fidelity: 0.85 },
  { id: "dill_dried", match: { words: ["dill", "tilli"], not: ["pickle", "suolakurk", "kurkku"] }, title: "Dried dill, a third of the amount", parts: [part("dried dill", ["kuivattu tilli", "tilli kuivattu", "dried dill"], 1 / 3, "dried")], tradeoff: { taste: "duller, a hay-like note", texture: "no green leaves to see", work: "cook it in with the liquid, not on top" }, fidelity: 0.6 },
  { id: "parsley_frozen", match: { words: ["parsley", "persilja", "persilja"] }, title: "Frozen parsley, same amount", parts: [part("frozen parsley", ["persilja pakaste", "frozen parsley"], 1, "frozen")], tradeoff: { taste: "the same", texture: "limp, in the dish only", work: "none" }, fidelity: 0.82 },
  { id: "chives_frozen", match: { words: ["chive", "ruohosipul", "gräslök"] }, title: "Frozen chives, same amount", parts: [part("frozen chives", ["ruohosipuli pakaste", "frozen chives"], 1, "frozen")], tradeoff: { taste: "the same", texture: "softer", work: "sprinkle on just before serving" }, fidelity: 0.82 },
  // ---- fat ----
  { id: "butter_oil", match: { words: ["butter", "voi", "smör"], not: ["peanut", "maapähkinä", "voileip", "butterfly", "voimakas"] }, roles: ["fat"], title: "Rapeseed oil, four fifths of the amount (frying only)", parts: [part("rapeseed oil", ["rypsiöljy", "rapeseed oil", "rapsolja"], 0.8, "any", true, "ml")], tradeoff: { taste: "no butter taste", texture: "browns less", work: "none; not for baking or a butter sauce" }, fidelity: 0.65 },
  { id: "butter_spread", match: { words: ["butter", "voi", "smör"], not: ["peanut", "maapähkinä", "voileip", "voimakas"] }, title: "A butter-and-oil blend, same amount", parts: [part("butter and oil blend", ["voi-kasviöljyseos", "levite", "butter blend"], 1)], tradeoff: { taste: "milder butter taste", texture: "the same in cooking", work: "none" }, fidelity: 0.78 },
  // ---- acid ----
  { id: "lemon_lime", match: { words: ["lemon", "sitruun", "citron"] }, title: "Lime juice, same amount", parts: [part("lime", ["lime", "limetti", "limemehu"], 1)], tradeoff: { taste: "more floral", texture: "the same", work: "none" }, fidelity: 0.85 },
  { id: "lemon_vinegar", match: { words: ["lemon", "sitruun", "citron"] }, roles: ["acid"], title: "White wine vinegar, half the amount", parts: [part("white wine vinegar", ["valkoviinietikka", "etikka", "white wine vinegar"], 0.5, "any", true, "ml")], tradeoff: { taste: "sharper, no citrus", texture: "the same", work: "add a little at a time and taste" }, fidelity: 0.6 },
  // ---- aromatics ----
  { id: "shallot_onion", match: { words: ["shallot", "salottisipul", "schalotten"] }, title: "Yellow onion, same amount", parts: [part("onion", ["keltasipuli", "sipuli", "onion"], 1, "fresh")], tradeoff: { taste: "sharper; sweeten with longer cooking", texture: "the same", work: "cook it two or three minutes longer" }, fidelity: 0.8 },
  { id: "garlic_frozen", match: { words: ["garlic", "valkosipul", "vitlök"] }, title: "Crushed frozen garlic, same amount", parts: [part("frozen garlic", ["valkosipuli murska", "valkosipulimurska", "garlic puree"], 1)], tradeoff: { taste: "slightly milder", texture: "the same in the dish", work: "less: no peeling" }, fidelity: 0.85 },
  // ---- mushrooms, berries, vegetables ----
  { id: "chanterelle_frozen", match: { words: ["chanterell", "kantarell"] }, title: "Frozen chanterelles, same amount", parts: [part("frozen chanterelles", ["kantarelli pakaste", "chanterelles frozen", "kantarelli"], 1, "frozen")], tradeoff: { taste: "the same", texture: "softer, less bite", work: "fry from frozen in a hot pan until the water is gone" }, fidelity: 0.85 },
  { id: "mushroom_frozen", match: { words: ["mushroom", "sieni", "svamp", "herkkusien", "champignon"], not: ["chanterell", "kantarell"] }, title: "Frozen mushrooms, same amount", parts: [part("frozen mushrooms", ["herkkusieni pakaste", "frozen mushrooms", "sieni pakaste"], 1, "frozen")], tradeoff: { taste: "the same", texture: "softer", work: "fry from frozen until dry" }, fidelity: 0.8 },
  { id: "berries_frozen", match: { words: ["blueberr", "bilberr", "mustik", "lingonberr", "puoluk", "raspberr", "vadelm", "strawberr", "mansik", "lingon", "blåbär", "hallon"], not: ["jam", "hillo", "sylt", "juice", "mehu"] }, title: "Frozen berries of the same kind, same amount", parts: [part("frozen berries", ["pakaste", "frozen berries"], 1, "frozen")], tradeoff: { taste: "the same", texture: "softer; they bleed colour", work: "thaw in a sieve; fine in sauces, quark and baking, not on top" }, fidelity: 0.82 },
  { id: "root_peeled", match: { words: ["beetroot", "punajuur", "rödbet", "carrot", "porkkan", "morot", "swede", "lanttu", "kålrot", "parsnip", "palsternak", "celeriac", "juuriseller", "rotselleri"] }, title: "The same root vegetable ready peeled, the net amount", parts: [part("peeled root vegetable", ["kuorittu", "peeled"], 0.85, "fresh")], tradeoff: { taste: "the same", texture: "the same", work: "less: no peeling" }, fidelity: 0.9 },
  { id: "root_frozen", match: { words: ["beetroot", "punajuur", "rödbet", "carrot", "porkkan", "morot", "swede", "lanttu", "kålrot", "parsnip", "palsternak", "celeriac", "juuriseller", "rotselleri"] }, title: "The same root vegetable frozen and diced, the net amount", parts: [part("frozen diced root vegetable", ["pakaste kuutio", "frozen diced"], 0.85, "frozen")], tradeoff: { taste: "slightly sweeter, less earthy", texture: "softer; no whole roasted pieces", work: "less: no peeling or dicing; roast or boil from frozen" }, fidelity: 0.7 },
  // ---- protein ----
  { id: "salmon_trout", match: { words: ["salmon", "lohi", "lohifil", "lax"], not: ["smoked", "savust", "rökt", "kirjolohi", "regnbåg"] }, roles: ["protein", "body"], title: "Rainbow trout fillet, same amount", parts: [part("rainbow trout fillet", ["kirjolohifilee", "kirjolohi", "rainbow trout"], 1, "fresh")], tradeoff: { taste: "milder, a little less fat", texture: "finer flakes", work: "none" }, fidelity: 0.85 },
  { id: "salmon_frozen", match: { words: ["salmon", "lohi", "lohifil", "lax"], not: ["smoked", "savust", "rökt"] }, roles: ["protein", "body"], title: "Frozen salmon fillet, same amount", parts: [part("frozen salmon fillet", ["lohifilee pakaste", "frozen salmon fillet", "lohi pakaste"], 1, "frozen")], tradeoff: { taste: "the same", texture: "a little softer", work: "thaw overnight in the fridge" }, fidelity: 0.8 },
  // ---- thickener, liquid ----
  { id: "flour_potato_starch", match: { words: ["wheat flour", "vehnäjauh", "flour", "jauho", "mjöl"], not: ["potato", "peruna", "rye", "ruis", "oat", "kaura"] }, roles: ["thickener"], title: "Potato starch, half the amount", parts: [part("potato starch", ["perunajauho", "potato starch", "potatismjöl"], 0.5)], tradeoff: { taste: "neutral", texture: "clear and glossy, thins if reheated", work: "mix with cold water, stir in at the end, do not boil" }, fidelity: 0.75 },
  { id: "stock_powder", match: { words: ["stock", "broth", "liemi", "fond", "buljong"], not: ["powder", "jauhe", "cube", "kuutio", "tiiviste", "concentrate", "paste"] }, roles: ["liquid"], title: "Bouillon powder and water: 15 g of powder for every litre", parts: [part("bouillon powder", ["liemijauhe", "bouillon powder", "buljongpulver"], 0.015, "dried", true, "g")], tradeoff: { taste: "saltier, less depth", texture: "the same", work: "dissolve in hot water; salt the dish less" }, fidelity: 0.7 },
];

/** Stems in an ingredient's key, name or search words: does this rule describe it? */
export function subsFor(ing: { key: string; name: string; searchTerms: string[] }, role: Role, rules: RoleSub[] = ROLE_SUBS): RoleSub[] {
  const hay = ` ${[ing.key.replace(/_/g, " "), ing.name, ...ing.searchTerms].join(" ").toLowerCase()} `;
  return rules.filter((r) => r.match.words.some((w) => hay.includes(w)) && !r.match.not?.some((w) => hay.includes(w)) && (!r.roles || r.roles.includes(role)));
}

/** A change to the component or the technique for a role, with nothing to buy. Undefined for roles that have none. */
export type Technique = { id: string; title: string; tradeoff: Tradeoff; fidelity: number };
export function techniqueFor(role: Role, ingredientName: string): Technique | undefined {
  switch (role) {
    case "garnish":
      return { id: "technique_no_garnish", title: `Leave the ${ingredientName} off, or garnish with something already on the plan`, tradeoff: { taste: "no change in the dish itself", texture: "a plainer look", work: "none" }, fidelity: 0.55 };
    case "thickener":
      return { id: "technique_reduce", title: `Reduce the sauce instead of thickening it with ${ingredientName}`, tradeoff: { taste: "more concentrated", texture: "thinner", work: "10 to 15 minutes more on the stove" }, fidelity: 0.55 };
    case "acid":
      return { id: "technique_acid_other", title: `Leave the ${ingredientName} out and sharpen at the end with what the kitchen has (vinegar, pickle juice)`, tradeoff: { taste: "less fresh", texture: "the same", work: "taste and adjust before serving" }, fidelity: 0.45 };
    case "aromatic":
      return { id: "technique_leave_out", title: `Leave the ${ingredientName} out and season more at the end`, tradeoff: { taste: "flatter", texture: "the same", work: "none" }, fidelity: 0.4 };
    default:
      return undefined;
  }
}

// ---------- can it arrive by the day ----------

export type ArrivalCode = "cutoff_passed" | "out_of_stock" | "not_deliverable" | "later" | "no_price" | "blocked" | "not_checked";
export type Arrival = { ok: true; date: string; orderBy?: string } | { ok: false; code: ArrivalCode; why: string; earliest?: string; orderBy?: string };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Thu 12.11." for a calendar date. */
export function dayText(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}
/** "Thu 12.11. at 15.00" for the partner's cut-off timestamp, in Helsinki time. */
export function cutoffText(orderBy: string): string {
  const t = Date.parse(orderBy);
  if (!Number.isFinite(t)) return orderBy;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return `${dayText(`${parts.year}-${parts.month}-${parts.day}`)} at ${parts.hour}.${parts.minute}`;
}

/**
 * Whether a product can be delivered by `wanted`, from the wholesaler's live status for that date, in its own terms.
 * `earliest` only when the wholesaler names a later day that can still be made; a day it names with a passed cut-off
 * is not one.
 */
export function arrivalOf(status: LiveStatus | undefined, wanted: string): Arrival {
  if (!status) return { ok: false, code: "not_checked", why: "not checked with the wholesaler" };
  const o = status.offer;
  const has = (p: LiveStatus["problems"][number]) => status.problems.includes(p);
  if (has("unknown_product")) return { ok: false, code: "blocked", why: "not in the wholesaler's assortment" };
  if (has("not_deliverable") || (!o && !has("no_price"))) return { ok: false, code: "not_deliverable", why: "the wholesaler has no delivery for it on any day" };
  if (has("no_price") || has("price_not_valid")) return { ok: false, code: "no_price", why: "no valid price from the wholesaler now" };
  if (has("sales_block")) return { ok: false, code: "blocked", why: "blocked for sale now" };
  if (has("out_of_stock")) return { ok: false, code: "out_of_stock", why: "out of stock", ...(o?.deliveryDate && o.deliveryDate > wanted ? { earliest: o.deliveryDate } : {}) };
  if (has("cutoff_passed") || o?.cutoffPassed)
    return { ok: false, code: "cutoff_passed", why: `the order cut-off passed${o?.orderBy ? ` on ${cutoffText(o.orderBy)}` : ""}${o?.deliveryDate ? ` (for delivery ${dayText(o.deliveryDate)})` : ""}`, ...(o?.orderBy ? { orderBy: o.orderBy } : {}) };
  if (o && o.deliveryDate > wanted) return { ok: false, code: "later", why: `no delivery on ${dayText(wanted)}: the earliest is ${dayText(o.deliveryDate)}${o.orderBy ? `, ordered by ${cutoffText(o.orderBy)}` : ""}`, earliest: o.deliveryDate, ...(o.orderBy ? { orderBy: o.orderBy } : {}) };
  if (!o) return { ok: false, code: "no_price", why: "no offer from the wholesaler now" };
  return { ok: true, date: o.deliveryDate, ...(o.orderBy ? { orderBy: o.orderBy } : {}) };
}

// ---------- verified, then ranked ----------

export type OptionKind = "ingredient" | "technique" | "dish";
export type PartCheck = {
  part: string;
  main: boolean;
  /** The product found for the part in the assortment, if any. */
  product?: { productId: string; name: string; packs: number; totalCents: number; packText: string };
  arrival: Arrival;
  /** The kitchen's rules: allergens, required claims, nutrition rules, the mandate's product groups. */
  rules: { ok: boolean; reason?: string };
};
export type OptionToVerify = { optionId: string; kind: OptionKind; title: string; tradeoff: Tradeoff; fidelity: number; source: "rules" | "model" | "map"; checks: PartCheck[]; deltaCents: number | null };
export type Verdict = { ok: true } | { ok: false; reasons: string[] };

/** Every part has a product in the assortment that can arrive by the day and passes the kitchen's rules. */
export function verifyOption(o: Pick<OptionToVerify, "kind" | "checks">): Verdict {
  if (o.kind === "technique" && o.checks.length === 0) return { ok: true };
  if (!o.checks.length) return { ok: false, reasons: ["nothing to buy was found for it"] };
  const reasons: string[] = [];
  for (const c of o.checks) {
    if (!c.product) reasons.push(`${c.part}: not found in the assortment`);
    else if (!c.rules.ok) reasons.push(`${c.part}: ${c.product.name} breaks a kitchen rule (${c.rules.reason ?? "rule"})`);
    else if (!c.arrival.ok) reasons.push(`${c.part}: ${c.product.name} cannot arrive (${c.arrival.why})`);
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

export type Rank = "best" | "better" | "good";
export type RankedOption = OptionToVerify & { rank: Rank; score: number };

/** How each option scores: its fidelity, less a little for extra work and for costing much more. */
export function optionScore(o: Pick<OptionToVerify, "fidelity" | "tradeoff" | "deltaCents" | "checks">): number {
  const base = o.checks.reduce((s, c) => s + (c.product?.totalCents ?? 0), 0) - (o.deltaCents ?? 0);
  const morePct = o.deltaCents !== null && base > 0 ? (o.deltaCents / base) * 100 : 0;
  const work = /^none|^less/.test(o.tradeoff.work) ? 0 : 0.05;
  const cost = morePct > 50 ? 0.15 : morePct > 15 ? 0.07 : 0;
  return Math.round((o.fidelity - work - cost) * 1000) / 1000;
}

/** The verified options, at most three, best first; the ones that failed verification are never returned. */
export function rankOptions(options: OptionToVerify[]): RankedOption[] {
  const ranks: Rank[] = ["best", "better", "good"];
  return options
    .filter((o) => verifyOption(o).ok)
    .map((o) => ({ ...o, score: optionScore(o) }))
    .sort((a, b) => b.score - a.score || a.optionId.localeCompare(b.optionId))
    .slice(0, 3)
    .map((o, i) => ({ ...o, rank: ranks[i] }));
}
