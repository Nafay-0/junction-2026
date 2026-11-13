import { timingSafeEqual } from "node:crypto";
import { currentApprover } from "@/server/approver-session";
import { publicBaseUrl } from "@/server/config";
import { errorBody, handle } from "@/server/http";
import { connectorSetup } from "@/server/mcp/connector-setup";
import { connectorSecret, type Connector } from "@/server/mcp/connectors";
import { connectorsFor } from "@/server/mcp/server";
import { resolveKitchen } from "@/server/console-kitchens";
import type { Runtime } from "@/server/runtime";

/**
 * The portal's back end for "connect your own agent" (not part of the public API, so not in OpenAPI).
 *
 *   GET    /ui-api/connect/{kitchen}   the kitchen's connector address (issued on first request) and setup steps
 *                                      for each assistant. `connector` is null after a revoke until one is issued.
 *   POST   /ui-api/connect/{kitchen}   revoke the current address and issue a new one (the old one stops at once)
 *   DELETE /ui-api/connect/{kitchen}   revoke the current address and issue none
 *
 * Who may see it: whoever can open the kitchen's console may also see its address, since it grants no more
 * than the console (both act as the kitchen's agent; neither can approve). Who may change it:
 *   visitor kitchens  the visitor themselves (their approver session cookie from joining), or the operator
 *   demo kitchens     the operator, with `Authorization: Bearer <DOCK_CONNECTOR_SECRET>`; outside production with no
 *                     secret configured, anyone (local dev). So a passer-by cannot revoke the stage demo's address.
 */

const notFound = () => Response.json(errorBody("kitchen_not_found", "This kitchen does not exist or its demo time is over."), { status: 404 });

function view(req: Request, kitchen: { slug: string; name: string; kind: "demo" | "visitor"; expiresAt?: string }, c: Connector | null, canManage: boolean) {
  const url = c && `${publicBaseUrl(req)}/api/mcp/c/${c.token}`;
  return Response.json(
    {
      kitchen,
      connector: c && url ? { url, connectorId: c.connectorId, source: c.source, createdAt: c.createdAt, expiresAt: c.expiresAt } : null,
      canManage,
      setup: url ? connectorSetup({ url, kitchenName: kitchen.name }) : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

function isOperator(req: Request): boolean {
  const secret = connectorSecret();
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization")?.trim() ?? "");
  if (!secret || !m) return false;
  const [a, b] = [Buffer.from(m[1]), Buffer.from(secret)];
  return a.length === b.length && timingSafeEqual(a, b);
}

async function canManage(req: Request, rt: Runtime, slug: string, kind: "demo" | "visitor"): Promise<boolean> {
  if (isOperator(req)) return true;
  if (kind === "visitor") return (await currentApprover(req, rt))?.sandbox?.sandboxId === slug;
  return !connectorSecret() && process.env.NODE_ENV !== "production";
}

async function load(req: Request, ctx: RouteContext<"/ui-api/connect/[kitchen]">, rt: Runtime) {
  const { kitchen: slug } = await ctx.params;
  const k = await resolveKitchen(slug);
  if (!k) return undefined;
  const kitchen = { slug, name: k.info.name, kind: k.info.kind, expiresAt: k.info.expiresAt };
  return { slug, kitchen, manage: await canManage(req, rt, slug, k.info.kind) };
}

export async function GET(req: Request, ctx: RouteContext<"/ui-api/connect/[kitchen]">) {
  return handle(async (rt) => {
    const k = await load(req, ctx, rt);
    if (!k) return notFound();
    const c = await connectorsFor(rt).current(k.slug);
    if (c === undefined) return notFound();
    return view(req, k.kitchen, c, k.manage);
  });
}

const forbidden = (kind: "demo" | "visitor") =>
  Response.json(
    errorBody(
      "connector_manage_forbidden",
      kind === "visitor" ? "Only the person who joined this kitchen can change its connector address, from the phone they joined on." : "This demo kitchen's connector address is set by the operator.",
    ),
    { status: 403 },
  );

export async function POST(req: Request, ctx: RouteContext<"/ui-api/connect/[kitchen]">) {
  return handle(async (rt) => {
    const k = await load(req, ctx, rt);
    if (!k) return notFound();
    if (!k.manage) return forbidden(k.kitchen.kind);
    const c = await connectorsFor(rt).reissue(k.slug);
    if (!c) return notFound();
    return view(req, k.kitchen, c, true);
  });
}

export async function DELETE(req: Request, ctx: RouteContext<"/ui-api/connect/[kitchen]">) {
  return handle(async (rt) => {
    const k = await load(req, ctx, rt);
    if (!k) return notFound();
    if (!k.manage) return forbidden(k.kitchen.kind);
    await connectorsFor(rt).revoke(k.slug);
    return view(req, k.kitchen, null, true);
  });
}
