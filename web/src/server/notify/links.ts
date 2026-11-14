import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signed, expiring links in the mails: confirm an address, stop the mails. The token names the kitchen and the
 * address record (by its id), never the address itself, so a link that leaks says nothing personal.
 *
 * Key: derived from DOCK_ACCOUNT_KEY_SECRET when set (links outlive a restart), else a random key for this process
 * (links made before a restart stop working, which errs on the safe side: the kitchen asks again).
 */
export type LinkPurpose = "confirm" | "stop";
export type LinkClaims = { p: LinkPurpose; o: string; c: string; e: number };

const g = globalThis as typeof globalThis & { __dockMailLinkKey?: Buffer };

function key(): Buffer {
  const secret = process.env.DOCK_ACCOUNT_KEY_SECRET?.trim();
  if (secret) return Buffer.from(hkdfSync("sha256", Buffer.from(secret), Buffer.from("aimopilot-mail"), Buffer.from("mail-links-v1"), 32));
  g.__dockMailLinkKey ??= randomBytes(32);
  return g.__dockMailLinkKey;
}

const b64 = (b: Buffer) => b.toString("base64url");
const mac = (body: string) => createHmac("sha256", key()).update(body).digest();

export const CONFIRM_HOURS = 48;
export const STOP_DAYS = 400;

export function signLink(claims: Omit<LinkClaims, "e">, now = new Date()): string {
  const ttl = claims.p === "confirm" ? CONFIRM_HOURS * 3600 : STOP_DAYS * 86_400;
  const body = b64(Buffer.from(JSON.stringify({ ...claims, e: Math.floor(now.getTime() / 1000) + ttl })));
  return `${body}.${b64(mac(body)).slice(0, 32)}`;
}

export function readLink(token: string | null | undefined, purpose: LinkPurpose, now = new Date()): LinkClaims | undefined {
  if (!token || token.length > 600) return undefined;
  const [body, sig] = token.split(".");
  if (!body || !sig) return undefined;
  const want = Buffer.from(b64(mac(body)).slice(0, 32));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return undefined;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LinkClaims;
    if (c.p !== purpose || typeof c.o !== "string" || typeof c.c !== "string" || typeof c.e !== "number") return undefined;
    if (c.e * 1000 < now.getTime()) return undefined;
    return c;
  } catch {
    return undefined;
  }
}
