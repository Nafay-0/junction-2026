import type { LedgerEntry } from "@/core/ledger";
import { isoTime, json, sqlTime, type Maria } from "./client";
import { VECTOR_DIMS } from "./schema";

/**
 * "Decisions like this one", as the rules stood at each: the ledger's plain-language decisions with their
 * embeddings in MariaDB's VECTOR column, searched with VEC_DISTANCE_COSINE over the VECTOR INDEX, and joined in
 * the same statement to the mandate version that was in force when each was made (FOR SYSTEM_TIME ALL, matched on
 * ROW_START/ROW_END). One statement, no separate vector store.
 *
 * Embeddings come from OpenAI text-embedding-3-small (1,536 dimensions, $0.02 per million tokens), the model the
 * kitchen memory already uses; a decision is about 80 tokens, so ten thousand of them cost under two cents.
 * Without OPENAI_API_KEY nothing is embedded and the page says so.
 */
export interface TextEmbedder {
  id: string;
  dims: number;
  embed(texts: string[]): Promise<number[][]>;
}

export function openAiEmbedder(apiKey: string | undefined = process.env.OPENAI_API_KEY?.trim()): TextEmbedder | undefined {
  if (!apiKey) return undefined;
  return {
    id: "openai:text-embedding-3-small",
    dims: VECTOR_DIMS,
    async embed(texts) {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-small", input: texts.map((t) => t.slice(0, 4000)) }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`embeddings failed: HTTP ${res.status}`);
      const body = (await res.json()) as { data: { embedding: number[]; index: number }[]; usage?: { total_tokens?: number } };
      tokensUsed += body.usage?.total_tokens ?? 0;
      return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    },
  };
}

let tokensUsed = 0;
/** Embedding tokens spent by this process, for the measurements. */
export const embeddingTokens = () => tokensUsed;

export type DecisionDoc = { entryHash: string; seq: number; at: string; orgId: string; agentId: string; orderId?: string; outcome: string; rulesHit: string[]; explanation: string };

/** A gate decision from the ledger, as one paragraph a person (and an embedding) reads: the summary and its reasons. */
export function decisionDoc(e: LedgerEntry, owner: (orderId: string) => { orgId: string; agentId: string } | undefined): DecisionDoc | undefined {
  if (e.type !== "decision" || !e.orderId) return undefined;
  const who = owner(e.orderId);
  if (!who) return undefined;
  const d = e.data as { outcome?: string; reasons?: string[]; rules?: { rule: string; outcome: string }[] };
  return {
    entryHash: e.hash,
    seq: e.seq,
    at: e.at,
    orgId: who.orgId,
    agentId: who.agentId,
    orderId: e.orderId,
    outcome: String(d.outcome ?? "unknown"),
    rulesHit: (d.rules ?? []).filter((r) => r.outcome !== "pass").map((r) => r.rule),
    explanation: [e.summary, ...(d.reasons ?? [])].join(" "),
  };
}

export const vecText = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(7) : "0")).join(",")}]`;

/** Embed and store decisions not stored yet. Returns how many were added. */
export async function indexDecisions(db: Maria, writer: string, docs: DecisionDoc[], embedder: TextEmbedder, batch = 64): Promise<number> {
  if (!docs.length) return 0;
  const have = new Set((await db.query<{ entry_hash: string }>(`SELECT entry_hash FROM gate_decision WHERE entry_hash IN (${docs.map(() => "?").join(",")})`, docs.map((d) => d.entryHash))).rows.map((r) => r.entry_hash));
  const todo = docs.filter((d) => !have.has(d.entryHash));
  for (let i = 0; i < todo.length; i += batch) {
    const chunk = todo.slice(i, i + batch);
    const vectors = await embedder.embed(chunk.map((d) => d.explanation));
    for (let j = 0; j < chunk.length; j++) {
      const d = chunk[j];
      await db.query(
        "INSERT IGNORE INTO gate_decision (entry_hash, writer, seq, at, org_id, agent_id, order_id, outcome, rules_hit, explanation, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, VEC_FromText(?))",
        [d.entryHash, writer, d.seq, sqlTime(d.at), d.orgId, d.agentId, d.orderId ?? null, d.outcome, d.rulesHit.join(","), d.explanation.slice(0, 6000), vecText(vectors[j])],
      );
    }
  }
  return todo.length;
}

/** The combined statement: nearest decisions by meaning, each with the mandate terms in force at its moment. */
export const SQL_SIMILAR = `SELECT n.order_id, n.at, n.org_id, n.outcome, n.rules_hit, n.explanation, n.distance,
       m.per_order_limit_cents, m.weekly_budget_cents, m.forbidden_allergens, m.required_attributes,
       m.ROW_START AS terms_since, m.changed_by AS terms_by
  FROM (SELECT entry_hash, order_id, at, org_id, agent_id, outcome, rules_hit, explanation,
               VEC_DISTANCE_COSINE(embedding, VEC_FromText(?)) AS distance
          FROM gate_decision
         ORDER BY distance
         LIMIT ?) AS n
  LEFT JOIN gate_mandate FOR SYSTEM_TIME ALL AS m
         ON m.agent_id = n.agent_id AND m.ROW_START <= n.at AND n.at < m.ROW_END
 ORDER BY n.distance`;

export type Similar = {
  orderId?: string;
  at: string;
  orgId: string;
  outcome: string;
  rulesHit: string[];
  explanation: string;
  distance: number;
  /** The mandate terms in force when this decision was made, from MariaDB's history. */
  termsThen?: { perOrderLimitCents: number; weeklyBudgetCents: number; forbiddenAllergens: string[]; requiredAttributes: string[]; since: string; by: string };
};

export async function similarTo(db: Maria, vector: number[], k = 6): Promise<{ rows: Similar[]; sql: string; ms: number }> {
  const r = await db.query(SQL_SIMILAR, [vecText(vector), k]);
  return {
    rows: r.rows.map((x) => ({
      orderId: x.order_id ? String(x.order_id) : undefined,
      at: isoTime(x.at)!,
      orgId: String(x.org_id),
      outcome: String(x.outcome),
      rulesHit: String(x.rules_hit || "").split(",").filter(Boolean),
      explanation: String(x.explanation),
      distance: Number(x.distance),
      termsThen:
        x.per_order_limit_cents === null || x.per_order_limit_cents === undefined
          ? undefined
          : {
              perOrderLimitCents: Number(x.per_order_limit_cents),
              weeklyBudgetCents: Number(x.weekly_budget_cents),
              forbiddenAllergens: json<string[]>(x.forbidden_allergens),
              requiredAttributes: json<string[]>(x.required_attributes),
              since: isoTime(x.terms_since)!,
              by: String(x.terms_by),
            },
    })),
    sql: r.sql,
    ms: r.ms,
  };
}

/** The stored embedding of an order's decision, to ask for decisions like it without calling the model again. */
export async function embeddingOfOrder(db: Maria, orderId: string): Promise<number[] | undefined> {
  const r = await db.query("SELECT VEC_ToText(embedding) AS v FROM gate_decision WHERE order_id = ? ORDER BY seq LIMIT 1", [orderId]);
  return r.rows[0] ? json<number[]>(r.rows[0].v) : undefined;
}

/** The keyword baseline the vector search is measured against: MariaDB's own FULLTEXT index on the same text. */
export async function keywordSearch(db: Maria, text: string, k = 6): Promise<{ rows: { orderId?: string; rulesHit: string[]; outcome: string }[]; ms: number }> {
  const r = await db.query("SELECT order_id, rules_hit, outcome, MATCH(explanation) AGAINST (?) AS score FROM gate_decision WHERE MATCH(explanation) AGAINST (?) ORDER BY score DESC LIMIT ?", [text, text, k]);
  return { rows: r.rows.map((x) => ({ orderId: x.order_id ? String(x.order_id) : undefined, rulesHit: String(x.rules_hit || "").split(",").filter(Boolean), outcome: String(x.outcome) })), ms: r.ms };
}
