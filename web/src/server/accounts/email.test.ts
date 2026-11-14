import { beforeEach, describe, expect, it } from "vitest";
import { POST as signupPost } from "@/app/ui-api/account/signup/route";
import { GET as mailGet } from "@/app/ui-api/kitchens/[kitchen]/mail/route";
import { resetMemoryService } from "@/server/memory/runtime";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { addressOf, setMailTransport } from "../notify/service";
import { FakeTransport } from "../notify/transport";
import { finishInterview } from "./interview-run";

/**
 * The business email at sign-up (accounts/email.ts): required for an ordinary sign-up, optional for a fresh kitchen;
 * it becomes the kitchen's pending contact in the mail module once the kitchen exists, with one confirmation mail;
 * a refused send is said as not sent; the address is masked to everyone but the kitchen's own person and is never in
 * the ledger. Sends here go only to Resend's test inbox.
 */
const BASE = "http://dock.test";
const TEST_INBOX = "delivered@resend.dev";

beforeEach(() => {
  resetRuntime();
  resetMemoryService();
  process.env.DOCK_CATALOG = "seed";
  process.env.DOCK_MEMORY_LLM = "off";
});

const signup = (body: Record<string, unknown>, ip = "198.51.100.61") => signupPost(new Request(`${BASE}/ui-api/account/signup`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }));
const ANSWERS = { diet: [], skipRest: true };

describe("the business email at sign-up", () => {
  it("is required for an ordinary sign-up, and checked", async () => {
    const none = await signup({ restaurant: "Bistro Posti", username: "posti", password: "a long enough password" });
    expect(none.status).toBe(400);
    expect(((await none.json()) as { error: { code: string } }).error.code).toBe("email_missing");
    const bad = await signup({ restaurant: "Bistro Posti", username: "posti", password: "a long enough password", email: "not an address" });
    expect(bad.status).toBe(400);
    const ok = await signup({ restaurant: "Bistro Posti", username: "posti", password: "a long enough password", email: TEST_INBOX });
    expect(ok.status).toBe(201);
    const body = await ok.text();
    expect(body).not.toContain(TEST_INBOX);
    const rt = await getRuntime();
    expect((await rt.accounts.get("posti"))!.mailPending?.address).toBe(TEST_INBOX);
  });

  it("becomes the kitchen's pending contact with one confirmation when the kitchen is made; masked to others, never in the ledger", async () => {
    const rt = await getRuntime();
    const fake = new FakeTransport();
    setMailTransport(rt, fake);
    const r = await signup({ restaurant: "Bistro Kirje", username: "kirje", password: "a long enough password", email: TEST_INBOX });
    const cookie = r.headers.get("set-cookie")!.split(";")[0];
    const done = await finishInterview(rt, (await rt.accounts.get("kirje"))!, ANSWERS, undefined, { lang: "en", clientAddress: "198.51.100.62" });
    expect(done.mail).toMatchObject({ state: "pending", sent: true });
    expect(done.mail.masked).not.toBe(TEST_INBOX);
    expect(fake.sent.map((m) => m.to)).toEqual([TEST_INBOX]);
    const a = (await rt.accounts.get("kirje"))!;
    expect(a.mailPending).toBeUndefined();
    expect(await addressOf(rt, a.kitchen!.orgId, { own: false })).toMatchObject({ state: "pending", masked: done.mail.masked });
    expect((await addressOf(rt, a.kitchen!.orgId, { own: false })).address).toBeUndefined();
    expect((await addressOf(rt, a.kitchen!.orgId, { own: true })).address).toBe(TEST_INBOX);
    // Through the store's route: the full address only with the kitchen's own sign-in.
    const own = (await (await mailGet(new Request(`${BASE}/ui-api/kitchens/kirje/mail`, { headers: { cookie } }), { params: Promise.resolve({ kitchen: "kirje" }) } as never)).json()) as { address?: string };
    expect(own.address).toBe(TEST_INBOX);
    expect(JSON.stringify(rt.dock.ledger.entries())).not.toContain(TEST_INBOX);
  });

  it("a refused send is said as not sent yet", async () => {
    const rt = await getRuntime();
    const fake = new FakeTransport();
    fake.fail = { code: "validation_error", message: "You can only send testing emails to your own email address", permanent: true, status: 403 };
    setMailTransport(rt, fake);
    await signup({ restaurant: "Bistro Esto", username: "esto", password: "a long enough password", email: TEST_INBOX });
    const done = await finishInterview(rt, (await rt.accounts.get("esto"))!, ANSWERS);
    expect(done.mail).toMatchObject({ state: "pending", sent: false, reason: "failed" });
    const view = await addressOf(rt, (await rt.accounts.get("esto"))!.kitchen!.orgId, { own: true });
    expect(view.confirmation?.outcome).toBe("failed");
  });

  it("is optional for a fresh kitchen: one click, no address", async () => {
    const rt = await getRuntime();
    const { startFreeKitchen } = await import("../demo/fresh");
    const r = await startFreeKitchen(rt, { address: "198.51.100.63" });
    expect(r.created).toBe(true);
    const a = (await rt.accounts.get(r.username))!;
    expect(a.mailPending).toBeUndefined();
    expect((await addressOf(rt, a.kitchen!.orgId, { own: true })).state).toBe("none");
  });
});
