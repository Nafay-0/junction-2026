import { DockError } from "@/core/orders";
import type { Runtime } from "../runtime";
import { handle } from "../http";
import { clientAddress } from "../limits";
import { currentOps, type OpsSession } from "./access";
import { scrubWords, viewerScope, type ViewerScope } from "./viewer";
import { hidesSample, viewAs } from "../alive/clock";
import { markRows } from "../alive/marks";

/**
 * Every /ops-api route goes through one of two doors, and nothing else decides who may use it:
 *
 *   opsRoute   staff only (the passcode's session). The default: anything that changes something, costs money or
 *              calls outside, and every new route unless it is marked readable on purpose. Anyone else: 403 staff_only.
 *   opsRead    a read anyone may make: staff as before; without the passcode, a viewer, on GET only, from a shared
 *              answer (one computation per page and moment, however many viewers poll it) with other people's words
 *              replaced (viewer.ts). A viewer's POST to a readable route is still 403 staff_only.
 *
 * The body runs against the shared runtime (without the sample activity when this browser hid it, server/alive);
 * any DockError becomes `{ error: { code, message } }`. Never cached by the browser.
 */
export type OpsActor = OpsSession & { viewer?: true };

export const STAFF_ONLY = "Staff only: sign in with the passcode to act. Looking needs no passcode.";
export const staffOnly = () => new DockError(403, "staff_only", STAFF_ONLY);

/**
 * The sample activity (server/alive) on a read: every read in this request leaves the sample out when this browser
 * hid it, and rows that name sample records carry `sample: true`.
 */
async function withSample(rt: Runtime, req: Request, run: () => Promise<Response>): Promise<Response> {
  const hide = hidesSample(req.headers.get("cookie"));
  const res = await viewAs({ hideSample: hide }, run);
  if (!res.headers.get("content-type")?.includes("application/json") || res.status >= 300) return res;
  const body = markRows(rt.dock.ledger, await res.clone().json(), hide);
  return new Response(JSON.stringify(body), { status: res.status, headers: res.headers });
}

/** While staff look, the sample's "now" stays true (orders waiting, today's figures): at most once a minute. Never for a viewer: a viewer's read changes nothing. */
function touchSample(rt: Runtime): void {
  void import("../alive/start").then((m) => m.touchSample(rt)).catch(() => undefined);
}

export function opsRoute(req: Request, fn: (rt: Runtime, staff: OpsSession) => Promise<Response>): Promise<Response> {
  return handle(async (rt) => {
    const staff = currentOps(req);
    if (!staff) throw staffOnly();
    const res = await withSample(rt, req, () => fn(rt, staff));
    touchSample(rt);
    res.headers.set("cache-control", "no-store");
    return res;
  });
}

/** The viewer, by address: no name is asked, nothing is stored. */
export function viewerOf(req: Request, now = new Date()): OpsActor {
  return { token: `viewer:${clientAddress(req.headers)}`, name: "Viewer", at: now.toISOString(), expiresAt: now.toISOString(), viewer: true };
}

type Shared = { at: number; status: number; body: string; type: string };
const g = globalThis as typeof globalThis & { __dockOpsShared?: Map<string, Shared> };
const shared = (g.__dockOpsShared ??= new Map<string, Shared>());

export function opsRead(req: Request, fn: (rt: Runtime, who: OpsActor, scope?: ViewerScope) => Promise<Response>, opts: { shareMs?: number } = {}): Promise<Response> {
  return handle(async (rt) => {
    const staff = currentOps(req);
    if (staff) {
      const res = await withSample(rt, req, () => fn(rt, staff));
      touchSample(rt);
      res.headers.set("cache-control", "no-store");
      return res;
    }
    if (req.method !== "GET" && req.method !== "HEAD") throw staffOnly();
    const scope = await viewerScope(rt, req);
    const u = new URL(req.url);
    const key = `${u.pathname}?${u.searchParams.toString()}|${scope.ownOrg ?? ""}|${hidesSample(req.headers.get("cookie")) ? "hide" : "all"}`;
    const shareMs = opts.shareMs ?? 4_000;
    const hit = shared.get(key);
    if (hit && Date.now() - hit.at < shareMs) return new Response(hit.body, { status: hit.status, headers: { "content-type": hit.type, "cache-control": "no-store", "x-dock-viewer": "shared" } });
    const res = await withSample(rt, req, () => fn(rt, viewerOf(req), scope));
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("application/json")) {
      res.headers.set("cache-control", "no-store");
      return res;
    }
    const body = JSON.stringify(scrubWords(await res.json(), scope));
    shared.set(key, { at: Date.now(), status: res.status, body, type });
    if (shared.size > 500) for (const k of [...shared.keys()].slice(0, 100)) shared.delete(k);
    return new Response(body, { status: res.status, headers: { "content-type": type, "cache-control": "no-store", "x-dock-viewer": "fresh" } });
  });
}
