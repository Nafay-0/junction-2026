import { randomBytes } from "node:crypto";
import { RELAYED, type HumanVia } from "@/core/intake";
import { readCookie } from "./approver-session";
import { requestOrigin } from "./config";

/**
 * What the buyer console's back end (`/ui-api/kitchens/{kitchen}/call`) knows about the person at the screen, passed
 * to the v1 route it forwards to. Attached to the forwarded Request object in a WeakMap, so only server code in this
 * process can set it: no header an outside caller sends can claim to be a console session or a signed-in person.
 *
 *   session   the browser's console session (cookie `dock_console`): its own share of the live-lookup allowance
 *   person    set when the kitchen's own signed-in session is present (a visitor's approver cookie for their
 *             sandbox kitchen): answers and confirmations made at the console are then that person's, verified
 */
export type ConsolePerson = { channel: "portal_session"; name: string; approverId: string };
export type ConsoleContext = { kitchen: string; session: string; person?: ConsolePerson; /** typed or assistant: which part of the store the request came from. */ door?: "typed" | "assistant" };

const contexts = new WeakMap<Request, ConsoleContext>();

export function attachConsoleContext(req: Request, ctx: ConsoleContext): Request {
  contexts.set(req, ctx);
  return req;
}

export function consoleContextOf(req: Request): ConsoleContext | undefined {
  return contexts.get(req);
}

/**
 * The channel an intake answer arrived through: the kitchen's signed-in portal session when the console resolved
 * one (server/authz.ts consoleKitchen), else relayed by the agent. A header or body field can never set this.
 */
export function humanViaOf(req: Request): HumanVia {
  const person = contexts.get(req)?.person;
  return person ? { channel: person.channel, person: person.name } : RELAYED;
}

export const CONSOLE_COOKIE = "dock_console";
const SESSION_RE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * The console session id from the cookie. A caller without one (a first page load, a script) counts under the shared
 * "anon" share this time and gets a cookie for next time, so dropping the cookie never buys a fresh allowance.
 */
export function consoleSession(req: Request): { id: string; setCookie?: string } {
  const have = readCookie(req, CONSOLE_COOKIE);
  if (have && SESSION_RE.test(have)) return { id: have };
  const fresh = randomBytes(16).toString("base64url");
  const secure = requestOrigin(req).startsWith("https:") ? "; Secure" : "";
  return { id: "anon", setCookie: `${CONSOLE_COOKIE}=${fresh}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 3600}${secure}` };
}
