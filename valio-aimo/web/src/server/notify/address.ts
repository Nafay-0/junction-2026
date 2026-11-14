/**
 * The kitchen's notification address: personal data. It is read and checked here, and shown masked everywhere except
 * to the kitchen itself (m•••@example.com). Nothing in this module logs it.
 */

/** A plain address a person types: one @, a dotted domain, no spaces or angle brackets. Lower-cased domain. */
export function normalizeAddress(input: string): string | undefined {
  const s = input.trim().replace(/^mailto:/i, "").replace(/[.,;:!?)]+$/, "");
  if (s.length < 6 || s.length > 254) return undefined;
  const m = /^([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64})@([A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)+)$/.exec(s);
  if (!m) return undefined;
  const [, local, domain] = m;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return undefined;
  if (!/[A-Za-z]{2,}$/.test(domain)) return undefined;
  return `${local}@${domain.toLowerCase()}`;
}

/** The first address-looking thing in a sentence ("email receipts to chef@example.com please"). */
export function addressIn(words: string): string | undefined {
  const m = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(words);
  return m ? normalizeAddress(m[0]) : undefined;
}

/** "m•••@example.com": the first letter of the local part, then three dots. The domain stays (it says which mailbox). */
export function maskAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${address[0]}•••${address.slice(at)}`;
}

/** Resend's own test inboxes: the only addresses tests send real mail to. */
export const RESEND_TEST_ADDRESSES = ["delivered@resend.dev", "bounced@resend.dev", "complained@resend.dev"] as const;
