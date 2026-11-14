import { DockError } from "@/core/errors";
import type { Lang } from "@/app/_i18n/lang";
import { RateLimiter, envRule } from "../limits";
import { normalizeAddress } from "../notify/address";
import type { Runtime } from "../runtime";
import type { Account } from "./store";

/**
 * The business email a restaurant gives at sign-up (step 1), for order confirmations, receipts and a note when
 * something cannot be delivered. Built on the mail module (server/notify): the account keeps the address only until
 * its kitchen exists (the end of the set-up interview); then it becomes the kitchen's notification contact in the
 * pending state and the one confirmation mail is sent (notify setAddress). Nothing else goes to it until confirmed.
 * Personal data: shown only to the kitchen's own signed-in person, never in the ledger, a URL, a log or an event.
 *
 * Confirmation sends are capped per kitchen by the mail module (ADDRESS_CHANGES_PER_HOUR) and per client address here
 * (DOCK_LIMIT_MAIL_CONFIRM_ADDRESS, default 20 an hour), so one address cannot make the service mail many inboxes.
 */
export const CONFIRMS_PER_ADDRESS = envRule("mail-confirm-address", 20, 60 * 60_000);
const g = globalThis as typeof globalThis & { __dockConfirmLimiter?: RateLimiter };
const limiter = (g.__dockConfirmLimiter ??= new RateLimiter(20_000));

/** The address, checked server-side; undefined for none given. Throws 400 for one that does not look like an address. */
export function businessEmail(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) return undefined;
  const a = typeof raw === "string" && raw.length <= 254 ? normalizeAddress(raw) : undefined;
  if (!a) throw new DockError(400, "email_invalid", "That does not look like an email address.", "account");
  return a;
}

/** One confirmation send from this client address, or 429. */
export function countConfirmSend(clientAddress: string): void {
  const wait = limiter.hit(CONFIRMS_PER_ADDRESS, clientAddress);
  if (wait !== null) throw new DockError(429, "mail_confirm_limit", "Too many confirmation emails from this address in the last hour. Try again later.", "account", { retryAfterSeconds: wait });
}

export type SignupMail = { state: "pending" | "none"; masked?: string; sent: boolean; reason?: "not_configured" | "failed" | "limit" };

/**
 * After the kitchen is made: the address given at sign-up becomes its pending contact and the confirmation is sent.
 * Says honestly whether the mail went (a refused send is "not sent yet", never pretended).
 */
export async function contactFromSignup(rt: Runtime, a: Account, opts: { lang: Lang; clientAddress?: string }): Promise<SignupMail> {
  const pending = a.mailPending;
  if (!pending || !a.kitchen) return { state: "none", sent: false };
  // The account no longer keeps it: from here the mail module holds the address, as for any kitchen.
  const fresh = (await rt.accounts.store.get(a.username)) ?? a;
  delete fresh.mailPending;
  await rt.accounts.store.put(fresh);
  try {
    if (opts.clientAddress) countConfirmSend(opts.clientAddress);
  } catch {
    return { state: "none", sent: false, reason: "limit" };
  }
  const { addressOf, setAddress, settled } = await import("../notify/service");
  try {
    const r = await setAddress(rt, { orgId: a.kitchen.orgId, slug: a.username, name: a.restaurant }, pending.address, { by: `${a.restaurant} (signed in as ${a.username})`, via: "sign-up", lang: pending.lang ?? opts.lang });
    // Wait (a few seconds at most) for the send, so the answer says whether the mail service took it.
    if (r.confirmation?.outcome === "sending") await Promise.race([settled(rt), new Promise((res) => setTimeout(res, 8000))]);
    const outcome = (await addressOf(rt, a.kitchen.orgId, { own: false })).confirmation?.outcome ?? r.confirmation?.outcome;
    const sent = outcome === "sent" || outcome === "sending";
    return { state: "pending", ...(r.contact.masked ? { masked: r.contact.masked } : {}), sent, ...(sent ? {} : { reason: r.contact.configured ? "failed" : "not_configured" }) };
  } catch {
    return { state: "none", sent: false, reason: "failed" };
  }
}
