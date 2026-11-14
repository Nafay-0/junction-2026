import { DockError } from "@/core/orders";
import { opsRead } from "@/server/ops/handler";
import { timeMachineOf } from "@/server/mariadb/attach";
import { MARIADB_ENV } from "@/server/mariadb/config";
import { mirrorHealth, timeMachineView } from "@/server/mariadb/service";
import { embeddingOfOrder, similarTo } from "@/server/mariadb/vector";

/**
 * GET /ops-api/time-machine?order=ord_…|request=req_…&org=org_…&at=ISO: the rules as they stood at a moment beside
 * the rules now, the changes in between with who made them, and for an order the real gate run again on it.
 * GET …?similar=ord_…: decisions like that order's, each with the mandate terms in force when it was made.
 * The history comes from MariaDB, PostgreSQL or this server's memory (mariadb/attach.ts); `backend` and `label` say which.
 */
export async function GET(req: Request) {
  return opsRead(req, async (rt) => {
    const p = new URL(req.url).searchParams;
    const h = timeMachineOf(rt.dock);
    if (!h) {
      return Response.json({ attached: false, env: MARIADB_ENV, sentence: "The time machine starts with the server: this process has not started it (it starts at the first request after a deploy). Try again in a moment." });
    }
    const status = h.mirror.status();
    const where = h.backend === "mariadb" ? "MariaDB" : h.backend === "postgres" ? "Aiven PostgreSQL" : "this server's memory";
    const base = { attached: true, backend: h.backend, label: h.label, server: h.display, status, health: mirrorHealth(status, Date.now(), where), backfill: h.backfill, vectors: h.embedder ? h.embedder.id : null };
    const similar = p.get("similar");
    if (similar) {
      if (!h.db || !h.embedder) return Response.json({ ...base, similar: { available: false, reason: h.db ? "No embedding model: OPENAI_API_KEY is not set on this deployment." : "Decisions like this one need MariaDB's vector search; this deployment keeps its history elsewhere." } });
      const v = await embeddingOfOrder(h.db, similar);
      if (!v) return Response.json({ ...base, similar: { available: false, reason: "This order's decision has no embedding yet (it is added after the mirror writes it)." } });
      const r = await similarTo(h.db, v, 6);
      return Response.json({ ...base, similar: { available: true, ...r, ms: Math.round(r.ms * 100) / 100 } });
    }
    try {
      const view = await timeMachineView(h.store, { orderId: p.get("order") ?? undefined, requestId: p.get("request") ?? undefined, orgId: p.get("org") ?? undefined, at: p.get("at") ?? undefined });
      return Response.json({ ...base, view });
    } catch (err) {
      if (err instanceof DockError) throw err;
      return Response.json({ ...base, reachable: false, sentence: `${where} did not answer: ${err instanceof Error ? err.message.slice(0, 200) : "unknown error"}. Ordering is not affected.` });
    }
  });
}
