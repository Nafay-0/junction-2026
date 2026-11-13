import type { Pool } from "pg";

/**
 * Semantic matching for recall, where the request's words differ from the memory's ("puuro" against "porridge",
 * "breakfast buffet" against "aamiainen"). Two embedders and two stores:
 *
 *   LexicalEmbedder   in process, no network: multilingual food concepts, word stems and character trigrams
 *                     hashed into 512 dimensions. Deterministic; the default for tests and laptops.
 *   OpenAIEmbedder    text-embedding-3-small ($0.02 per million tokens) when DOCK_MEMORY_EMBEDDINGS=openai.
 *   InMemoryIndex     per kitchen, in a Map keyed by org id.
 *   PgVectorIndex     the project's PostgreSQL with the vector extension (DOCK_MEMORY_VECTORS=pg): one table,
 *                     every query filtered by org id, so one kitchen's vectors are never searched for another.
 */

export interface Embedder {
  id: string;
  dims: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface MemoryIndex {
  upsert(orgId: string, items: { id: string; text: string }[]): Promise<void>;
  remove(orgId: string, ids: string[]): Promise<void>;
  search(orgId: string, text: string, k: number): Promise<{ id: string; score: number }[]>;
}

/** Concepts a kitchen names in Finnish, Swedish or English. Each word maps to its concept, so wording can differ. */
const CONCEPTS: Record<string, string[]> = {
  milk: ["milk", "maito", "mjölk", "mjolk", "dairy"],
  oat: ["oat", "oats", "kaura", "havre", "oatly"],
  porridge: ["porridge", "puuro", "gröt", "grot", "oatmeal"],
  yoghurt: ["yoghurt", "yogurt", "jogurtti", "jugurt", "yoghurtti"],
  cream: ["cream", "kerma", "grädde", "gradde"],
  butter: ["butter", "voi", "smör", "smor"],
  cheese: ["cheese", "juusto", "ost"],
  egg: ["egg", "eggs", "muna", "kananmuna", "ägg"],
  nut: ["nut", "nuts", "pähkinä", "pahkina", "nöt", "almond", "hazelnut", "cashew", "walnut", "peanut", "maapähkinä"],
  lactose: ["lactose", "laktoositon", "laktoos", "laktosfri", "hyla", "lactosefree"],
  gluten: ["gluten", "gluteeniton", "gluteeni", "glutenfri", "coeliac", "celiac", "keliakia"],
  vegan: ["vegan", "vegaani", "vegaaninen", "plant", "kasvi"],
  breakfast: ["breakfast", "aamiainen", "aamupala", "frukost", "buffet"],
  lunch: ["lunch", "lounas", "ruokailu"],
  morning: ["morning", "mornings", "aamu", "aamulla", "aamuisin", "morgon"],
  school: ["school", "koulu", "skola", "päiväkoti", "daycare", "kindergarten", "pupils", "children", "lapset"],
  delivery: ["delivery", "deliver", "toimitus", "leverans", "receive", "receiving", "vastaanotto", "dock"],
  monday: ["monday", "maanantai", "måndag", "mon"],
  tuesday: ["tuesday", "tiistai", "tisdag", "tue"],
  wednesday: ["wednesday", "keskiviikko", "onsdag", "wed"],
  thursday: ["thursday", "torstai", "torsdag", "thu"],
  friday: ["friday", "perjantai", "fredag", "fri"],
  price: ["price", "cheap", "cheapest", "halvin", "hinta", "billig", "budget", "cost"],
  pack: ["pack", "box", "carton", "laatikko", "pakkaus", "tölkki", "litre", "liter", "bag"],
  coffee: ["coffee", "kahvi", "kaffe", "latte", "barista"],
  sweet: ["sweet", "makea", "söt", "sugar", "sokeri"],
};
const WORD_CONCEPT = new Map<string, string>(Object.entries(CONCEPTS).flatMap(([c, ws]) => ws.map((w) => [w, c] as [string, string])));

const tokenise = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);

function hash(s: string, dims: number): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % dims;
}

export class LexicalEmbedder implements Embedder {
  readonly id = "lexical-v1";
  constructor(readonly dims = 512) {}
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.vector(t));
  }
  vector(text: string): number[] {
    const v = new Array<number>(this.dims).fill(0);
    for (const w of tokenise(text)) {
      const concept = WORD_CONCEPT.get(w) ?? [...WORD_CONCEPT.entries()].find(([k]) => k.length >= 5 && w.startsWith(k))?.[1];
      if (concept) v[hash(`c:${concept}`, this.dims)] += 3;
      v[hash(`w:${w.slice(0, 6)}`, this.dims)] += 1;
      const padded = ` ${w} `;
      for (let i = 0; i + 3 <= padded.length; i++) v[hash(`t:${padded.slice(i, i + 3)}`, this.dims)] += 0.25;
    }
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  }
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
  return s;
}

export class OpenAIEmbedder implements Embedder {
  readonly id = "openai:text-embedding-3-small";
  readonly dims = 1536;
  constructor(private readonly apiKey: string) {}
  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: texts.map((t) => t.slice(0, 2000)) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`embeddings failed: HTTP ${res.status}`);
    const body = (await res.json()) as { data: { embedding: number[] }[] };
    return body.data.map((d) => d.embedding);
  }
}

export class InMemoryIndex implements MemoryIndex {
  private readonly byOrg = new Map<string, Map<string, number[]>>();
  constructor(private readonly embedder: Embedder = new LexicalEmbedder()) {}
  async upsert(orgId: string, items: { id: string; text: string }[]) {
    if (!items.length) return;
    const vs = await this.embedder.embed(items.map((i) => i.text));
    const m = this.byOrg.get(orgId) ?? new Map<string, number[]>();
    items.forEach((it, i) => m.set(it.id, vs[i]));
    this.byOrg.set(orgId, m);
  }
  async remove(orgId: string, ids: string[]) {
    const m = this.byOrg.get(orgId);
    for (const id of ids) m?.delete(id);
  }
  async search(orgId: string, text: string, k: number) {
    const m = this.byOrg.get(orgId);
    if (!m?.size) return [];
    const [q] = await this.embedder.embed([text]);
    return [...m.entries()]
      .map(([id, v]) => ({ id, score: cosine(q, v) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
  /** For tests: which org ids hold vectors. */
  orgs(): string[] {
    return [...this.byOrg.keys()];
  }
}

/** pgvector. The table is created on first use; the extension must be enabled (it is on the project's database). */
export class PgVectorIndex implements MemoryIndex {
  private ready?: Promise<void>;
  constructor(
    private readonly pool: Pool,
    private readonly embedder: Embedder,
    private readonly table = "dock_memory_vectors",
  ) {
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error("bad table name");
  }
  private init() {
    this.ready ??= this.pool
      .query(`CREATE TABLE IF NOT EXISTS ${this.table} (org_id text NOT NULL, item_id text NOT NULL, embedder text NOT NULL, embedding vector(${this.embedder.dims}) NOT NULL, PRIMARY KEY (org_id, item_id))`)
      .then(() => undefined);
    return this.ready;
  }
  async upsert(orgId: string, items: { id: string; text: string }[]) {
    if (!items.length) return;
    await this.init();
    const vs = await this.embedder.embed(items.map((i) => i.text));
    for (let i = 0; i < items.length; i++) {
      await this.pool.query(`INSERT INTO ${this.table} (org_id, item_id, embedder, embedding) VALUES ($1, $2, $3, $4::vector) ON CONFLICT (org_id, item_id) DO UPDATE SET embedder = EXCLUDED.embedder, embedding = EXCLUDED.embedding`, [orgId, items[i].id, this.embedder.id, `[${vs[i].join(",")}]`]);
    }
  }
  async remove(orgId: string, ids: string[]) {
    if (!ids.length) return;
    await this.init();
    await this.pool.query(`DELETE FROM ${this.table} WHERE org_id = $1 AND item_id = ANY($2)`, [orgId, ids]);
  }
  async search(orgId: string, text: string, k: number) {
    await this.init();
    const [q] = await this.embedder.embed([text]);
    const r = await this.pool.query<{ item_id: string; score: number }>(`SELECT item_id, 1 - (embedding <=> $2::vector) AS score FROM ${this.table} WHERE org_id = $1 AND embedder = $3 ORDER BY embedding <=> $2::vector LIMIT $4`, [orgId, `[${q.join(",")}]`, this.embedder.id, k]);
    return r.rows.map((row) => ({ id: row.item_id, score: Number(row.score) }));
  }
  async dropOrg(orgId: string) {
    await this.init();
    await this.pool.query(`DELETE FROM ${this.table} WHERE org_id = $1`, [orgId]);
  }
}
