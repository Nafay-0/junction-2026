/**
 * How a mail leaves: Resend's REST API over fetch (no SDK), or a fake for tests. Nothing here logs the address or
 * the key.
 *
 *   POST https://api.resend.com/emails    Authorization: Bearer <RESEND_API_KEY>, Idempotency-Key: <one per event>
 *   GET  https://api.resend.com/emails/id  what happened to it since (delivered, bounced, complained)
 *
 * The Idempotency-Key makes Resend send at most one mail per key for 24 hours, whatever happens on our side (a retry
 * after a timeout, two processes reacting to the same event).
 */

export type OutgoingMail = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** One per event: `aimopilot/<eventKey>`. */
  idempotencyKey: string;
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
};

export type SendResult =
  | { ok: true; id: string; attempts: number }
  | { ok: false; attempts: number; status?: number; code: string; message: string; /** Trying again later will not help (bad address, unverified domain, bad key). */ permanent: boolean };

/** What the provider later says happened to a sent mail. */
export type Delivery = "delivered" | "bounced" | "complained" | "delivery_delayed" | "sent" | "unknown";

export interface MailTransport {
  readonly name: string;
  send(mail: OutgoingMail): Promise<SendResult>;
  /** What happened to a sent mail since (Resend's `last_event`), if the provider can say. */
  status?(id: string): Promise<Delivery>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ResendTransport implements MailTransport {
  readonly name = "resend";
  constructor(
    private readonly apiKey: string,
    private readonly opts: { base?: string; retries?: number; backoffMs?: number[]; timeoutMs?: number; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
  ) {}

  private get base() {
    return this.opts.base ?? "https://api.resend.com";
  }

  async send(mail: OutgoingMail): Promise<SendResult> {
    const f = this.opts.fetch ?? fetch;
    const backoff = this.opts.backoffMs ?? [800, 2500];
    const tries = 1 + (this.opts.retries ?? backoff.length);
    let last: SendResult = { ok: false, attempts: 0, code: "not_sent", message: "Not sent.", permanent: false };
    for (let attempt = 1; attempt <= tries; attempt++) {
      try {
        const res = await f(`${this.base}/emails`, {
          method: "POST",
          headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", "idempotency-key": mail.idempotencyKey, "user-agent": "aimopilot-mail/1" },
          body: JSON.stringify({ from: mail.from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text, ...(mail.headers ? { headers: mail.headers } : {}), ...(mail.tags ? { tags: mail.tags } : {}) }),
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
        });
        const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string; message?: string };
        if (res.ok && typeof body.id === "string") return { ok: true, id: body.id, attempts: attempt };
        const retryable = res.status === 429 || res.status >= 500;
        last = { ok: false, attempts: attempt, status: res.status, code: body.name ?? `http_${res.status}`, message: (body.message ?? res.statusText ?? "Refused.").slice(0, 300), permanent: !retryable };
        if (!retryable) return last;
      } catch (err) {
        const e = err as Error;
        last = { ok: false, attempts: attempt, code: e.name === "TimeoutError" ? "timeout" : "network_error", message: (e.message || "The mail service did not answer.").slice(0, 300), permanent: false };
      }
      if (attempt < tries) await (this.opts.sleep ?? sleep)(backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 1000);
    }
    return last;
  }

  async status(id: string): Promise<Delivery> {
    const f = this.opts.fetch ?? fetch;
    try {
      const res = await f(`${this.base}/emails/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000) });
      if (!res.ok) return "unknown";
      const body = (await res.json()) as { last_event?: string };
      const e = body.last_event;
      return e === "delivered" || e === "bounced" || e === "complained" || e === "delivery_delayed" || e === "sent" ? e : "unknown";
    } catch {
      return "unknown";
    }
  }
}

/** For tests: records what would be sent; can be told to fail, be slow, or bounce. */
export class FakeTransport implements MailTransport {
  readonly name = "fake";
  readonly sent: OutgoingMail[] = [];
  private readonly keys = new Map<string, string>();
  private n = 0;
  fail?: { code: string; message: string; permanent: boolean; status?: number };
  delayMs = 0;
  deliveries = new Map<string, Delivery>();

  async send(mail: OutgoingMail): Promise<SendResult> {
    if (this.delayMs) await sleep(this.delayMs);
    if (this.fail) return { ok: false, attempts: 1, ...this.fail };
    const seen = this.keys.get(mail.idempotencyKey);
    if (seen) return { ok: true, id: seen, attempts: 1 }; // the provider's idempotency: no second mail
    const id = `fake-${++this.n}`;
    this.keys.set(mail.idempotencyKey, id);
    this.sent.push(mail);
    return { ok: true, id, attempts: 1 };
  }

  async status(id: string): Promise<Delivery> {
    return this.deliveries.get(id) ?? "delivered";
  }
}
