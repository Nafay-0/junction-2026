import { headers } from "next/headers";
import { currentOps, opsMode, type OpsSession } from "../ops/access";

/** For the /present pages: the operations session from the page request's cookie, if any. */
export async function pageOps(): Promise<{ staff?: OpsSession; mode: "demo" | "passcode" }> {
  const h = await headers();
  const req = new Request("http://dock.local/present", { headers: { cookie: h.get("cookie") ?? "" } });
  return { staff: currentOps(req), mode: opsMode() };
}
