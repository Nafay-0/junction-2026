import { z } from "zod";
import { loadCatalogIndex, resolveCatalogIndex } from "@/server/valio/index-store";
import { resolveBuyer, type BuyerConstraints } from "./facts";
import { KnowledgeMap, type AlternativesOptions, type AlternativesResult, type RoleResult } from "./map";
import { loadKnowledgeFile, resolveKnowledgeFile, type KnowledgeSource } from "./store";
import { USES, type Use } from "./vocab";

/**
 * The knowledge map for the rest of the system. One instance per process, loaded on first use: the catalogue
 * index (partner data fields: claims, allergens, origin, pack) and the knowledge map file (model-written
 * profiles), each from a local file or the project's PostgreSQL. Without either, every call answers with
 * `available: false` and a reason; nothing throws.
 *
 *   const alt = await alternativesFor("460025", { use: "sauce", constraints: { requiredClaims: ["lactose_free"] } });
 *   const fit = await productsForRole("cream for carbonara", { constraints: { forbiddenAllergens: ["nuts"] } });
 */

export type KnowledgeStatus =
  | { available: true; products: number; builtAt: string; model: string; source: KnowledgeSource["from"] }
  | { available: false; reason: string };

type Loaded = { map: KnowledgeMap; status: Extract<KnowledgeStatus, { available: true }> } | { map: null; status: Extract<KnowledgeStatus, { available: false }> };

const g = globalThis as typeof globalThis & { __dockKnowledge?: Promise<Loaded> };

async function load(): Promise<Loaded> {
  try {
    const indexFile = await resolveCatalogIndex();
    const index = loadCatalogIndex(indexFile);
    if (!index) return { map: null, status: { available: false, reason: "no catalogue index (pnpm index:build, or index:publish for a deployed server)" } };
    const src = await resolveKnowledgeFile();
    if (src.from === "none") return { map: null, status: { available: false, reason: src.reason } };
    const data = loadKnowledgeFile(src.file);
    const map = new KnowledgeMap(index.index.products, data);
    return { map, status: { available: true, products: map.size, builtAt: data.builtAt, model: data.stats.model, source: src.from } };
  } catch (err) {
    return { map: null, status: { available: false, reason: err instanceof Error ? err.message.slice(0, 200) : "could not load the knowledge map" } };
  }
}

export function getKnowledgeMap(): Promise<KnowledgeMap | null> {
  g.__dockKnowledge ??= load();
  return g.__dockKnowledge.then((l) => l.map);
}

export async function knowledgeStatus(): Promise<KnowledgeStatus> {
  g.__dockKnowledge ??= load();
  return (await g.__dockKnowledge).status;
}

/** For tests: use this map instead of loading one. */
export function setKnowledgeMapForTests(map: KnowledgeMap | null): void {
  g.__dockKnowledge = Promise.resolve(map ? { map, status: { available: true, products: map.size, builtAt: map.builtAt, model: map.stats.model, source: "file" } } : { map: null, status: { available: false, reason: "disabled in a test" } });
}

/** A constraint word the data cannot check: refused, never passed (the routes answer 400). */
export type UnknownConstraints = { available: false; reason: string; unknownConstraints: { word: string; as: "claim" | "allergen" }[] };

function cannotVerify(unknown: UnknownConstraints["unknownConstraints"]): UnknownConstraints {
  return {
    available: false,
    reason: `Cannot verify ${unknown.map((u) => `${u.as === "claim" ? "the claim" : "the allergen"} "${u.word}"`).join(", ")}: no product data speaks of it. Use words such as lactose_free, gluten_free, vegan (claims) or milk, lactose, gluten, nuts, peanuts, eggs, fish, soy, sesame (allergens), in English, Finnish or Swedish.`,
    unknownConstraints: unknown,
  };
}

export type AlternativesAnswer = ({ available: true } & AlternativesResult) | { available: true; unknownProduct: string } | { available: false; reason: string } | UnknownConstraints;

/**
 * Ranked alternatives for one product in one use (default: its most typical use), every one checked against the
 * product's data and the buyer's constraints. `substitutes` are good/better/best stand-ins, never padded;
 * `packAlternatives` are the same product in other pack sizes; `none` says why there is no substitute.
 */
export async function alternativesFor(productId: string, opts: AlternativesOptions = {}): Promise<AlternativesAnswer> {
  const buyer = resolveBuyer(opts.constraints);
  if (buyer.unknown.length) return cannotVerify(buyer.unknown);
  const map = await getKnowledgeMap();
  if (!map) return { available: false, reason: ((await knowledgeStatus()) as { reason: string }).reason };
  const r = map.alternatives(productId, { ...opts, constraints: buyer.constraints });
  return r ? { available: true, ...r } : { available: true, unknownProduct: productId };
}

export type RoleAnswer = ({ available: true } & RoleResult) | { available: false; reason: string } | UnknownConstraints;

/** Products that fit a role described in free text ("cream for carbonara", "gluten-free flour for bread"). */
export async function productsForRole(text: string, opts: { constraints?: BuyerConstraints; limit?: number; uses?: Use[] } = {}): Promise<RoleAnswer> {
  const buyer = resolveBuyer(opts.constraints);
  if (buyer.unknown.length) return cannotVerify(buyer.unknown);
  const map = await getKnowledgeMap();
  if (!map) return { available: false, reason: ((await knowledgeStatus()) as { reason: string }).reason };
  return { available: true, ...map.forRole(text, { ...opts, constraints: buyer.constraints }) };
}

// ---------- query parsing shared by the routes ----------

const list = z
  .string()
  .max(400)
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim().toLowerCase().replace(/[\s-]+/g, "_"))
      .filter((x) => x.length >= 2 && x.length <= 40),
  );

export const AlternativesQuery = z.object({
  product: z.string().regex(/^[\w-]{1,32}$/),
  use: z.enum(USES).optional(),
  claims: list.optional(),
  allergens: list.optional(),
  max: z.coerce.number().int().min(1).max(10).optional(),
  debug: z.enum(["1", "true"]).optional(),
});

export const RoleQuery = z.object({
  q: z.string().min(2).max(200),
  claims: list.optional(),
  allergens: list.optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

export function constraintsOf(q: { claims?: string[]; allergens?: string[] }): BuyerConstraints | undefined {
  if (!q.claims?.length && !q.allergens?.length) return undefined;
  return { requiredClaims: q.claims, forbiddenAllergens: q.allergens };
}
