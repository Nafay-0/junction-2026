import type { RelyingParty } from "@/core/passkeys";

/**
 * Settings for the approver's phone, all from env (names listed in web/.env.example):
 *
 *   DOCK_PUBLIC_URL          https://dock.example.com   base of links and QR codes; also the passkey origin
 *   DOCK_WEBAUTHN_RP_ID      dock.example.com           passkey relying-party id (default: host of the origin)
 *   DOCK_WEBAUTHN_ORIGINS    https://a.example,https://b.example   allowed origins (default: DOCK_PUBLIC_URL)
 *   DOCK_WEBAUTHN_RP_NAME    Dock                       name the phone shows in the passkey prompt
 *   DOCK_DEMO_TAP_APPROVAL   1                          DEMO ONLY: allow tap-to-approve without a passkey (default off)
 *   DOCK_SANDBOX_MAX         200                        how many visitor kitchens may exist at once
 *   DOCK_SANDBOX_TTL_MINUTES 90                         how long a visitor kitchen lives
 *
 * With none set (local dev, or a quick HTTPS tunnel), the origin and rp id come from the request's host.
 * Passkeys need a secure context: https, or http://localhost. A phone on http://192.168.x.x has no passkeys.
 */

const firstHeader = (v: string | null) => v?.split(",")[0]?.trim() || undefined;

/** The origin the browser used, honouring a proxy's X-Forwarded-* headers (tunnels, Vercel). */
export function requestOrigin(req: Request): string {
  return originFromHeaders(req.headers, new URL(req.url));
}

/** Same, for server components (`await headers()`), where there is no Request object. */
export function originFromHeaders(headers: Headers, url?: URL): string {
  const host = firstHeader(headers.get("x-forwarded-host")) ?? firstHeader(headers.get("host")) ?? url?.host ?? "localhost:3000";
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  const proto = firstHeader(headers.get("x-forwarded-proto")) ?? url?.protocol.replace(":", "") ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}

export function publicBaseUrl(req?: Request | Headers): string {
  const fromEnv = process.env.DOCK_PUBLIC_URL?.trim();
  if (fromEnv) return new URL(fromEnv).origin;
  if (!req) return "http://localhost:3000";
  return req instanceof Request ? requestOrigin(req) : originFromHeaders(req);
}

export function relyingParty(req: Request): RelyingParty {
  const listed = (process.env.DOCK_WEBAUTHN_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => new URL(s).origin);
  const origins = listed.length ? listed : [publicBaseUrl(req)];
  const id = process.env.DOCK_WEBAUTHN_RP_ID?.trim() || new URL(origins[0]).hostname;
  return { id, name: process.env.DOCK_WEBAUTHN_RP_NAME?.trim() || "Dock", origins };
}

export function isSecureOrigin(origin: string): boolean {
  const u = new URL(origin);
  return u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1";
}

export function demoTapEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.DOCK_DEMO_TAP_APPROVAL?.trim() ?? "");
}

const int = (v: string | undefined, fallback: number) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function sandboxLimits(): { max: number; ttlMinutes: number } {
  return { max: int(process.env.DOCK_SANDBOX_MAX, 200), ttlMinutes: int(process.env.DOCK_SANDBOX_TTL_MINUTES, 90) };
}

/** Times on screens are shown in the event's time zone. */
export const DISPLAY_TIME_ZONE = "Europe/Helsinki";
