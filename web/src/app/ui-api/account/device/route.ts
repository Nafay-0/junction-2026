import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { DockError } from "@/core/errors";
import { PasskeyError } from "@/core/passkeys";
import { sessionCookie } from "@/server/approver-session";
import { relyingParty } from "@/server/config";
import { currentAccount } from "@/server/accounts/http";
import { accountRoute, noStore } from "@/server/accounts/routes";
import { readJson } from "@/server/http";

/**
 * Signing devices: a passkey for the kitchen's signer, which signs orders above the limit (bound to the exact order).
 *
 * GET  /ui-api/account/device                                the signer and the devices added so far
 * POST /ui-api/account/device { step: "begin", link? }       the passkey prompt; `link` when a phone opened the QR code
 * POST /ui-api/account/device { step: "verify", response, link? }
 *
 * From this browser: the signed-in account. From a phone: the one-time link the account showed as a QR code
 * (POST /ui-api/account/device/link). Either way this device is then signed in as the signer (approver cookie).
 */
export async function GET(req: Request) {
  return accountRoute(req, async (rt) => {
    const s = await currentAccount(req, rt);
    if (!s) throw new DockError(401, "not_signed_in", "Sign in first.", "account");
    return Response.json(await rt.accounts.devices(s.account), { headers: noStore });
  });
}

export async function POST(req: Request) {
  return accountRoute(req, async (rt) => {
    try {
      const body = (await readJson(req)) as { step?: unknown; link?: unknown; response?: RegistrationResponseJSON };
      const link = typeof body.link === "string" ? body.link : undefined;
      const s = await currentAccount(req, rt);
      const username = link ? rt.accounts.linkAccount(link) : s?.account.username;
      if (!username) throw new DockError(link ? 410 : 401, link ? "device_link_expired" : "not_signed_in", link ? "This code has expired or was used. Show a new one from Agent and rules." : "Sign in first.", "account");
      if (body.step === "begin") {
        const account = await rt.accounts.get(username);
        if (!account) throw new DockError(404, "account_not_found", "No such account.", "account");
        const options = await rt.accounts.beginDevice(account, relyingParty(req), link ? "link" : "session", link);
        const devices = await rt.accounts.devices(account);
        return Response.json({ options, restaurant: account.restaurant, signer: devices.signer?.name }, { headers: noStore });
      }
      if (body.step === "verify" && body.response && typeof body.response === "object") {
        const done = await rt.accounts.completeDevice(body.response, link ? { link } : { username: s?.account.username });
        return Response.json(
          { added: true, restaurant: done.account.restaurant, kitchen: done.account.username, devices: (await rt.accounts.devices(done.account)).devices.length },
          { status: 201, headers: { ...noStore, "set-cookie": sessionCookie(req, done.sessionToken, done.sessionExpiresAt) } },
        );
      }
      throw new DockError(400, "invalid_request", 'Send { step: "begin" }, then { step: "verify", response }.');
    } catch (err) {
      if (err instanceof PasskeyError) throw new DockError(err.status, err.code, err.message, "approver_identity");
      throw err;
    }
  });
}
