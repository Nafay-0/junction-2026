import { DockError } from "@/core/errors";
import { qrSvg } from "../approval-links";
import { publicBaseUrl } from "../config";
import type { Runtime } from "../runtime";
import type { Account } from "./store";

/**
 * Who may add a phone as one more signing device of a kitchen's approver, from the kitchen's own screen.
 *
 *   a shared test kitchen (kind "test") and a fresh kitchen (`free`): anyone at the screen is "the kitchen", and every
 *     reviewer at the table scans with their own phone. "Send to my phone" ALWAYS gives a one-time join address (ten
 *     minutes, single use): the phone that opens it becomes one more device of that approver and lands on the sign-off.
 *     At most TEST_SIGNER_DEVICES devices; the hourly reset of the test accounts makes a new approver.
 *   a restaurant's own account: a new device only while the approver has none yet (the account adds its first);
 *     after that only the approver's own enrolled phone signs, never a new device without the approver.
 */
export const TEST_SIGNER_DEVICES = 30;

/** A kitchen where any phone at the table may join as one more signing device. */
export function phoneJoins(a: Pick<Account, "kind" | "free"> | undefined): boolean {
  return !!a && (a.kind === "test" || !!a.free);
}

/** How many signing devices the account's approver has (passkeys on this site and others). */
export async function signerDevices(rt: Runtime, a: Account): Promise<number> {
  const s = rt.accounts.signerOf(a);
  if (!s) return 0;
  const approver = await rt.passkeys.store.findApprover(s.orgId, s.role);
  return approver ? (await rt.passkeys.store.credentialsOf(approver.approverId)).length : 0;
}

/**
 * The decision for "Send to my phone": "join" (a one-time address that adds the phone, then opens `next`), "approver"
 * (the bare sign-off address: only the approver's enrolled phone signs it), or "none" (no device yet and not the
 * kitchen's own screen).
 */
export function joinDecision(a: Pick<Account, "kind" | "free"> | undefined, devices: number, own: boolean): "join" | "approver" | "none" {
  if (own && (phoneJoins(a) || devices === 0)) return "join";
  return devices > 0 ? "approver" : "none";
}

/** A one-time join address for a phone, with where it goes once added; refused past the cap for a shared kitchen. */
export async function joinLink(rt: Runtime, req: Request, a: Account, next?: string): Promise<{ url: string; qrSvg: string; expiresAt: string }> {
  if (phoneJoins(a) && (await signerDevices(rt, a)) >= TEST_SIGNER_DEVICES) {
    throw new DockError(409, "signer_devices_full", `This test kitchen already has ${TEST_SIGNER_DEVICES} signing phones; they are cleared at the hourly reset. Use "OK with Face ID" on this screen meanwhile.`, "approver_identity");
  }
  const { token, expiresAt } = await rt.accounts.oneTimeLink(a.username, "device");
  const url = `${publicBaseUrl(req)}/join/device?t=${encodeURIComponent(token)}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
  return { url, qrSvg: await qrSvg(url), expiresAt };
}

/** The account whose kitchen an organisation is (for a sign-off opened on a phone that may not sign it). */
export async function accountOfOrg(rt: Runtime, orgId: string): Promise<Account | undefined> {
  const view = (await rt.accounts.list()).find((v) => v.orgId === orgId);
  return view ? rt.accounts.get(view.username) : undefined;
}
