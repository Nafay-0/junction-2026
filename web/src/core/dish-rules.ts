/**
 * Two plain-code checks on a dish as the planner drafted it, before anything is bought. No model, no I/O.
 *
 *   definingConflict   a dish whose defining ingredient breaks one of the kitchen's rules (fish fingers in a kitchen
 *                      that forbids fish; pesto pasta with salmon there). The dish is refused as a whole, with the rule
 *                      named: it is never planned with the ingredient quietly taken out under the same name.
 *   missingEssentials  a recipe that cannot be made as written: a cake with no flour (or a flour substitute) or no
 *                      sweetener, pancakes with no flour, milk or egg, mash with no potato, porridge with no grain. The
 *                      planner adds what is missing as visible lines with a standard amount to check.
 */

/** Words (lower-case stems, English, Finnish, Swedish) that make a dish name or an ingredient this allergen. */
export const ALLERGEN_WORDS: Record<string, { words: string[]; not?: string[] }> = {
  fish: {
    words: ["fish", "kala", "lohi", "lohta", "salmon", "lax", "fisk", "tuna", "tonnikal", "cod", "turska", "seiti", "saithe", "pollock", "herring", "silakk", "silli", "sill", "muikku", "anchov", "sardiini", "sardin", "kirjolohi", "trout", "regnbåg", "ahven", "kuha", "zander", "hauki", "pike", "mackerel", "makrill", "makriil", "siika", "whitefish", "sik ", "haddock", "kolja", "plaice", "kampela", "surimi"],
    not: ["kalapuikko kasvis", "vegan fish", "fishless", "kalaton"],
  },
  crustaceans: { words: ["shrimp", "prawn", "katkarap", "räk", "crayfish", "rapu", "ravu", "kräft", "lobster", "hummeri", "crab", "rapu", "taskurapu"] },
  molluscs: { words: ["mussel", "simpuk", "musslor", "squid", "kalmari", "calamari", "oyster", "osteri", "clam"] },
  peanuts: { words: ["peanut", "maapähkin", "jordnöt", "satay"] },
  nuts: { words: ["walnut", "saksanpähkin", "hazelnut", "hasselpähkin", "almond", "manteli", "mandel", "cashew", "cashewpähkin", "pistach", "pecan", "pekaani", "macadamia", "nutella", "pähkinä", "nötter", "nut "], not: ["nutmeg", "muskott", "coconut", "kookos", "butternut", "peanut", "maapähkin"] },
  sesame: { words: ["sesam", "seesam", "tahini", "tahin"] },
  eggs: { words: ["egg", "muna", "ägg", "omelet", "munakas", "frittata", "mayonnaise", "majonee", "meringue", "marenki"], not: ["eggplant", "munakoiso", "äggplanta", "eggless", "munaton"] },
};

const lowered = (s: string) => ` ${s.toLowerCase()} `;

/** The forbidden allergen a name says it is made of, or undefined. */
export function allergenInName(name: string, forbidden: readonly string[]): string | undefined {
  const hay = lowered(name);
  for (const a of forbidden) {
    const w = ALLERGEN_WORDS[a === "tree_nuts" ? "nuts" : a];
    if (!w) continue;
    if (w.not?.some((x) => hay.includes(x))) continue;
    // At the start of a word: "kalapuikot" is fish, "fusilli" is not herring ("sill"), "cod" is not in "coda".
    if (w.words.some((x) => new RegExp(`(?<![a-zåäö])${x.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(hay))) return a;
  }
  return undefined;
}

export type DishLike = { name: string; nameFi?: string | null; course?: string; ingredients: { key: string; name: string; searchTerms: string[]; role?: string }[] };
export type Rule = { text: string; source: string };
export type DefiningConflict = { allergen: string; ingredient: string; rule: Rule };

/** "main protein", "the fish", or the ingredient named in the dish's own name: what the dish is. */
function defining(ing: DishLike["ingredients"][number], dishName: string): boolean {
  if (/\b(main|protein|defining|star|the fish|the meat|centre|keskeinen|pää)/i.test(ing.role ?? "")) return true;
  const dish = lowered(dishName);
  return [ing.name, ...ing.searchTerms].flatMap((t) => t.toLowerCase().split(/[^a-zåäö]+/u)).some((w) => w.length >= 4 && dish.includes(w.slice(0, Math.max(4, w.length - 2))));
}

/**
 * Whether a dish is made of something the kitchen forbids: its name says so (whatever the draft kept), or one of its
 * defining ingredients does. `rules` are the kitchen's rules in words, each with where it comes from; the rule that
 * names the allergen travels with the refusal, or a rule made from the allergen when none names it.
 */
export function definingConflict(dish: DishLike, forbidden: readonly string[], rules: readonly Rule[]): DefiningConflict | undefined {
  const names = [dish.name, dish.nameFi ?? ""].join(" | ");
  let allergen = allergenInName(names, forbidden);
  let ingredient = allergen ? (dish.ingredients.find((i) => allergenInName([i.name, ...i.searchTerms].join(" "), [allergen!]))?.name ?? wordFor(names, allergen)) : undefined;
  if (!allergen) {
    for (const ing of dish.ingredients) {
      if (!defining(ing, names)) continue;
      const a = allergenInName([ing.name, ...ing.searchTerms].join(" "), forbidden);
      if (a) {
        allergen = a;
        ingredient = ing.name;
        break;
      }
    }
  }
  if (!allergen || !ingredient) return undefined;
  return { allergen, ingredient, rule: ruleFor(allergen, rules) };
}

function wordFor(names: string, allergen: string): string {
  const hay = names.toLowerCase();
  const w = ALLERGEN_WORDS[allergen]?.words.find((x) => hay.includes(x));
  return w ? (hay.split(/[^a-zåäö]+/u).find((t) => t.includes(w.trim())) ?? w.trim()) : allergen;
}

const ALLERGEN_RULE_WORDS: Record<string, RegExp> = {
  fish: /fish|kala|fisk/i,
  nuts: /\bnut|pähkin|nöt/i,
  peanuts: /peanut|maapähkin|jordnöt/i,
  sesame: /sesam|seesam/i,
  eggs: /\begg|muna|ägg/i,
  crustaceans: /crustacean|shellfish|äyriäi|kräft/i,
  molluscs: /mollusc|nilviäi/i,
};

/** The kitchen's rule that forbids this allergen, as its people wrote it, with its source. */
export function ruleFor(allergen: string, rules: readonly Rule[]): Rule {
  const re = ALLERGEN_RULE_WORDS[allergen] ?? new RegExp(allergen.replace(/_/g, " "), "i");
  return rules.find((r) => re.test(r.text) && !/may contain only/i.test(r.text)) ?? { text: `No ${allergen.replace(/_/g, " ")}`, source: "the kitchen's rules" };
}

// ---------- a recipe that can be made ----------

/** What one kind of dish cannot be made without: each need is met by any of its words in an ingredient. */
type Need = { what: string; words: string[]; add: { key: string; name: string; searchTerms: string[]; perCover: { amount: number; unit: "g" | "ml" | "pcs" }; role: string; form: "any" | "fresh" | "dried" } };
type DishKind = { kind: string; match: RegExp; not?: RegExp; needs: Need[] };

const FLOUR: Need = { what: "flour or a flour substitute", words: ["flour", "jauho", "mjöl", "starch", "tärkkel", "stärkelse", "almond meal", "mantelijauho", "ground almond", "oats", "kaura", "breadcrumb", "korppujauho", "biscuit", "keksi", "kex", "semolina", "manna", "flour mix", "jauhoseos"], add: { key: "wheat_flour", name: "Wheat flour", searchTerms: ["vehnäjauho", "wheat flour"], perCover: { amount: 25, unit: "g" }, role: "structure of the cake", form: "dried" } };
const SWEET: Need = { what: "a sweetener", words: ["sugar", "sokeri", "socker", "honey", "hunaja", "syrup", "siirappi", "sirap", "sweetener", "makeutus", "sötningsmedel", "condensed milk", "maitotiiviste", "jam", "hillo", "sylt", "dates", "taateli"], add: { key: "sugar", name: "Sugar", searchTerms: ["sokeri", "sugar"], perCover: { amount: 20, unit: "g" }, role: "sweetness of the cake", form: "dried" } };

export const DISH_KINDS: DishKind[] = [
  { kind: "cake", match: /cake|kakku|torte|tårta|torttu|brownie|muffin|cupcake|sponge|leivos/i, not: /cheesecake no.?bake|raw cake|raakakakku|fish cake|kalakakku|crab cake|potato cake|perunakakku|rice cake|riisikakku|pannukak|pancake|pannkak/i, needs: [FLOUR, SWEET] },
  { kind: "pancake", match: /pancake|pannukak|crêpe|crepe|lettu|ohukai|plätt|pannkak/i, needs: [{ ...FLOUR, add: { ...FLOUR.add, perCover: { amount: 30, unit: "g" }, role: "batter" } }, { what: "milk or a milk substitute", words: ["milk", "maito", "mjölk", "drink", "juoma", "dryck", "cream", "kerma"], add: { key: "milk", name: "Milk", searchTerms: ["maito", "milk"], perCover: { amount: 80, unit: "ml" }, role: "batter liquid", form: "any" } }, { what: "egg or an egg substitute", words: ["egg", "muna", "ägg", "aquafaba"], add: { key: "egg", name: "Egg", searchTerms: ["kananmuna", "egg"], perCover: { amount: 0.5, unit: "pcs" }, role: "binds the batter", form: "fresh" } }] },
  { kind: "mash", match: /mash|muusi|mos\b|potatismos|puree of potato|perunasose/i, not: /pea mash|hernemuusi|bean mash|cauliflower|kukkakaali|swede|lanttu|root vegetable|juures|carrot|porkkana|celeriac|selleri/i, needs: [{ what: "potato", words: ["potato", "peruna", "potatis", "perunahiutale", "potato flake", "potatismos"], add: { key: "potato", name: "Potato", searchTerms: ["peruna", "potato"], perCover: { amount: 200, unit: "g" }, role: "the mash itself", form: "fresh" } }] },
  { kind: "porridge", match: /porridge|puuro|gröt\b/i, needs: [{ what: "a grain", words: ["oat", "kaura", "havre", "rice", "riisi", "ris", "barley", "ohra", "korn", "rye", "ruis", "råg", "semolina", "manna", "millet", "hirssi", "quinoa", "flake", "hiutale", "gryn"], add: { key: "oat_flakes", name: "Oat flakes", searchTerms: ["kaurahiutale", "oat flakes"], perCover: { amount: 40, unit: "g" }, role: "the porridge itself", form: "dried" } }] },
  { kind: "bread", match: /\bbread|leipä|bröd|\bbun\b|sämpylä|bulle|scone|rieska|focaccia/i, not: /bread crumb|korppujauho|bread sauce|bread pudding|leipäjuusto|french toast|köyhät ritarit|garlic bread/i, needs: [FLOUR] },
];

export type Missing = { kind: string; what: string; add: Need["add"] };

/** What a dish of a known kind cannot be made without and the draft does not have (struck staples count as there). */
export function missingEssentials(dish: DishLike): Missing[] {
  const names = [dish.name, dish.nameFi ?? ""].join(" | ");
  const kind = DISH_KINDS.find((k) => k.match.test(names) && !k.not?.test(names));
  if (!kind) return [];
  const hay = lowered(dish.ingredients.map((i) => [i.key.replace(/_/g, " "), i.name, ...i.searchTerms].join(" ")).join(" | "));
  return kind.needs.filter((n) => !n.words.some((w) => hay.includes(w))).map((n) => ({ kind: kind.kind, what: n.what, add: n.add }));
}
