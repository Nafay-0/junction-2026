import type { Runtime } from "../runtime";
import { handle } from "../http";
import { requireOps, type OpsSession } from "./access";
import { hidesSample, viewAs } from "../alive/clock";

/**
 * Every /ops-api route: the operations session is required (see access.ts), then the body runs against the shared
 * runtime (without the sample activity when the viewer hid it), and any DockError becomes `{ error: { code, message } }` with its status. Never cached.
 */
export function opsRoute(req: Request, fn: (rt: Runtime, staff: OpsSession) => Promise<Response>): Promise<Response> {
  return handle(async (rt) => {
    const staff = requireOps(req);
    // The portal's "hide the sample" switch (server/alive): every read in this request leaves the sample out.
    const res = await viewAs({ hideSample: hidesSample(req.headers.get("cookie")) }, () => fn(rt, staff));
    // While staff look, the sample's "now" stays true (orders waiting, today's figures): at most once a minute.
    void import("../alive/start").then((m) => m.touchSample(rt)).catch(() => undefined);
    res.headers.set("cache-control", "no-store");
    return res;
  });
}
