import { Pool } from "pg";
import { KITCHEN_ORG } from "@/server/demo-kitchen";
import { DEMO_ORG } from "@/server/dev-fixtures";
import { getRuntime } from "@/server/runtime";
import { pgConnectionString } from "@/server/valio/index-store";
import { llmProposer, memoryModelSpec } from "./propose";
import { createMemoryService, type MemoryService } from "./service";
import { InMemoryIndex, LexicalEmbedder, OpenAIEmbedder, PgVectorIndex, type Embedder, type MemoryIndex } from "./vectors";

/**
 * The memory service of this server process, bound to the runtime's kitchen repository and ledger.
 *
 *   DOCK_MEMORY_MODEL        provider:model-id for the writer (default anthropic:claude-haiku-5-5, else the first provider with a key)
 *   DOCK_MEMORY_LLM=off      no model: memory learns from taps, substitutes and orders only
 *   DOCK_MEMORY_EMBEDDINGS   "openai" for text-embedding-3-small; default: in-process lexical embeddings
 *   DOCK_MEMORY_VECTORS      "pg" to keep vectors in PostgreSQL (DATABASE_URL, pgvector); default: in process
 */
const g = globalThis as typeof globalThis & { __dockMemory?: Promise<MemoryService> };

export function getMemoryService(): Promise<MemoryService> {
  g.__dockMemory ??= build();
  return g.__dockMemory;
}

export function resetMemoryService(): void {
  g.__dockMemory = undefined;
}

function embedder(): Embedder {
  const key = process.env.OPENAI_API_KEY?.trim();
  return process.env.DOCK_MEMORY_EMBEDDINGS === "openai" && key ? new OpenAIEmbedder(key) : new LexicalEmbedder();
}

function index(): MemoryIndex {
  const url = process.env.DATABASE_URL?.trim();
  if (process.env.DOCK_MEMORY_VECTORS === "pg" && url) return new PgVectorIndex(new Pool({ connectionString: pgConnectionString(url), max: 3, connectionTimeoutMillis: 5_000 }), embedder());
  return new InMemoryIndex(embedder());
}

async function build(): Promise<MemoryService> {
  const rt = await getRuntime();
  return createMemoryService({
    kitchens: rt.kitchens,
    ledger: rt.dock.ledger,
    proposer: memoryModelSpec() ? llmProposer() : undefined,
    index: index(),
    // The PostgreSQL kitchen store cannot list its kitchens: the demo kitchens, the visitors' and the accounts' are the ones there are.
    knownOrgIds: async () => [KITCHEN_ORG.orgId, DEMO_ORG.orgId, ...(await rt.sandboxes.list()).map((s) => s.orgId), ...(await rt.accounts.list()).flatMap((a) => (a.kind !== "demo" && a.orgId ? [a.orgId] : []))],
  });
}
