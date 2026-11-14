import { FAMILIES, FORMS, STATES, USES, isUse, type Family, type Form, type ProductState, type Use } from "./vocab";

/**
 * The product knowledge map as stored: kinds per partner category and one profile per product, all model output
 * that passed validation. It holds no dietary claim, allergen, origin, label or nutrition figure: those are joined
 * from the catalogue index (the partner's data fields) when the map is loaded, so they can never come from a model.
 */

export const KNOWLEDGE_VERSION = 1;

export type KindDef = {
  /** `<category code>.<slug>`: unique across the assortment. */
  key: string;
  category: string;
  slug: string;
  label: string;
  family: Family;
  aliases: string[];
};

export type Profile = {
  id: string;
  kind: string;
  form: Form;
  state: ProductState;
  whips: boolean | null;
  heatStable: boolean | null;
  melts: boolean | null;
  sweetened: boolean | null;
  flavoured: boolean | null;
  /** Most typical first. */
  uses: Use[];
};

export type KnowledgeStats = {
  products: number;
  profiled: number;
  kinds: number;
  categories: number;
  model: string;
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
};

export type KnowledgeData = {
  version: typeof KNOWLEDGE_VERSION;
  builtAt: string;
  stats: KnowledgeStats;
  kinds: KindDef[];
  profiles: Profile[];
};

// ---------- compact file format ----------

export type KnowledgeFile = {
  format: "dock-knowledge-map";
  version: typeof KNOWLEDGE_VERSION;
  builtAt: string;
  stats: KnowledgeStats;
  kinds: [string, string, string, string, string][]; // key, category, slug, label, family; aliases in kindAliases
  kindAliases: string[];
  /** [id, kind index, form, state, flags (whips heat melts sweet flavour as t/f/-), uses joined by |] */
  rows: [string, number, string, string, string, string][];
};

const FLAG = (b: boolean | null) => (b === true ? "t" : b === false ? "f" : "-");
const UNFLAG = (c: string | undefined): boolean | null => (c === "t" ? true : c === "f" ? false : null);

export function encodeKnowledge(d: KnowledgeData): KnowledgeFile {
  const idx = new Map(d.kinds.map((k, i) => [k.key, i]));
  return {
    format: "dock-knowledge-map",
    version: KNOWLEDGE_VERSION,
    builtAt: d.builtAt,
    stats: d.stats,
    kinds: d.kinds.map((k) => [k.key, k.category, k.slug, k.label, k.family]),
    kindAliases: d.kinds.map((k) => k.aliases.join("|")),
    rows: d.profiles
      .filter((p) => idx.has(p.kind))
      .map((p) => [p.id, idx.get(p.kind)!, p.form, p.state, [p.whips, p.heatStable, p.melts, p.sweetened, p.flavoured].map(FLAG).join(""), p.uses.join("|")]),
  };
}

export function isKnowledgeFile(x: unknown): x is KnowledgeFile {
  const f = x as Partial<KnowledgeFile> | null;
  return !!f && f.format === "dock-knowledge-map" && f.version === KNOWLEDGE_VERSION && Array.isArray(f.kinds) && Array.isArray(f.rows);
}

const isOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

/** Restore the map. Rows or kinds that do not have the expected shape are dropped, never guessed. */
export function decodeKnowledge(f: KnowledgeFile): KnowledgeData {
  const kinds: (KindDef | undefined)[] = f.kinds.map((k, i) => {
    if (!Array.isArray(k) || k.length !== 5 || !isOf(FAMILIES, k[4])) return undefined;
    const aliases = typeof f.kindAliases?.[i] === "string" && f.kindAliases[i] ? f.kindAliases[i].split("|") : [];
    return { key: String(k[0]), category: String(k[1]), slug: String(k[2]), label: String(k[3]), family: k[4], aliases };
  });
  const profiles: Profile[] = [];
  for (const r of f.rows) {
    if (!Array.isArray(r) || r.length !== 6) continue;
    const kind = kinds[r[1]];
    if (!kind || !isOf(FORMS, r[2]) || !isOf(STATES, r[3]) || typeof r[4] !== "string") continue;
    const uses = String(r[5]).split("|").filter(isUse);
    profiles.push({
      id: String(r[0]),
      kind: kind.key,
      form: r[2],
      state: r[3],
      whips: UNFLAG(r[4][0]),
      heatStable: UNFLAG(r[4][1]),
      melts: UNFLAG(r[4][2]),
      sweetened: UNFLAG(r[4][3]),
      flavoured: UNFLAG(r[4][4]),
      uses,
    });
  }
  return { version: KNOWLEDGE_VERSION, builtAt: f.builtAt, stats: f.stats, kinds: kinds.filter((k): k is KindDef => !!k), profiles };
}

/** Validate one model answer for a product against the vocabulary and the category's kinds. */
export function profileFromAnswer(
  a: { id: string; kind: string; form: string; state: string; whips: boolean | null; heat_stable: boolean | null; melts: boolean | null; sweetened: boolean | null; flavoured: boolean | null; uses: string[] },
  category: string,
  kindSlugs: Set<string>,
): Profile | undefined {
  if (!kindSlugs.has(a.kind) || !isOf(FORMS, a.form) || !isOf(STATES, a.state)) return undefined;
  const b = (v: unknown) => (v === true ? true : v === false ? false : null);
  const uses = [...new Set((a.uses ?? []).filter(isUse))].slice(0, 6);
  if (!uses.length) return undefined;
  return { id: a.id, kind: `${category}.${a.kind}`, form: a.form, state: a.state, whips: b(a.whips), heatStable: b(a.heat_stable), melts: b(a.melts), sweetened: b(a.sweetened), flavoured: b(a.flavoured), uses };
}

export const USE_LIST: readonly Use[] = USES;
