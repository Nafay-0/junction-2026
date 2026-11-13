import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DockError } from "@/core/orders";

/**
 * Who may use the operations portal (/ops) and its back end (/ops-api).
 *
 *   DOCK_OPS_PASSCODE unset   demo: one click enters as operations staff, no password
 *   DOCK_OPS_PASSCODE=...     entering needs the passcode; without it nobody can suspend agents or read the views
 *
 * Either way every /ops-api call needs the session cookie entry sets (HttpOnly, SameSite=Strict), so a link or a
 * form on another site cannot suspend an agent. A demo, not staff sign-in: a real deployment puts the
 * wholesaler's single sign-on in front of /ops and /ops-api and keeps the named staff member on each action.
 */
export const OPS_COOKIE = "dock_ops";
const SESSION_HOURS = 12;

export type OpsSession = { token: string; name: string; at: string; expiresAt: string };

const g = globalThis as typeof globalThis & { __dockOpsSessions?: Map<string, OpsSession> };
const sessions = (g.__dockOpsSessions ??= new Map<string, OpsSession>());

export function opsPasscode(): string | undefined {
  const v = process.env.DOCK_OPS_PASSCODE?.trim();
  return v ? v : undefined;
}

export function opsMode(): "demo" | "passcode" {
  return opsPasscode() ? "passcode" : "demo";
}

const digest = (s: string) => createHash("sha256").update(s).digest();

export function enterOps(input: { passcode?: string; name?: string }, now = new Date()): OpsSession {
  const required = opsPasscode();
  if (required && !timingSafeEqual(digest(input.passcode ?? ""), digest(required))) {
    throw new DockError(401, "ops_passcode_wrong", "That passcode is not right. Ask the person running the demo.");
  }
  const name = (input.name ?? "").trim().slice(0, 60) || "Operations desk";
  const token = randomBytes(24).toString("base64url");
  const s: OpsSession = { token, name, at: now.toISOString(), expiresAt: new Date(now.getTime() + SESSION_HOURS * 3600_000).toISOString() };
  sessions.set(token, s);
  return s;
}

export function leaveOps(req: Request): void {
  const t = cookieToken(req);
  if (t) sessions.delete(t);
}

function cookieToken(req: Request): string | undefined {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === OPS_COOKIE) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function currentOps(req: Request, now = new Date()): OpsSession | undefined {
  const t = cookieToken(req);
  const s = t ? sessions.get(t) : undefined;
  if (!s) return undefined;
  if (Date.parse(s.expiresAt) <= now.getTime()) {
    sessions.delete(s.token);
    return undefined;
  }
  return s;
}

export function requireOps(req: Request): OpsSession {
  const s = currentOps(req);
  if (!s) throw new DockError(401, "ops_not_signed_in", "Enter the operations portal first.");
  return s;
}

export function sessionCookie(req: Request, s: OpsSession | null): string {
  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const base = `${OPS_COOKIE}=${s ? encodeURIComponent(s.token) : ""}; Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
  return s ? `${base}; Max-Age=${SESSION_HOURS * 3600}` : `${base}; Max-Age=0`;
}
