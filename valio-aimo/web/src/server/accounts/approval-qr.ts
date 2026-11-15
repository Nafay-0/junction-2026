import { approvalLink } from "../approval-links";
import type { Runtime } from "../runtime";
import { accountOfOrg, phoneJoins } from "./phone-join";

/**
 * The code an account kitchen's screen shows while an order waits for its signer (the store and the menu planner):
 * the sign-off screen once the kitchen has a signing device ("passkey"), else "no_device", and the order waits until a
 * passkey is added from Agent and rules. No link or tap stands in for the passkey.
 */
export async function accountApprovalQr(rt: Runtime, req: Request, c: { orgId: string; role: string; approver: { name: string; role: string }; status: string; orderId: string }, approvalId: string) {
  const signer = await rt.passkeys.store.findApprover(c.orgId, c.role);
  const devices = signer ? (await rt.passkeys.store.credentialsOf(signer.approverId)).length : 0;
  const link = await approvalLink(approvalId, req);
  // A shared test kitchen or a fresh kitchen: "Send to my phone" gives each phone a join address (phone-join.ts).
  const join = phoneJoins(await accountOfOrg(rt, c.orgId));
  const base = { approver: c.approver, status: c.status, orderId: c.orderId, url: link.url, join };
  return devices === 0 ? { mode: "no_device" as const, ...base, qrSvg: "" } : { mode: "passkey" as const, ...base, qrSvg: link.qrSvg };
}
