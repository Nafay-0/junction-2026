import type { IndexedProduct } from "@/core/catalog/partner";
import { fold, LexicalSearch } from "@/core/catalog/search";
import { hardCheck, protectedClaims, type AllergenEvidence, type BuyerConstraints, type HardCheck } from "./facts";
import type { KindDef, KnowledgeData, Profile } from "./types";
import { DISH_USES, FAMILY_BRIDGES, INHERENTLY_VEGAN, INHERENTLY_VEGETARIAN, USE_TEXT, USES, isUse, type Family, type Use } from "./vocab";

/**
 * The product knowledge map in memory: model-written profiles joined with the partner's data fields, and the
 * code that relates products to each other. Everything here is deterministic; no model is called.
 *
 * A relation is served only when (1) the hard facts allow it (facts.ts), (2) the two products are linked for the
 * stated use (same kind, same family, or a family bridge for that use, and the candidate is profiled for the use),
 * and (3) its confidence is at or above SERVE_THRESHOLD. A near-duplicate that differs only in pack size is a pack
 * alternative, kept apart from substitutes. Lists are never padded: one good substitute is returned as one.
 */

export type Tier = "best" | "better" | "good";

export type ChangeKind = "pack_size" | "fat" | "brand" | "origin" | "carbon" | "reliability" | "form" | "storage" | "kind" | "label" | "price";
export type Change = { kind: ChangeKind; text: string };

export type ConditionCode =
  | "will_not_whip"
  | "whipping_unknown"
  | "may_split_when_boiled"
  | "does_not_melt"
  | "sweetened"
  | "not_sweetened"
  | "flavoured"
  | "plain"
  | "frozen"
  | "not_frozen"
  | "powder"
  | "allergen_data_missing";
export type Condition = { code: ConditionCode; text: string };

export type Alternative = {
  productId: string;
  name: string;
  brand: string | null;
  kind: string;
  kindLabel: string;
  relation: "substitute" | "pack_alternative";
  tier: Tier;
  /** 0..1, from the scoring below; nothing under SERVE_THRESHOLD is served. */
  confidence: number;
  sameKind: boolean;
  /** One short factual sentence a buyer can read. */
  reason: string;
  changes: Change[];
  conditions: Condition[];
  /** What the hard-fact check established, from the data fields. */
  checks: { claimsKept: string[]; allergens: AllergenEvidence };
  /** The same product line in other pack sizes (substitutes are shown once per line). */
  otherPacks: string[];
  /** The wholesaler's own product file lists this as a substitute (shown, never used for ranking). */
  partnerListed: boolean;
};

export type Dropped = { productId: string; name: string; confidence: number | null; why: string };

export type AlternativesResult = {
  product: { id: string; name: string; kind: string | null; kindLabel: string | null; family: Family | null; uses: Use[]; claims: string[] };
  use: Use | null;
  substitutes: Alternative[];
  packAlternatives: Alternative[];
  /** Set when there are no substitutes: why, in plain words. */
  none?: string;
  threshold: number;
  /** Candidates that were considered and not served, best first (only with `debug`). */
  dropped?: Dropped[];
};

export type AlternativesOptions = {
  use?: Use;
  constraints?: BuyerConstraints;
  /** At most this many substitutes (default 5). Never padded. */
  max?: number;
  debug?: boolean;
  /** How many dropped candidates to report with `debug` (default 40). */
  debugLimit?: number;
  /** Comparison prices (cents per kg or l) the caller already has, to describe a price change. */
  comparisonPrices?: Record<string, { cents: number; unit: string }>;
};

export type RoleMatch = {
  productId: string;
  name: string;
  brand: string | null;
  kind: string;
  kindLabel: string;
  score: number;
  reason: string;
  otherPacks: string[];
  allergens: AllergenEvidence;
};

export type RoleResult = {
  query: string;
  uses: Use[];
  terms: string[];
  kinds: { kind: string; label: string; score: number }[];
  products: RoleMatch[];
  none?: string;
};

/**
 * Below this a relation is not served. Set from the evaluation (scripts/knowledge-eval.ts): at 0.55 a same-kind
 * product with one real difference (fat level, form, or a sweetened version) still passes, while a same-family
 * product of a different kind needs to suit the use with no condition against it. Relations that only share a
 * family and carry a condition (will not whip, splits when boiled) fall under it.
 */
export const SERVE_THRESHOLD = 0.55;
export const TIER_BEST = 0.82;
export const TIER_BETTER = 0.68;
export const MAX_SUBSTITUTES = 5;
const MAX_PACKS = 8;

const HEAT_USES = new Set<Use>(["sauce", "soup", "stew", "gratin", "pasta_dish", "baking"]);
const MELT_USES = new Set<Use>(["melting", "pizza", "gratin"]);
const SWEET_OK_USES = new Set<Use>(["dessert", "baking", "topping", "whipping", "coffee", "drinking", "breakfast", "smoothie", "porridge", "snack"]);
const DAIRY_LIKE = new Set<Family>(["milk", "cream", "plant_drink", "plant_cream", "yoghurt", "fermented_milk", "quark", "sour_cream", "cheese", "plant_cheese", "butter", "margarine_spread"]);

type Node = {
  p: IndexedProduct;
  profile: Profile;
  kind: KindDef;
  name: string;
  frozen: boolean;
  fat: number | null;
  /** litres or kilograms in one sales unit, when certain */
  content: { amount: number; unit: "L" | "kg" } | null;
  brandKey: string;
  nameKey: string;
  /** Words naming the ingredient itself, in every language the product has (produce and fish only). */
  ingredient: Set<string>;
};

/**
 * For these families the product is the ingredient: a kind such as "sliced vegetables" can hold carrot and onion,
 * which no cook swaps. Two of them must share an ingredient word (in any language) to be related.
 */
const INGREDIENT_FAMILIES = new Set<Family>(["vegetable", "fruit_berry", "herb_spice", "nuts_seeds", "dried_fruit", "legume", "fish", "seafood"]);
const NOT_INGREDIENT = new Set(
  "fresh frozen organic luomu sliced slices slice diced dice cube cubes cubed strips strip shredded grated whole chopped mix mixed pieces piece portions portion wavy thin thick fine very crinkle cut peeled washed cleaned raw cooked natural classic small big large mini baby extra premium red green yellow white black orange purple pink brown dark light box bag tray pack pcs kpl net ca app approx kg vac iqf greens valmix sallacarte bama fresh class cl ii iii fi finland suomi suomen kotimainen nl netherlands es spain it italy pl poland de germany fr france be belgium ma tn za pt pe ar cn china th dk se sweden no uk us tr eg il gr mx in au nz for with and the of in on from frozen pakaste pakastettu tuore finnish oy ab ltd viipale viipaleet viipaloitu kuutio kuutioitu suikale suikaleet raaste raastettu paloiteltu pala palat kokonainen kokonaisena siivu siivut rengas renkaat lohko lohkot murska sekoitus seos luomu kuorittu pesty skivad skivor tarnad strimlad riven hel fryst farsk bitar blandning ekologisk".split(" "),
);
/** A shared word, or one inside the other (compounds: watermelon / melon, jäävuorisalaatti / salaatti). */
function sharesIngredient(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) for (const y of b) if (x === y || (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)))) return true;
  return false;
}
const ingredientWords = (p: IndexedProduct): Set<string> => {
  const brand = new Set(tokens(`${p.brand ?? ""} ${p.vendor ?? ""}`));
  const words = [p.names.en, p.names.fi, p.names.sv].filter(Boolean).flatMap((n) => tokens(lineName(n!)));
  return new Set(words.filter((w) => w.length > 2 && !NOT_INGREDIENT.has(w) && !brand.has(w) && !/^\d/.test(w)).map((w) => (w.length > 5 && w.endsWith("s") ? w.slice(0, -1) : w)));
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number) => `${r1(n)}%`.replace(".0%", "%");
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const tokens = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((t) => t.length > 1);
function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** The name without pack size, counts and units, for spotting the same product line in another pack. */
function lineName(s: string): string {
  return tokens(s.replace(/\d+([.,]\d+)?\s*(x|%|kg|g|l|dl|cl|ml|pcs|pc|kpl|st)?\b/gi, " "))
    .filter((t) => !/^(x|kg|g|l|dl|cl|ml|pcs|pc|kpl|novobox|bag|box|uht|e\d*)$/.test(t))
    .join(" ");
}

function fatFromName(n: string): number | null {
  const m = /(\d{1,2}(?:[.,]\d)?)\s?%/.exec(n);
  if (!m) return null;
  const v = Number(m[1].replace(",", "."));
  return v >= 0 && v <= 90 ? v : null;
}

function contentOf(p: IndexedProduct): Node["content"] {
  const k = p.pack;
  if (!k.certain || !k.primary) return null;
  const amount = k.perSalesUnit[k.primary];
  return amount && amount > 0 ? { amount, unit: k.primary } : null;
}

const fmtContent = (c: NonNullable<Node["content"]>) =>
  c.unit === "L" ? (c.amount < 1 ? `${r1(c.amount * 10)} dl` : `${r1(c.amount)} l`) : c.amount < 1 ? `${Math.round(c.amount * 1000)} g` : `${r1(c.amount)} kg`;

export class KnowledgeMap {
  readonly builtAt: string;
  readonly stats: KnowledgeData["stats"];
  private readonly nodes = new Map<string, Node>();
  private readonly byFamily = new Map<Family, Node[]>();
  private readonly byKind = new Map<string, Node[]>();
  readonly kinds: Map<string, KindDef>;
  private readonly facts = new Map<string, IndexedProduct>();
  private search?: LexicalSearch;

  constructor(
    products: IndexedProduct[],
    data: KnowledgeData,
  ) {
    this.builtAt = data.builtAt;
    this.stats = data.stats;
    this.kinds = new Map(data.kinds.map((k) => [k.key, k]));
    for (const p of products) this.facts.set(p.id, p);
    for (const profile of data.profiles) {
      const p = this.facts.get(profile.id);
      const kind = this.kinds.get(profile.kind);
      if (!p || !kind) continue; // a profile for a product the catalogue no longer has is ignored
      const name = p.names.en ?? p.names.fi ?? p.names.sv ?? p.id;
      const node: Node = {
        p,
        profile,
        kind,
        name,
        frozen: p.temperature.class ? p.temperature.class === "frozen" : profile.state === "frozen",
        fat: p.fatPct ?? (DAIRY_LIKE.has(kind.family) ? fatFromName(name) : null),
        content: contentOf(p),
        brandKey: fold(p.brand ?? p.vendor ?? ""),
        nameKey: lineName(name),
        ingredient: INGREDIENT_FAMILIES.has(kind.family) ? ingredientWords(p) : new Set(),
      };
      this.nodes.set(p.id, node);
      const fam = this.byFamily.get(kind.family) ?? [];
      fam.push(node);
      this.byFamily.set(kind.family, fam);
      const kk = this.byKind.get(kind.key) ?? [];
      kk.push(node);
      this.byKind.set(kind.key, kk);
    }
  }

  get size(): number {
    return this.nodes.size;
  }

  profile(id: string): (Profile & { kindLabel: string; family: Family }) | undefined {
    const n = this.nodes.get(id);
    return n ? { ...n.profile, kindLabel: n.kind.label, family: n.kind.family } : undefined;
  }

  fact(id: string): IndexedProduct | undefined {
    return this.facts.get(id);
  }

  /** Products by name, for pickers. Master data only. */
  find(text: string, limit = 12): { id: string; name: string; kindLabel: string | null; uses: Use[] }[] {
    this.search ??= new LexicalSearch([...this.facts.values()]);
    return this.search.search({ text, limit }).map((h) => {
      const n = this.nodes.get(h.product.id);
      return { id: h.product.id, name: h.product.names.en ?? h.product.names.fi ?? h.product.id, kindLabel: n?.kind.label ?? null, uses: n?.profile.uses ?? [] };
    });
  }

  // ---------- alternatives for a product in a use ----------

  alternatives(productId: string, opts: AlternativesOptions = {}): AlternativesResult | undefined {
    const fact = this.facts.get(productId);
    if (!fact) return undefined;
    const o = this.nodes.get(productId);
    const max = Math.max(1, Math.min(opts.max ?? MAX_SUBSTITUTES, 10));
    const base = {
      product: {
        id: fact.id,
        name: fact.names.en ?? fact.names.fi ?? fact.id,
        kind: o?.kind.key ?? null,
        kindLabel: o?.kind.label ?? null,
        family: o?.kind.family ?? null,
        uses: o?.profile.uses ?? [],
        claims: protectedClaims(fact, o ? ctxOf(o.kind.family) : {}),
      },
      threshold: SERVE_THRESHOLD,
    };
    if (!o) return { ...base, use: opts.use ?? null, substitutes: [], packAlternatives: [], none: "This product has no profile in the knowledge map yet, so no alternative is suggested." };
    const use = opts.use ?? o.profile.uses[0];

    const pool = new Set<Node>(this.byFamily.get(o.kind.family) ?? []);
    for (const b of FAMILY_BRIDGES) if (b.families.includes(o.kind.family) && b.uses.includes(use)) for (const f of b.families) for (const n of this.byFamily.get(f) ?? []) pool.add(n);
    pool.delete(o);

    const scored: (Alternative & { _content: Node["content"]; _line: string })[] = [];
    const dropped: Dropped[] = [];
    const tally = new Map<string, number>();
    const drop = (n: Node, why: string, confidence: number | null, bucket: string) => {
      tally.set(bucket, (tally.get(bucket) ?? 0) + 1);
      if (opts.debug) dropped.push({ productId: n.p.id, name: n.name, confidence, why });
    };
    let linked = 0;

    for (const c of pool) {
      const link = this.link(o, c, use);
      if (!link.ok) continue; // not related for this use at all: not even counted
      linked++;
      const check = hardCheck(o.p, c.p, opts.constraints, ctxOf(o.kind.family));
      if (!check.ok) {
        drop(c, check.reason, null, check.code === "claim_missing" ? `not ${readableClaims(check.reason.replace(/^not /, "").replace(/ by its data$/, "").split(", ").map((x) => x.replace(/ /g, "_"))).join(", ")} by data` : check.code === "allergen_new" ? "add an allergen" : "lack allergen data");
        continue;
      }
      const s = this.score(o, c, use, link.how, check, opts.comparisonPrices);
      if (s.blocked) {
        drop(c, s.blocked, null, s.blocked);
        continue;
      }
      if (s.confidence < SERVE_THRESHOLD) {
        drop(c, `confidence ${s.confidence.toFixed(2)} under ${SERVE_THRESHOLD}: ${s.reason}`, s.confidence, "below the confidence threshold");
        continue;
      }
      const isPack = this.packVariant(o, c);
      scored.push({
        productId: c.p.id,
        name: c.name,
        brand: c.p.brand,
        kind: c.kind.key,
        kindLabel: c.kind.label,
        relation: isPack ? "pack_alternative" : "substitute",
        tier: tierOf(s.confidence, s.conditions.length, link.how === "kind"),
        confidence: Math.round(s.confidence * 100) / 100,
        sameKind: link.how === "kind",
        reason: s.reason,
        changes: s.changes,
        conditions: s.conditions,
        checks: { claimsKept: check.claimsKept, allergens: check.allergens },
        otherPacks: [],
        partnerListed: o.p.substitutes.includes(c.p.id),
        _content: c.content,
        _line: `${c.brandKey}|${c.kind.key}|${c.nameKey}`,
      });
    }

    const order = (a: { confidence: number; _content: Node["content"] }, b: { confidence: number; _content: Node["content"] }) =>
      b.confidence - a.confidence || packDistance(o.content, a._content) - packDistance(o.content, b._content);
    scored.sort(order);

    // One entry per product line: the other pack sizes of the same line ride along.
    const lines = new Map<string, (typeof scored)[number]>();
    for (const s of scored.filter((x) => x.relation === "substitute")) {
      const head = lines.get(s._line);
      if (head) head.otherPacks.push(s.productId);
      else lines.set(s._line, s);
    }
    const strip = ({ _content, _line, ...a }: (typeof scored)[number]): Alternative => (void _content, void _line, a);
    const substitutes = [...lines.values()].slice(0, max).map(strip);
    const packAlternatives = scored
      .filter((x) => x.relation === "pack_alternative")
      .sort((a, b) => packDistance(o.content, a._content) - packDistance(o.content, b._content))
      .slice(0, MAX_PACKS)
      .map(strip);

    const result: AlternativesResult = { ...base, use, substitutes, packAlternatives };
    if (!substitutes.length) result.none = noneReason(use, linked, tally, base.product.claims, opts.constraints);
    if (opts.debug) result.dropped = dropped.sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1)).slice(0, opts.debugLimit ?? 40);
    return result;
  }

  /** How two products are linked for a use, if at all. A shared category alone is never a link. */
  private link(o: Node, c: Node, use: Use): { ok: true; how: "kind" | "family" | "bridge" } | { ok: false } {
    const usable = c.profile.uses.includes(use);
    if (o.kind.key === c.kind.key) return { ok: true, how: "kind" };
    if (!usable) return { ok: false };
    if (o.kind.family === c.kind.family) return { ok: true, how: "family" };
    if (FAMILY_BRIDGES.some((b) => b.uses.includes(use) && b.families.includes(o.kind.family) && b.families.includes(c.kind.family))) return { ok: true, how: "bridge" };
    return { ok: false };
  }

  private packVariant(o: Node, c: Node): boolean {
    if (o.kind.key !== c.kind.key || !o.brandKey || o.brandKey !== c.brandKey || o.frozen !== c.frozen) return false;
    if (protectedClaims(o.p).join() !== protectedClaims(c.p).join()) return false;
    // The same name once pack sizes and counts are taken out: the same product, whatever the profile flags say.
    if (o.nameKey && o.nameKey === c.nameKey) return true;
    if (o.profile.form !== c.profile.form) return false;
    const flags = (n: Node) => [n.profile.whips, n.profile.heatStable, n.profile.melts, n.profile.sweetened, n.profile.flavoured].join();
    if (flags(o) !== flags(c)) return false;
    if ((o.fat === null) !== (c.fat === null) || (o.fat !== null && c.fat !== null && Math.abs(o.fat - c.fat) > 0.5)) return false;
    if (protectedClaims(o.p).join() !== protectedClaims(c.p).join()) return false;
    return o.nameKey === c.nameKey || jaccard(o.nameKey.split(" "), c.nameKey.split(" ")) >= 0.6;
  }

  private score(o: Node, c: Node, use: Use, how: "kind" | "family" | "bridge", check: Extract<HardCheck, { ok: true }>, prices?: AlternativesOptions["comparisonPrices"]) {
    const changes: Change[] = [];
    const conditions: Condition[] = [];
    const labelSim = jaccard(tokens(o.kind.label), tokens(c.kind.label));
    let s = how === "kind" ? 0.86 : how === "family" ? 0.64 + 0.12 * labelSim : 0.58 + 0.12 * labelSim;
    if (how !== "kind") changes.push({ kind: "kind", text: `${c.kind.label} instead of ${o.kind.label}` });
    if (INGREDIENT_FAMILIES.has(o.kind.family) && o.ingredient.size && c.ingredient.size && !sharesIngredient(o.ingredient, c.ingredient)) {
      return { blocked: "a different ingredient", confidence: 0, changes, conditions, reason: "" };
    }
    if (!c.profile.uses.includes(use)) s -= 0.12;
    s += 0.04 * jaccard(o.profile.uses, c.profile.uses);
    const P = o.profile;
    const Q = c.profile;

    if (use === "whipping") {
      if (Q.whips === false) return { blocked: "does not whip", confidence: 0, changes, conditions, reason: "" };
      if (Q.whips === null && P.whips === true) {
        s -= 0.15;
        conditions.push({ code: "whipping_unknown", text: "whipping not confirmed" });
      }
    } else if (P.whips === true && Q.whips === false && o.profile.uses.includes("whipping")) {
      conditions.push({ code: "will_not_whip", text: "will not whip" }); // said, not penalised: the use is not whipping
    }
    if (HEAT_USES.has(use) && P.heatStable !== false && Q.heatStable === false) {
      s -= 0.3;
      conditions.push({ code: "may_split_when_boiled", text: "may split if boiled" });
    }
    if (MELT_USES.has(use) && P.melts !== false && Q.melts === false) {
      if (use !== "gratin") return { blocked: "does not melt", confidence: 0, changes, conditions, reason: "" };
      s -= 0.3;
      conditions.push({ code: "does_not_melt", text: "does not melt smoothly" });
    }
    if (P.sweetened === false && Q.sweetened === true) {
      s -= SWEET_OK_USES.has(use) ? 0.15 : 0.35;
      conditions.push({ code: "sweetened", text: "sweetened" });
    } else if (P.sweetened === true && Q.sweetened === false) {
      s -= 0.12;
      conditions.push({ code: "not_sweetened", text: "not sweetened" });
    }
    if (P.flavoured === false && Q.flavoured === true) {
      s -= use === "dessert" ? 0.2 : 0.4;
      conditions.push({ code: "flavoured", text: "flavoured" });
    } else if (P.flavoured === true && Q.flavoured === false) {
      s -= 0.12;
      conditions.push({ code: "plain", text: "plain, not flavoured" });
    }
    if (o.frozen !== c.frozen) {
      s -= 0.15;
      conditions.push(c.frozen ? { code: "frozen", text: "frozen: plan thawing time" } : { code: "not_frozen", text: "not frozen: shorter shelf life" });
    }
    const fresh = (x: Profile) => x.state === "fresh";
    if (!o.frozen && !c.frozen && fresh(P) !== fresh(Q) && (fresh(P) ? Q.state === "shelf_stable" || Q.state === "dried" : P.state === "shelf_stable" || P.state === "dried")) {
      s -= 0.15;
      changes.push({ kind: "storage", text: fresh(Q) ? "fresh instead of preserved" : `${Q.state.replace("_", "-")} instead of fresh` });
    }
    // Closeness within a kind: the same line name, maker and origin are the nearest stand-in.
    s += 0.06 * jaccard(o.nameKey.split(" "), c.nameKey.split(" "));
    if (o.brandKey && o.brandKey === c.brandKey) s += 0.02;
    if (o.p.countryOfOrigin && o.p.countryOfOrigin === c.p.countryOfOrigin) s += 0.02;
    if (P.form !== Q.form) {
      const powder = (f: string) => f === "powder" || f === "granules";
      if (powder(P.form) !== powder(Q.form)) {
        s -= 0.3;
        conditions.push({ code: "powder", text: powder(Q.form) ? "a powder: needs mixing" : "ready liquid instead of powder" });
      } else s -= 0.1;
      changes.push({ kind: "form", text: `${Q.form} instead of ${P.form}` });
    }
    if (o.fat !== null && c.fat !== null) {
      const d = Math.abs(o.fat - c.fat);
      const rel = d / Math.max(o.fat, c.fat, 1);
      if (d >= 0.5) changes.push({ kind: "fat", text: `fat ${pct(o.fat)} → ${pct(c.fat)}` });
      // Fat decides whether cream whips; in a sauce or a soup it changes richness, not whether it works.
      if (d >= 1 && rel > 0.15) s -= use === "whipping" ? Math.min(0.3, 0.35 * rel) : Math.min(0.15, 0.2 * rel);
    }
    if (o.content && c.content && o.content.unit === c.content.unit) {
      const ratio = Math.max(o.content.amount, c.content.amount) / Math.min(o.content.amount, c.content.amount);
      if (ratio > 1.05) {
        changes.push({ kind: "pack_size", text: `pack ${fmtContent(o.content)} → ${fmtContent(c.content)}` });
        s -= Math.min(0.08, 0.02 * Math.log2(ratio));
      }
    } else if (c.p.pack.label && o.p.pack.label && c.p.pack.label !== o.p.pack.label) {
      changes.push({ kind: "pack_size", text: `pack ${c.p.pack.label}` });
    }
    const org = (n: Node) => n.p.claims.includes("organic");
    if (org(o) !== org(c)) changes.push({ kind: "label", text: org(c) ? "organic" : "not organic" });
    if (o.brandKey !== c.brandKey && c.p.brand) changes.push({ kind: "brand", text: `brand ${c.p.brand}` });
    if (c.p.countryOfOrigin && o.p.countryOfOrigin !== c.p.countryOfOrigin) changes.push({ kind: "origin", text: `origin ${c.p.countryOfOrigin.toUpperCase()}` });
    const co = o.p.carbonGroupAvgKgCo2ePerKg;
    const cc = c.p.carbonGroupAvgKgCo2ePerKg;
    if (co !== null && cc !== null && Math.abs(co - cc) / Math.max(co, cc) > 0.1) changes.push({ kind: "carbon", text: `carbon ${r1(co)} → ${r1(cc)} kg CO2e/kg (group average)` });
    if (c.p.deliveryReliability !== null && c.p.deliveryReliability < 0.9) {
      s -= 0.05;
      changes.push({ kind: "reliability", text: `delivered in full ${Math.round(c.p.deliveryReliability * 100)}% of the time` });
    }
    const po = prices?.[o.p.id];
    const pc = prices?.[c.p.id];
    if (po && pc && po.unit === pc.unit && po.cents > 0) {
      const d = (pc.cents - po.cents) / po.cents;
      if (Math.abs(d) >= 0.05) changes.push({ kind: "price", text: `${Math.round(Math.abs(d) * 100)}% ${d > 0 ? "dearer" : "cheaper"} per ${pc.unit.toLowerCase()}` });
    }
    if (check.allergens === "unknown") {
      s -= 0.05;
      conditions.push({ code: "allergen_data_missing", text: "no allergen data for either product: check the label" });
    }
    const confidence = clamp01(s);
    return { blocked: undefined, confidence, changes, conditions, reason: reasonText(o, c, use, how, changes, conditions, check) };
  }

  // ---------- products for a role, from free text ----------

  forRole(text: string, opts: { constraints?: BuyerConstraints; limit?: number; uses?: Use[] } = {}): RoleResult {
    const limit = Math.max(1, Math.min(opts.limit ?? 6, 20));
    const words = tokens(text);
    const uses = new Set<Use>(opts.uses ?? []);
    const terms: string[] = [];
    for (const w of words) {
      const dish = DISH_USES[w] ?? (w.endsWith("s") ? DISH_USES[w.slice(0, -1)] : undefined);
      if (dish) {
        for (const u of dish) uses.add(u);
        continue;
      }
      if (isUse(w)) {
        uses.add(w);
        continue;
      }
      if (!STOP.has(w)) terms.push(w);
    }
    const useList = [...uses];
    const res: RoleResult = { query: text, uses: useList, terms, kinds: [], products: [] };
    if (!terms.length) {
      res.none = "Say which ingredient (cream, cheese, flour, …); the dish alone does not pick a product.";
      return res;
    }

    // Kinds whose label, aliases or family match the ingredient words.
    const kindScores: { k: KindDef; score: number }[] = [];
    for (const k of this.kinds.values()) {
      const hay = [...tokens(k.label), ...k.aliases.flatMap(tokens), ...tokens(k.family.replace(/_/g, " "))];
      let sc = 0;
      for (const t of terms) {
        let best = 0;
        for (const h of hay) {
          if (h === t || (t.length > 3 && (h === `${t}s` || t === `${h}s`))) best = Math.max(best, 1);
          else if (t.length >= 4 && h.length >= 4 && (h.startsWith(t) || t.startsWith(h) || h.endsWith(t))) best = Math.max(best, 0.6);
        }
        sc += best;
      }
      if (sc > 0) kindScores.push({ k, score: sc / terms.length });
    }
    kindScores.sort((a, b) => b.score - a.score);
    const top = kindScores.length ? kindScores[0].score : 0;
    const chosen = kindScores.filter((x) => x.score >= Math.max(0.5, top * 0.75));
    res.kinds = chosen.slice(0, 12).map((x) => ({ kind: x.k.key, label: x.k.label, score: Math.round(x.score * 100) / 100 }));
    if (!chosen.length) {
      res.none = `No kind of product in the assortment matches “${terms.join(" ")}”.`;
      return res;
    }

    const matches: (RoleMatch & { _line: string })[] = [];
    let excluded = 0;
    for (const { k, score } of chosen) {
      for (const n of this.byKind.get(k.key) ?? []) {
        let useFit = 1;
        if (useList.length) {
          const pos = Math.min(...useList.map((u) => (n.profile.uses.indexOf(u) < 0 ? 99 : n.profile.uses.indexOf(u))));
          if (pos === 99) continue; // not used for this dish
          useFit = 1 - pos * 0.1;
        }
        const c = opts.constraints;
        if (c?.requiredClaims?.some((x) => !n.p.claims.includes(x))) {
          excluded++;
          continue;
        }
        if (c?.forbiddenAllergens?.length && (!n.p.allergens.declared || c.forbiddenAllergens.some((a) => n.p.allergens.contains.includes(a) || n.p.allergens.mayContain.includes(a)))) {
          excluded++;
          continue;
        }
        let prop = 0;
        const why: string[] = [`${k.label}`];
        if (useList.length) why.push(`suits ${useList.map((u) => USE_TEXT[u]).join(", ")}`);
        if (useList.some((u) => HEAT_USES.has(u))) {
          if (n.profile.heatStable === true) (prop += 0.1), why.push("holds up when boiled");
          if (n.profile.heatStable === false) prop -= 0.3;
        }
        if (useList.includes("whipping")) {
          if (n.profile.whips === true) prop += 0.1;
          else if (n.profile.whips === false) continue;
        }
        if (useList.some((u) => MELT_USES.has(u))) {
          if (n.profile.melts === true) (prop += 0.1), why.push("melts");
          else if (n.profile.melts === false) prop -= 0.3;
        }
        if (n.profile.flavoured === true && !terms.some((t) => fold(n.name).includes(t))) prop -= 0.15;
        matches.push({
          productId: n.p.id,
          name: n.name,
          brand: n.p.brand,
          kind: k.key,
          kindLabel: k.label,
          score: Math.round((0.55 * score + 0.35 * useFit + prop) * 100) / 100,
          reason: why.join("; "),
          otherPacks: [],
          allergens: n.p.allergens.declared ? "verified" : "unknown",
          _line: `${n.brandKey}|${k.key}|${n.nameKey}`,
        });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    const lines = new Map<string, (typeof matches)[number]>();
    for (const m of matches) {
      const head = lines.get(m._line);
      if (head) head.otherPacks.push(m.productId);
      else lines.set(m._line, m);
    }
    res.products = [...lines.values()].slice(0, limit).map(({ _line, ...m }) => (void _line, m));
    if (!res.products.length)
      res.none = excluded
        ? `${excluded} product(s) of the matching kinds suit this, but none meets the dietary and allergen requirements by its data.`
        : `None of the matching kinds (${res.kinds.map((k) => k.label).join(", ")}) is profiled for ${useList.map((u) => USE_TEXT[u]).join(", ")}.`;
    return res;
  }
}

const ctxOf = (f: Family) => ({ inherentlyVegetarian: INHERENTLY_VEGETARIAN.includes(f), inherentlyVegan: INHERENTLY_VEGAN.includes(f) });

const STOP = new Set(["for", "in", "the", "a", "an", "to", "of", "with", "and", "or", "my", "our", "some", "that", "use", "used", "using", "making", "make", "ja", "tai", "varten", "kanssa", "need", "want", "like", "good", "best", "which", "what"]);

function packDistance(a: Node["content"], b: Node["content"]): number {
  if (!a || !b || a.unit !== b.unit) return 5;
  return Math.abs(Math.log2(b.amount / a.amount));
}

function tierOf(confidence: number, conditions: number, sameKind: boolean): Tier {
  if (confidence >= TIER_BEST && conditions === 0 && sameKind) return "best";
  if (confidence >= TIER_BETTER) return "better";
  return "good";
}

function reasonText(o: Node, c: Node, use: Use, how: "kind" | "family" | "bridge", changes: Change[], conditions: Condition[], check: Extract<HardCheck, { ok: true }>): string {
  const head = how === "kind" ? `Same kind (${c.kind.label})` : `${cap(c.kind.label)} for ${USE_TEXT[use]}`;
  const parts = changes.filter((x) => x.kind !== "kind" && x.kind !== "carbon" && x.kind !== "origin").map((x) => x.text);
  const cond = conditions.filter((x) => x.code !== "allergen_data_missing").map((x) => x.text);
  const kept = check.claimsKept.length ? `still ${readableClaims(check.claimsKept).join(", ")}` : "";
  return [head, ...parts, ...cond, kept].filter(Boolean).join("; ") + ".";
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Claims for reading: lactose-free already says low-lactose, vegan already says vegetarian. */
export function readableClaims(claims: string[]): string[] {
  const s = new Set(claims);
  if (s.has("lactose_free")) s.delete("low_lactose");
  if (s.has("vegan")) s.delete("vegetarian");
  return [...s].sort().map((x) => x.replace(/_/g, "-"));
}

function noneReason(use: Use, linked: number, tally: Map<string, number>, claims: string[], buyer?: BuyerConstraints): string {
  const need = readableClaims([...claims, ...(buyer?.requiredClaims ?? [])]);
  if (!linked) return `Nothing else in the assortment is used for ${USE_TEXT[use]} the way this product is.`;
  const parts = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([why, n]) => `${n} ${why}`);
  const req = need.length ? ` that is also ${need.join(", ")}` : "";
  return `No substitute for ${USE_TEXT[use]}${req}: of ${linked} related product${linked === 1 ? "" : "s"}, ${parts.join(", ")}.`;
}

export { USES };
