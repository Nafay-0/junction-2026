import "server-only";

/*
 * Sending email, through Resend (https://resend.com/docs/api-reference/emails/send-email).
 * One plain HTTP call, so the request is explicit and nothing else is pulled in. The sender has
 * to be an address on a domain verified at Resend; ours is beryl.zeroanomaly.tech.
 */

const ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "Beryl <notifications@beryl.zeroanomaly.tech>";

export type EmailResult = { ok: true; id: string } | { ok: false; reason: string };

/** True when the server has a key to send with. Without one, nothing is sent and nothing breaks. */
export const emailConfigured = (): boolean => Boolean(process.env.RESEND_API_KEY?.trim());

/** An address worth sending to: a made-up local one (admin@beryl.local) would only bounce. */
export function deliverable(address: string | null | undefined): address is string {
  if (!address) return false;
  const match = /^[^\s@]+@([^\s@]+\.[a-z]{2,})$/i.exec(address.trim());
  return Boolean(match) && !/\.(local|localhost|test|invalid|example)$/i.test(match![1]);
}

/**
 * Send one email. Never throws: the result says whether it went, and why not. `key` makes a
 * repeat of the same send (a retry, a second server) a no-op at Resend for a day.
 */
export async function sendEmail(input: { to: string; subject: string; html: string; text?: string; key?: string; tag?: string }): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: "Email is not set up on this server." };
  if (!deliverable(input.to)) return { ok: false, reason: "That address cannot receive email." };
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...(input.key ? { "idempotency-key": input.key.slice(0, 256) } : {}),
      },
      body: JSON.stringify({
        from: process.env.BERYL_EMAIL_FROM?.trim() || DEFAULT_FROM,
        to: [input.to.trim()],
        subject: input.subject.replace(/\s+/g, " ").trim().slice(0, 200),
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(input.tag ? { tags: [{ name: "kind", value: input.tag.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60) }] } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!response.ok || !body.id) {
      const reason = body.message ?? `Resend answered ${response.status}.`;
      console.warn("[email] not sent:", response.status, body.name ?? "", reason);
      return { ok: false, reason };
    }
    return { ok: true, id: body.id };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "The email service did not answer.";
    console.warn("[email] not sent:", reason);
    return { ok: false, reason };
  }
}
