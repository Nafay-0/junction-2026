import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveKitchen } from "@/server/console-kitchens";
import { resetMemoryService } from "@/server/memory/runtime";
import { getRuntime, resetRuntime, type Runtime } from "@/server/runtime";
import { addressIn, maskAddress, normalizeAddress } from "./address";
import { readLink, signLink } from "./links";
import type { ReceiptModel } from "./model";
import { renderMail } from "./render";
import { addressOf, checkDelivery, confirmAddress, deliver, mailPreview, mailView, receiptModel, receiptStatus, removeAddress, setAddress, setMailTransport, settled, stopByLink } from "./service";
import { FakeTransport, ResendTransport } from "./transport";
import { answerMailWords, mailFactAfterOrder, mailWordsOf } from "./thread";

/**
 * Email to the kitchen, in process on the seed catalogue with a fake transport: confirmation first, one mail per event,
 * the caps, a failing or slow mail service never touching an order, and the receipt's figures in three languages.
 */

const ADDRESS = "chef.kaari@example.com";
const MASKED = "c•••@example.com";

async function kaari() {
  const rt = await getRuntime();
  const k = (await resolveKitchen("kaari"))!;
  const session = await rt.dock.authenticate(k.mandateToken, k.agentId, { via: "onsite", path: "/test", method: "POST" } as never);
  return { rt, k, session, ref: { orgId: k.info.orgId, slug: "kaari", name: k.info.name } };
}

/** An order through the ordinary flow: request, signed quote, place. Yoghurt at 3,49 € (Kaari has no usual amount for it): 5 stay inside its €100; 40 need an OK. */
// Each next order is another product, so the mistake check's repeat rule does not send it for an OK.
const PRODUCTS = ["VA-3101", "VA-2301"];
let nth = 0;
async function order(rt: Runtime, session: Awaited<ReturnType<typeof kaari>>["session"], packs = 5) {
  const productId = PRODUCTS[nth % PRODUCTS.length];
  if (packs === 5) packs += 4 * Math.floor(nth / PRODUCTS.length); // and another amount
  nth += 1;
  const req = await rt.dock.openRequest(session, { text: `${packs} packs of ${productId}` });
  await rt.dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId, quantity: packs }] });
  const o = await rt.dock.placeOrder(session, { requestId: req.requestId });
  return o;
}

/** Let the after-the-fact handlers run, then wait for the sends they started. */
async function flush(rt: Runtime) {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 5));
    await settled(rt);
  }
}

const mailEntries = (rt: Runtime) => rt.dock.ledger.entries().filter((e) => e.type === "mail");

async function confirmed(rt: Runtime, ref: { orgId: string; slug: string; name: string }, fake: FakeTransport) {
  await setAddress(rt, ref, ADDRESS, { by: "Sanna Koskinen", via: "test", lang: "en" });
  await flush(rt);
  const link = /\/mail\/confirm\?t=([\w.-]+)/.exec(fake.sent.at(-1)!.html)![1];
  expect((await confirmAddress(rt, link)).ok).toBe(true);
}

beforeEach(() => {
  nth = 0;
  resetRuntime();
  resetMemoryService();
  process.env.DOCK_MEMORY_LLM = "off";
  process.env.DOCK_RATE_LIMITS = "off";
});
afterEach(() => {
  delete process.env.DOCK_MAIL_PER_KITCHEN_HOUR;
  delete process.env.DOCK_MAIL_DAILY;
});

describe("the address", () => {
  it("is read, masked, and kept out of tokens", () => {
    expect(normalizeAddress(" Chef@Example.COM ")).toBe("Chef@example.com");
    expect(normalizeAddress("not an address")).toBeUndefined();
    expect(normalizeAddress("a@b")).toBeUndefined();
    expect(addressIn("email receipts to chef@example.com please.")).toBe("chef@example.com");
    expect(maskAddress("matti@example.com")).toBe("m•••@example.com");
    const t = signLink({ p: "confirm", o: "org-1", c: "mc_1" });
    expect(Buffer.from(t.split(".")[0], "base64url").toString()).not.toMatch(/@/);
    expect(readLink(t, "confirm")?.o).toBe("org-1");
    expect(readLink(t, "stop")).toBeUndefined(); // a confirm link cannot stop, and back
    expect(readLink(`${t.slice(0, -2)}xx`, "confirm")).toBeUndefined();
    expect(readLink(t, "confirm", new Date(Date.now() + 49 * 3600_000))).toBeUndefined(); // expires
  });
});

describe("confirmation before any other mail", () => {
  it("sends only the confirmation until the link is used; then the receipt", async () => {
    const { rt, session, ref } = await kaari();
    const fake = new FakeTransport();
    setMailTransport(rt, fake);
    await setAddress(rt, ref, ADDRESS, { by: "Sanna Koskinen", via: "test", lang: "en" });
    await flush(rt);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toMatchObject({ to: ADDRESS, subject: "Confirm your address for AimoPilot order emails" });
    expect(fake.sent[0].headers).toBeUndefined(); // no stop link before it is confirmed

    const first = await order(rt, session);
    expect(first.status).toBe("committed");
    await flush(rt);
    expect(fake.sent).toHaveLength(1); // not confirmed: no receipt
    expect(mailEntries(rt).at(-1)!.summary).toMatch(/not sent: the kitchen's address is not confirmed yet/);

    const link = /\/mail\/confirm\?t=([\w.-]+)/.exec(fake.sent[0].html)![1];
    expect(await confirmAddress(rt, "forged.token")).toEqual({ ok: false, problem: "invalid" });
    expect(await confirmAddress(rt, link)).toMatchObject({ ok: true, masked: MASKED });
    expect((await addressOf(rt, ref.orgId, { own: false })).address).toBeUndefined(); // masked to anyone but the kitchen
    expect((await addressOf(rt, ref.orgId, { own: true })).address).toBe(ADDRESS);

    const second = await order(rt, session);
    await flush(rt);
    expect(fake.sent).toHaveLength(2);
    const receipt = fake.sent[1];
    expect(receipt.subject.replace(/\u00a0/g, " ")).toMatch(new RegExp(`^Order ${second.orderId} placed: [0-9 ,]+ €, delivery `));
    expect(receipt.html).toContain("We will email you if anything changes: a delay, a shortage or a substitute.");
    expect(receipt.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(receipt.idempotencyKey).toBe(`aimopilot-receipt:${second.orderId}`);
    expect(await receiptStatus(rt, second)).toEqual({ emailed: true, to: MASKED, status: "sent" });

    // A new address replaces it: the old confirmation link no longer works.
    await setAddress(rt, ref, "other@example.com", { by: "Sanna Koskinen", via: "test", lang: "en" });
    expect(await confirmAddress(rt, link)).toEqual({ ok: false, problem: "expired_or_replaced" });
  });

  it("never writes the address into the ledger, the operations view or a log record's link", async () => {
    const { rt, session, ref } = await kaari();
    const fake = new FakeTransport();
    setMailTransport(rt, fake);
    await confirmed(rt, ref, fake);
    await order(rt, session);
    await order(rt, session, 40); // waits for an OK
    await flush(rt);
    expect(fake.sent.map((m) => m.subject)).toEqual([expect.stringMatching(/^Confirm/), expect.stringMatching(/^Order .* placed/), expect.stringMatching(/^Waiting for .*'s OK: order/)]);
    const ledger = JSON.stringify(rt.dock.ledger.entries());
    expect(ledger).not.toContain(ADDRESS);
    expect(ledger).not.toContain("chef.kaari");
    expect(mailEntries(rt).map((e) => e.data.step)).toEqual(expect.arrayContaining(["address_set", "address_confirmed", "sent"]));
    const view = await mailView(rt);
    expect(JSON.stringify(view)).not.toContain(ADDRESS);
    expect(view.kitchens[0]).toMatchObject({ masked: MASKED, state: "confirmed" });
    const preview = (await mailPreview(rt, view.mails.find((m) => m.kind === "receipt")!.mailId))!;
    expect(preview.html).toContain(MASKED);
    expect(preview.html).not.toContain(ADDRESS);
    expect(fake.sent.every((m) => !m.html.includes(ADDRESS) && !m.text.includes(ADDRESS))).toBe(true); // the body says only the masked address
  });
});

describe("one mail per event, the caps, and an order never waits for mail", () => {
  it("sends an event once, whatever happens twice", async () => {
    const { rt, session, ref } = await kaari();
    const fake = new FakeTransport();
    setMailTransport(rt, fake);
    await confirmed(rt, ref, fake);
    const o = await order(rt, session);
    await flush(rt);
    const before = fake.sent.length;
    const c = { orgId: ref.orgId, slug: "kaari", kitchenName: ref.name };
    const model = await receiptModel(c, o);
    const again = await deliver(rt, { eventKey: `receipt:${o.orderId}`, kind: "receipt", orgId: ref.orgId, model });
    await flush(rt);
    expect(again?.outcome).toBe("sent");
    expect(fake.sent.length).toBe(before);
    expect(mailEntries(rt).filter((e) => e.data.eventKey === `receipt:${o.orderId}` && e.data.step === "sent")).toHaveLength(1);
  });

  it("holds a kitchen to its hourly cap and records the skip", async () => {
    process.env.DOCK_MAIL_PER_KITCHEN_HOUR = "2";
    const { rt, session, ref } = await kaari();
    const fake = new FakeTransport();
    setMailTransport(rt, fake);
    await confirmed(rt, ref, fake); // the confirmation is the first of the two
    await order(rt, session);
    await order(rt, session);
    await flush(rt);
    expect(fake.sent).toHaveLength(2);
    expect(mailEntries(rt).filter((e) => e.data.step === "capped").at(-1)!.summary).toMatch(/hourly cap of 2/);
    expect((await mailView(rt)).kitchens[0].leftThisHour).toBe(0);
  });

  it("holds the whole service to its daily cap", async () => {
    process.env.DOCK_MAIL_DAILY = "1";
    const { rt, session, ref } = await kaari();
    const fake = new FakeTransport();
    setMailTransport(rt, fake);
    await confirmed(rt, ref, fake);
    await order(rt, session);
    await flush(rt);
    expect(fake.sent).toHaveLength(1);
    expect(mailEntries(rt).at(-1)!.summary).toMatch(/cap of 1 mails a day/);
  });

  it("places the order at once when the mail service is slow, and records a failure without touching it", async () => {
    const { rt, session, ref } = await kaari();
    const fake = new FakeTransport();
    setMailTransport(rt, fake);
    await confirmed(rt, ref, fake);
    fake.delayMs = 1500;
    const t0 = Date.now();
    const o = await order(rt, session);
    expect(o.status).toBe("committed");
    expect(Date.now() - t0).toBeLessThan(1000); // the order did not wait for the mail
    fake.delayMs = 0;
    fake.fail = { code: "validation_error", status: 403, message: "You can only send testing emails to your own email address.", permanent: true };
    const o2 = await order(rt, session);
    expect(o2.status).toBe("committed");
    await flush(rt);
    const failed = mailEntries(rt).find((e) => e.data.step === "failed")!;
    expect(failed.summary).toMatch(/failed after 1 try: validation_error \(403\): You can only send testing emails/);
    expect(failed.summary).toMatch(/The order is not affected/);
    expect(await receiptStatus(rt, o2)).toMatchObject({ emailed: false, status: "failed" });
    expect(rt.dock.ledger.verify().ok).toBe(true);
  });

  it("retries a busy provider, then gives up and records it", async () => {
    let calls = 0;
    const t = new ResendTransport("re_test", { fetch: (async () => (calls++, new Response(JSON.stringify({ name: "rate_limit_exceeded", message: "Too many requests" }), { status: 429 }))) as typeof fetch, sleep: async () => {} });
    const r = await t.send({ from: "a@b.co", to: "delivered@resend.dev", subject: "x", html: "x", text: "x", idempotencyKey: "k" });
    expect(calls).toBe(3);
    expect(r).toMatchObject({ ok: false, attempts: 3, status: 429, permanent: false });
    const ok = new ResendTransport("re_test", { fetch: (async (_u: string, init: RequestInit) => new Response(JSON.stringify({ id: (init.headers as Record<string, string>)["idempotency-key"] }), { status: 200 })) as unknown as typeof fetch });
    expect(await ok.send({ from: "a@b.co", to: "delivered@resend.dev", subject: "x", html: "x", text: "x", idempotencyKey: "evt-1" })).toEqual({ ok: true, id: "evt-1", attempts: 1 });
  });

  it("records 'no mail service configured' for a kitchen that opted in, and nothing for one that did not", async () => {
    const { rt, session, ref } = await kaari();
    setMailTransport(rt, null);
    const before = rt.dock.ledger.length;
    await order(rt, session);
    await flush(rt);
    expect(mailEntries(rt)).toHaveLength(0); // no address, no entry
    expect(rt.dock.ledger.length).toBeGreaterThan(before);
    await setAddress(rt, ref, ADDRESS, { by: "Sanna Koskinen", via: "test", lang: "fi" });
    await flush(rt);
    expect(mailEntries(rt).at(-1)!.summary).toMatch(/not sent: no mail service configured/);
  });

  it("stops at the stop link, and a bounce stops it too", async () => {
    const { rt, session, ref } = await kaari();
    const fake = new FakeTransport();
    setMailTransport(rt, fake);
    await confirmed(rt, ref, fake);
    await order(rt, session);
    await flush(rt);
    const stop = /\/ui-api\/mail\/stop\?t=([\w.-]+)/.exec(fake.sent[1].html)![1];
    expect(await stopByLink(rt, stop)).toMatchObject({ ok: true, already: false, masked: MASKED });
    await order(rt, session);
    await flush(rt);
    expect(fake.sent).toHaveLength(2);
    expect(mailEntries(rt).at(-1)!.summary).toMatch(/the kitchen stopped these emails/);
    // again, with a bounce
    await confirmed(rt, ref, fake);
    const o = await order(rt, session);
    await flush(rt);
    const view = await mailView(rt);
    const sent = view.mails.find((m) => m.orderId === o.orderId)!;
    fake.deliveries.set(sent.providerId!, "bounced");
    expect(await checkDelivery(rt, sent.mailId)).toBe("bounced");
    expect((await addressOf(rt, ref.orgId, { own: true })).state).toBe("bounced");
    expect((await addressOf(rt, ref.orgId, { own: true })).address).toBeUndefined(); // the address is deleted
    await removeAddress(rt, ref.orgId, { by: "Sanna Koskinen", via: "test" });
    expect((await addressOf(rt, ref.orgId, { own: true })).state).toBe("none");
  });
});

describe("the receipt", () => {
  const model: ReceiptModel = {
    kind: "receipt",
    kitchen: { orgId: "o", slug: "kaari", name: "Ravintola Kaari" },
    orderId: "ord_1",
    committedAt: "2026-11-14T12:05:00.000Z",
    deliveryDates: ["2026-11-16"],
    lines: [
      { productId: "VA-1010", name: "Lactose-free milk 10 L", quantity: 30, packSize: 10, unit: "L", unitPriceCents: 1290, lineTotalCents: 38700, depositCents: 300, taxRatePct: 14, deliveryDate: "2026-11-16" },
      { productId: "AR-2010", name: "Lactose-free milk 10 L (Arla)", quantity: 10, packSize: 10, unit: "L", unitPriceCents: 1370, lineTotalCents: 13700, taxRatePct: 14, deliveryDate: "2026-11-16", insteadOf: "Lactose-free milk 10 L" },
      { productId: "X-1", name: "Dish soap 5 L", quantity: 2, packSize: 5, unit: "L", unitPriceCents: 1250, lineTotalCents: 2500, taxRatePct: 25.5, deliveryDate: "2026-11-16" },
    ],
    goodsCents: 54900,
    depositCents: 300,
    vat: { byRate: [{ ratePct: 14, baseCents: 52400, vatCents: 7336 }, { ratePct: 25.5, baseCents: 2500, vatCents: 638 }], vatCents: 7974, incomplete: false },
    totalCents: 55200,
    totalWithVatCents: 63174,
    decidedBy: { kind: "person", name: "Aino Laine", role: "head_chef", at: "2026-11-14T12:04:00.000Z", verified: true },
    fingerprint: "ab12 cd34 ef56 7890",
    links: { order: "https://x.test/k/kaari/orders/ord_1", verify: "https://x.test/k/kaari/orders/ord_1#verify", keys: "https://x.test/.well-known/jwks.json" },
  };
  const ctx = { maskedTo: MASKED, stopUrl: "https://x.test/stop", settingsUrl: "https://x.test/k/kaari/agent#mail" };

  it("adds up, and says every figure the Finnish way in all three languages", () => {
    expect(model.lines.reduce((n, l) => n + l.lineTotalCents, 0)).toBe(model.goodsCents);
    expect(model.goodsCents + model.depositCents).toBe(model.totalCents);
    expect(model.totalCents + model.vat.vatCents).toBe(model.totalWithVatCents);
    const en = renderMail(model, { ...ctx, lang: "en" });
    const fi = renderMail(model, { ...ctx, lang: "fi" });
    const sv = renderMail(model, { ...ctx, lang: "sv" });
    const sp = (x: string) => x.replace(/\u00a0/g, " ");
    expect(sp(en.subject)).toBe("Order ord_1 placed: 552,00 €, delivery Mon 16.11.2026");
    expect(sp(fi.subject)).toBe("Tilaus ord_1 vastaanotettu: 552,00 €, toimitus ma 16.11.2026");
    expect(sp(sv.subject)).toBe("Beställning ord_1 lagd: 552,00 €, leverans mån 16.11.2026");
    for (const m of [en, fi, sv]) {
      for (const figure of ["387,00 €", "137,00 €", "25,00 €", "549,00 €", "3,00 €", "552,00 €", "73,36 €", "6,38 €", "631,74 €"]) expect(m.html.replace(/ /g, " ")).toContain(figure);
      expect(m.text.replace(/ /g, " ")).toContain("631,74 €");
      expect(m.html).toContain("Demo");
      expect(m.html).toContain("Junction 2026");
      expect(m.html).not.toMatch(/<img/); // nothing needs an image
      expect(m.html).toContain('<div style="display:none'); // the preheader
      expect(m.html.match(/#c0e021/gi)).toHaveLength(1); // the one lime accent
      expect(m.html).toContain(MASKED);
      expect(m.html).toContain("https://x.test/stop");
    }
    expect(en.html).toContain("Signed off by Aino Laine");
    expect(en.html).toContain("Substitute for Lactose-free milk 10 L");
    expect(en.html.replace(/ /g, " ")).toContain("VAT 25,5 % on 25,00 €");
    expect(fi.html).toContain("Kerromme sähköpostilla, jos jokin muuttuu: viive, puute tai korvaava tuote.");
    expect(fi.html).toContain("14.11.2026 klo 14.04");
    expect(sv.html).toContain("Vi mejlar dig om något ändras");
    expect(sv.html).toContain("kl. 14.04");
    expect(en.html).not.toMatch(/Valio Aimo</); // never the sender or header
    expect(en.html.indexOf("AimoPilot")).toBeLessThan(en.html.indexOf("Valio"));
  });

  it("says when a VAT rate is not known instead of a total it cannot state", () => {
    const m = renderMail({ ...model, vat: { byRate: [{ ratePct: null, baseCents: 54900, vatCents: null }], vatCents: 0, incomplete: true } }, { ...ctx, lang: "en" });
    expect(m.html).toContain("VAT rate not known");
    expect(m.html).not.toContain("Total incl. VAT");
  });

  it("builds the receipt from a real order and the gate's own figures", async () => {
    const { rt, session, ref } = await kaari();
    const o = await order(rt, session, 6);
    const m = await receiptModel({ orgId: ref.orgId, slug: "kaari", kitchenName: ref.name }, o);
    expect(m.lines.reduce((n, l) => n + l.lineTotalCents + (l.depositCents ?? 0), 0)).toBe(m.totalCents);
    expect(m.decidedBy).toMatchObject({ kind: "agent", agentName: "Kaari's buyer agent", limitCents: 10000 });
    expect(m.fingerprint).toMatch(/^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/);
    const en = renderMail(m, { ...ctx, lang: "en" });
    expect(en.html).toContain("Placed by Kaari&#39;s buyer agent on its own, within your limit of 100,00");
  });

  it("renders every change mail in three languages, with what happened and what to do", () => {
    const base = { kind: "changed" as const, kitchen: model.kitchen, links: { store: "https://x.test/k/kaari", order: "https://x.test/k/kaari/orders/ord_1" } };
    const cases = [
      { ...base, change: "cannot_come" as const, orderId: "ord_1", product: { name: "Lactose-free milk 10 L", amount: 600, unit: "L" }, date: "2026-11-16", backOn: "2026-11-19", reasonCode: "not_orderable", source: "order" as const, substitutes: [{ rank: "best" as const, name: "Arla lactose-free 10 L", why: "same kind, +0,08 € per litre", insidePreferences: true }] },
      { ...base, change: "substituted" as const, orderId: "ord_2", product: { name: "Lactose-free milk 10 L" }, date: "2026-11-16", substitute: { name: "Arla lactose-free 10 L", insidePreferences: false }, outcome: { status: "pending_approval", totalCents: 13700, approver: "Aino Laine" } },
      { ...base, change: "renewal_held" as const, product: { name: "Lactose-free milk 10 L" }, date: "2026-11-19", reason: "Portions up 38 % over four weeks.", amounts: { usual: 80, latest: 110, unit: "L" } },
      { ...base, change: "refused" as const, totalCents: 250000, reasonCode: "weekly_budget", reason: "Over the weekly budget." },
      { ...base, change: "declined" as const, orderId: "ord_3", totalCents: 12000, by: "Aino Laine" },
      { ...base, change: "expired" as const, orderId: "ord_4", totalCents: 12000 },
      { ...base, change: "withdrawn" as const, orderId: "ord_5", totalCents: 12000 },
    ];
    for (const c of cases)
      for (const lang of ["en", "fi", "sv"] as const) {
        const m = renderMail(c, { ...ctx, lang });
        expect(m.subject.length).toBeGreaterThan(10);
        expect(m.subject).not.toMatch(/undefined|NaN/);
        expect(m.html).not.toMatch(/undefined|NaN/);
        expect(m.text).not.toMatch(/undefined|NaN/);
      }
    const en = renderMail(cases[0], { ...ctx, lang: "en" });
    expect(en.subject).toBe("Lactose-free milk 10 L cannot come on Mon 16.11.2026");
    expect(en.html).toContain("It is not available; it can come again on Thu 19.11.2026.");
    expect(en.html).toContain("Arla lactose-free 10 L");
    expect(renderMail(cases[3], { ...ctx, lang: "fi" }).subject.replace(/ /g, " ")).toBe("Tilausta ei tehty: 2 500,00 €");
  });
});

describe("the conversation's adapter", () => {
  it("reads the buyer's words in three languages", () => {
    expect(mailWordsOf("email receipts to chef@example.com")).toEqual({ kind: "set", address: "chef@example.com" });
    expect(mailWordsOf("lähetä kuitit osoitteeseen keittio@ravintola.fi")).toEqual({ kind: "set", address: "keittio@ravintola.fi" });
    expect(mailWordsOf("skicka kvitton till kock@restaurang.fi")).toEqual({ kind: "set", address: "kock@restaurang.fi" });
    expect(mailWordsOf("chef@example.com")).toEqual({ kind: "set", address: "chef@example.com" });
    expect(mailWordsOf("stop the emails")).toEqual({ kind: "stop" });
    expect(mailWordsOf("lopeta sähköpostit")).toEqual({ kind: "stop" });
    expect(mailWordsOf("sluta skicka mejl")).toEqual({ kind: "stop" });
    expect(mailWordsOf("which address do you have?")).toEqual({ kind: "which" });
    expect(mailWordsOf("mihin osoitteeseen lähetät kuitit?")).toEqual({ kind: "which" });
    expect(mailWordsOf("vilken adress har du?")).toEqual({ kind: "which" });
    expect(mailWordsOf("1000 litres of lactose-free milk by Monday")).toBeUndefined();
    expect(mailWordsOf("stop the order")).toBeUndefined();
    expect(mailWordsOf("email receipts to chef@")).toEqual({ kind: "set_invalid" });
    // Asked for without an address: where they go, or "tell me the address"; never the model's "I can't email".
    expect(mailWordsOf("can you email me the receipts?")).toEqual({ kind: "ask" });
    expect(mailWordsOf("email us when an order is placed")).toEqual({ kind: "ask" });
    expect(mailWordsOf("voitko lähettää kuitit sähköpostiin?")).toEqual({ kind: "ask" });
    expect(mailWordsOf("kan du skicka kvittot per mejl?")).toEqual({ kind: "ask" });
    expect(mailWordsOf("send 20 l of milk to the usual address")).toBeUndefined();
    expect(mailWordsOf("20 l of milk for Friday and email me the receipt")).toBeUndefined();
  });

  it("asked for receipts by email without an address: asks for it once, in the kitchen's words", async () => {
    const { rt, k } = await kaari();
    setMailTransport(rt, new FakeTransport());
    expect((await answerMailWords(rt, k, { kind: "ask" }, { person: { name: "Kaari (kaari)" }, via: "thread", lang: "en" })).reply).toBe("Tell me the address and I'll email each order's receipt there, and let you know if anything changes.");
    expect((await answerMailWords(rt, k, { kind: "ask" }, { person: undefined, via: "thread", lang: "fi" })).reply).toMatch(/^Kerro osoite/);
  });

  it("offers email once per conversation, needs the signed-in person to set it, then says where the receipt went", async () => {
    const { rt, session, k } = await kaari();
    const fake = new FakeTransport();
    setMailTransport(rt, fake);
    const o = await order(rt, session);
    expect(await mailFactAfterOrder(rt, k, o, { lang: "en", threadId: "th_1" })).toBe("Shall I email the receipt? I'd need an address.");
    expect(await mailFactAfterOrder(rt, k, o, { lang: "en", threadId: "th_1" })).toBeUndefined(); // once
    expect(await mailFactAfterOrder(rt, k, o, { lang: "fi", threadId: "th_2" })).toBe("Lähetänkö kuitin sähköpostiin? Tarvitsisin osoitteen.");

    const intent = mailWordsOf(`email receipts to ${ADDRESS}`)!;
    expect((await answerMailWords(rt, k, intent, { person: undefined, via: "thread" })).reply).toMatch(/Only the kitchen's signed-in person/);
    expect((await answerMailWords(rt, k, intent, { person: { name: "Kaari (kaari)", callOnly: true }, via: "call" })).changed).toBe(false);
    const set = await answerMailWords(rt, k, intent, { person: { name: "Kaari (kaari)" }, via: "thread", lang: "en" });
    expect(set).toEqual({ reply: `I've sent a confirmation to ${MASKED}. Once you click the link in it, receipts and alerts go there, and nothing is sent before that.`, changed: true });
    expect(await mailFactAfterOrder(rt, k, o, { lang: "en", threadId: "th_3" })).toBe(`Once you confirm ${MASKED} from the email I sent, receipts go there.`);
    expect((await answerMailWords(rt, k, { kind: "which" }, { person: { name: "Kaari (kaari)" }, via: "thread" })).reply).toContain(ADDRESS); // the kitchen itself
    expect((await answerMailWords(rt, k, { kind: "which" }, { person: undefined, via: "thread" })).reply).toContain(MASKED);

    await flush(rt);
    const link = /\/mail\/confirm\?t=([\w.-]+)/.exec(fake.sent[0].html)![1];
    await confirmAddress(rt, link);
    const o2 = await order(rt, session);
    expect(await mailFactAfterOrder(rt, k, o2, { lang: "en", threadId: "th_1" })).toBe(`I've emailed the receipt to ${MASKED} and will email you if anything changes.`);
    expect((await answerMailWords(rt, k, { kind: "stop" }, { person: { name: "Kaari (kaari)" }, via: "thread", lang: "sv" })).reply).toBe(`Klart: inga fler mejl till ${MASKED}. Kvittona finns kvar i webbutiken.`);
    expect(await mailFactAfterOrder(rt, k, o2, { lang: "en", threadId: "th_9" })).toBe("Shall I email the receipt? I'd need an address.");
  });
});
