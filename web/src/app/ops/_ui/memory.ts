"use client";

/**
 * What the wholesaler may know about a kitchen: the items of its memory that the kitchen shares with the
 * wholesaler, read from the memory model's wholesaler-side, read-only route. Built against that route before it
 * exists, so it reads tolerantly and says "not available yet" on a 404.
 *
 * Expected contract (the memory branch, web/src/server/memory/ and /ui-api/memory/**):
 *   GET  /ui-api/memory/kitchens/{orgId}
 *        -> { orgId, name?, items: [{ id, kind, text, source: { kind: "stated"|"learned"|"confirmed", by?, at, via? },
 *             lastUsedAt?, lastUsedRequestId?, shared?: true }], views?: [{ by, at }] }
 *        Only items the kitchen shares come back; the route records each staff view (visible to the kitchen).
 *   POST /ui-api/memory/kitchens/{orgId}/proposals  { itemId?, kind, text, reason }
 *        -> { proposal: { id, status: "awaiting_kitchen" } }  a correction the kitchen must confirm.
 * The ops session cookie travels with both; the route can check it with currentOps() from src/server/ops/access.ts.
 */
export type MemorySource = { kind: string; by?: string; at?: string; via?: string };
export type MemoryItem = { id: string; kind: string; text: string; source: MemorySource; lastUsedAt?: string; lastUsedRequestId?: string };
export type MemoryView = { orgId: string; name?: string; items: MemoryItem[]; views: { by: string; at: string }[] };
export type MemoryState = { state: "ok"; data: MemoryView } | { state: "unavailable" } | { state: "error"; message: string };

export const KIND_GROUP: { title: string; kinds: RegExp }[] = [
  { title: "Diet and allergens", kinds: /diet|allerg|lactose|gluten|vegan|attribute/i },
  { title: "Products, brands and packs", kinds: /product|brand|pack|size/i },
  { title: "Deliveries", kinds: /deliver|receiv|hour|day/i },
  { title: "Substitutes", kinds: /substitut|swap|replace/i },
  { title: "Standing orders", kinds: /standing|recurr|repeat|weekly/i },
];

export function groupOf(kind: string): string {
  return KIND_GROUP.find((g) => g.kinds.test(kind))?.title ?? "Other shared items";
}

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

function normaliseItem(r: Raw, i: number): MemoryItem | undefined {
  if (r.shared === false || r.private === true) return undefined; // never show what the kitchen keeps to itself
  const src = (r.source ?? r.provenance ?? {}) as Raw;
  const text = str(r.text) ?? str(r.label) ?? str(r.summary);
  if (!text) return undefined;
  return {
    id: str(r.id) ?? `item_${i}`,
    kind: str(r.kind) ?? str(r.category) ?? "other",
    text,
    source: { kind: str(src.kind) ?? str(r.origin) ?? "stated", by: str(src.by) ?? str(r.statedBy), at: str(src.at) ?? str(r.statedAt), via: str(src.via) },
    lastUsedAt: str(r.lastUsedAt) ?? str(r.lastUsed),
    lastUsedRequestId: str(r.lastUsedRequestId),
  };
}

export async function readMemory(orgId: string): Promise<MemoryState> {
  let res: Response;
  try {
    res = await fetch(`/ui-api/memory/kitchens/${encodeURIComponent(orgId)}`, { cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" } });
  } catch {
    return { state: "error", message: "No connection to AimoPilot." };
  }
  if (res.status === 404 || res.status === 405) {
    // The route itself is missing (not merged yet), or it says this kitchen shares nothing.
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    if (!body?.error?.code || body.error.code === "not_found") return { state: "unavailable" };
    return { state: "ok", data: { orgId, items: [], views: [] } };
  }
  const body = (await res.json().catch(() => null)) as Raw | null;
  if (!res.ok || !body) return { state: "error", message: (body?.error as Raw | undefined)?.message as string ?? `AimoPilot answered ${res.status}.` };
  const k = (body.kitchen ?? body) as Raw;
  const items = (Array.isArray(k.items) ? (k.items as Raw[]) : []).map(normaliseItem).filter((x): x is MemoryItem => !!x);
  const views = (Array.isArray(k.views) ? (k.views as Raw[]) : []).map((v) => ({ by: str(v.by) ?? "staff", at: str(v.at) ?? "" }));
  return { state: "ok", data: { orgId, name: str(k.name), items, views } };
}

export async function proposeCorrection(orgId: string, input: { itemId?: string; kind: string; text: string; reason: string }): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`/ui-api/memory/kitchens/${encodeURIComponent(orgId)}/proposals`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(input),
    });
    if (res.status === 404 || res.status === 405) return { ok: false, message: "Proposals are not available on this server yet." };
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (!res.ok) return { ok: false, message: body?.error?.message ?? `AimoPilot answered ${res.status}.` };
    return { ok: true, message: "Sent to the kitchen. Nothing changes until they confirm it." };
  } catch {
    return { ok: false, message: "No connection to AimoPilot." };
  }
}
