import { DockError } from "@/core/orders";
import { opsRoute } from "@/server/ops/handler";
import { timeMachineOf } from "@/server/mariadb/attach";
import { MARIADB_ENV, mariaEnabled } from "@/server/mariadb/config";
import { mirrorHealth, timeMachineView } from "@/server/mariadb/service";
import { embeddingOfOrder, similarTo } from "@/server/mariadb/vector";

/**
 * GET /ops-api/time-machine?order=ord_…|request=req_…&org=org_…&at=ISO: the rules as they stood at a moment beside
 * the rules now, the changes in between with who made them, and for an order the real gate run again on it.
 * GET …?similar=ord_…: decisions like that order's, each with the mandate terms in force when it was made.
 * When no MariaDB is attached (DOCK_MARIADB_URL unset), it says so and returns nothing else.
 */
export async function GET(req: Request) {
  return opsRoute(req, async (rt) => {
    const p = new URL(req.url).searchParams;
    const h = timeMachineOf(rt.dock);
    if (!h) {
      return Response.json({
        attached: false,
        env: MARIADB_ENV,
        sentence: mariaEnabled()
          ? `${MARIADB_ENV} is set, but this process has not attached the mirror (it attaches at start-up). Restart the app.`
          : `No MariaDB is attached to this deployment: ${MARIADB_ENV} is not set, so nothing is mirrored and there is no history to show. Ordering works the same either way.`,
      });
    }
    const status = h.mirror.status();
    const base = { attached: true, server: h.display, status, health: mirrorHealth(status), vectors: h.embedder ? h.embedder.id : null };
    const similar = p.get("similar");
    if (similar) {
      if (!h.embedder) return Response.json({ ...base, similar: { available: false, reason: "No embedding model: OPENAI_API_KEY is not set on this deployment." } });
      const v = await embeddingOfOrder(h.db, similar);
      if (!v) return Response.json({ ...base, similar: { available: false, reason: "This order's decision has no embedding yet (it is added after the mirror writes it)." } });
      const r = await similarTo(h.db, v, 6);
      return Response.json({ ...base, similar: { available: true, ...r, ms: Math.round(r.ms * 100) / 100 } });
    }
    try {
      const view = await timeMachineView(h.db, { orderId: p.get("order") ?? undefined, requestId: p.get("request") ?? undefined, orgId: p.get("org") ?? undefined, at: p.get("at") ?? undefined });
      return Response.json({ ...base, view });
    } catch (err) {
      if (err instanceof DockError) throw err;
      return Response.json({ ...base, reachable: false, sentence: `MariaDB did not answer: ${err instanceof Error ? err.message.slice(0, 200) : "unknown error"}. Ordering is not affected.` });
    }
  });
}
