import { DockError } from "@/core/errors";
import { timingSafeEqual } from "node:crypto";
import { currentApprover } from "@/server/approver-session";
import { currentAccount } from "@/server/accounts/http";
import { publicBaseUrl } from "@/server/config";
import { errorBody, handle } from "@/server/http";
import { connectorSetup } from "@/server/mcp/connector-setup";
import { connectorSecret, type Connector } from "@/server/mcp/connectors";
import { connectorsFor } from "@/server/mcp/server";
import { consoleKitchen } from "@/server/authz";
import { resolveKitchen } from "@/server/console-kitchens";
import type { Runtime } from "@/server/runtime";
import { WORKS_WITH } from "@/server/works-with";

/**
 * The portal's back end for "connect your own agent" (not part of the public API, so not in OpenAPI).
 *
 *   GET    /ui-api/connect/{kitchen}   the kitchen's connector address (issued on first request) and setup steps
 *                                      for each assistant. `connector` is null after a revoke until one is issued.
 *   POST   /ui-api/connect/{kitchen}   revoke the current address and issue a new one (the old one stops at once)
 *   DELETE /ui-api/connect/{kitchen}   revoke the current address and issue none
 * Every reply also carries `worksWith`: the agent runtimes that bought through Dock unchanged in a live run, with the
 * interface each used and a link to its example (server/works-with.json, written by examples/runtimes/run-all).
 *
 * Who may see it: whoever can open the kitchen's console may also see its address, since it grants no more
 * than the console (both act as the kitchen's agent; neither can approve). Who may change it:
 *   account kitchens  the signed-in account itself
 *   visitor kitchens  the visitor themselves (their approver session cookie from joining), or the operator
 *   demo kitchens     the operator, with `Authorization: Bearer <DOCK_CONNECTOR_SECRET>`; outside production with no
 *                     secret configured, anyone (local dev). So a passer-by cannot revoke the stage demo's address.
 */

const notFound = () => Response.json(errorBody("kitchen_not_found", "This kitchen does not exist or its demo time is over."), { status: 404 });

function view(req: Request, kitchen: { slug: string; name: string; kind: "demo" | "visitor" | "account"; expiresAt?: string }, c: Connector | null, canManage: boolean) {
  const url = c && `${publicBaseUrl(req)}/api/mcp/c/${c.token}`;
  return Response.json(
    {
      kitchen,
      connector: c && url ? { url, connectorId: c.connectorId, source: c.source, createdAt: c.createdAt, expiresAt: c.expiresAt } : null,
      canManage,
      setup: url ? connectorSetup({ url, kitchenName: kitchen.name }) : null,
      worksWith: WORKS_WITH.runtimes.map((r) => ({ runtime: r.runtime, language: r.language, interface: r.interface, version: r.version ?? null, verified: r.verified, verifiedDate: r.verifiedDate, humanInput: r.humanInput ?? null, exampleUrl: r.exampleUrl })),
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

async function canManage(req: Request, rt: Runtime, slug: string, kind: "demo" | "visitor" | "account"): Promise<boolean> {
  if (isOperator(req)) return true;
  if (kind === "visitor") return (await currentApprover(req, rt))?.sandbox?.sandboxId === slug;
  if (kind === "account") return (await currentAccount(req, rt))?.account.username === slug;
  return !connectorSecret() && process.env.NODE_ENV !== "production";
}

async function load(req: Request, ctx: RouteContext<"/ui-api/connect/[kitchen]">, rt: Runtime) {
  const { kitchen: slug } = await ctx.params;
  // The operator (DOCK_CONNECTOR_SECRET) manages any kitchen's address; anyone else needs the kitchen's own session
  // (server/authz.ts): its signed-in account, a stage kitchen's too, or a visitor's phone.
  const k = isOperator(req) ? await resolveKitchen(slug) : await consoleKitchen(req, rt, slug);
  if (!k) return undefined;
  // The connector address is a credential for the kitchen's agent: not for a phone signed in by the call code.
  if ((k as { console?: { person?: { callOnly?: true } } }).console?.person?.callOnly) throw new DockError(403, "phone_session_limited", "The connector address needs the account's own sign-in. This phone was signed in by the call code.", "account");
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

const forbidden = (kind: "demo" | "visitor" | "account") =>
  Response.json(
    errorBody(
      "connector_manage_forbidden",
      kind === "account" ? "Only this kitchen's own signed-in account can change its connector address." : kind === "visitor" ? "Only the person who joined this kitchen can change its connector address, from the phone they joined on." : "This demo kitchen's connector address is set by the operator.",
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
