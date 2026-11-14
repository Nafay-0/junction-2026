import { beforeEach, describe, expect, it } from "vitest";
import { POST as freshPost } from "@/app/ui-api/account/fresh/route";
import { POST as demoPost } from "@/app/ui-api/kitchens/[kitchen]/demo/route";
import { resetMemoryService } from "@/server/memory/runtime";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { ACCOUNT_COOKIE } from "../accounts/http";
import { PRODUCT_GROUPS } from "../accounts/terms";
import { FREE_TERMS, giveFreeKitchenLimit, keepFreeKitchen, renameFreeKitchen, startFreeKitchen, sweepFreeKitchens } from "./fresh";

/**
 * A fresh kitchen (server/demo/fresh.ts): one click, no form, free-play rules, empty memory and history, private to
 * its browser, given back when pressed again, gone after 24 hours without use unless kept, and kept as an ordinary
 * account without losing anything.
 */

const BASE = "http://dock.test";
const ADDR = "198.51.100.90";

beforeEach(() => {
  resetRuntime();
  resetMemoryService();
  process.env.DOCK_CATALOG = "seed";
  process.env.DOCK_MEMORY_LLM = "off";
});

async function fresh(now = new Date()) {
  const rt = await getRuntime();
  const r = await startFreeKitchen(rt, { address: ADDR, now });
  const a = (await rt.accounts.get(r.username))!;
  return { rt, r, a, cookie: `${ACCOUNT_COOKIE}=${r.signedIn!.token}` };
}

const post = (url: string, body: unknown, cookie = "") => new Request(`${BASE}${url}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

describe("a fresh kitchen", () => {
  it("is made with one call: a demo account marked fresh, free-play rules, empty memory and history, deliveries any day", async () => {
    const { rt, r, a } = await fresh();
    expect(r.created).toBe(true);
    expect(r.next).toBe(`/k/${a.username}`);
    expect(a.username).toMatch(/^fresh-[a-z]+-[a-z0-9]+$/);
    expect(a.kind).toBe("own");
    expect(a.demo).toBeTruthy();
    expect(a.free?.kept).toBeUndefined();
    const k = a.kitchen!;
    expect(k.terms).toMatchObject({ perOrderLimitEur: 50_000, weeklyBudgetEur: 200_000, require: [], forbid: [], maxLeadDays: 30, substituteMaxIncreasePct: 1000 });
    expect(k.terms.groups.sort()).toEqual(PRODUCT_GROUPS.map((g) => g.id).sort());
    expect(k.terms.nutrition).toBeUndefined();
    expect(k.mandate.substitution.maxPriceIncreasePct).toBe(1000);
    const profile = (await rt.kitchens.getProfile(k.orgId))!;
    expect(profile.history).toEqual([]);
    expect(profile.memory?.items ?? []).toEqual([]);
    expect(profile.deliveryWeekdays).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(rt.dock.ledger.entries().some((e) => e.data.step === "fresh_kitchen" && e.data.visitor === true)).toBe(true);
    expect(rt.accounts.view(a).free?.kept).toBe(false);
  });

  it("an ordinary order goes through alone, through the same gate", async () => {
    const { rt, a } = await fresh();
    const k = a.kitchen!;
    const session = await rt.dock.authenticate(k.mandateToken, k.agentId);
    const req = await rt.dock.openRequest(session, { text: "milk" });
    const q = await rt.dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: "VA-1001", quantity: 40 }] });
    const o = await rt.dock.placeOrder(session, { requestId: req.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) });
    expect(o.status).toBe("committed");
  });

  it("pressed again in the same browser gives back the same kitchen; start over makes a new one and the old goes", async () => {
    const { rt, a } = await fresh();
    const again = await startFreeKitchen(rt, { current: a, address: ADDR });
    expect(again).toMatchObject({ created: false, username: a.username });
    const anew = await startFreeKitchen(rt, { current: a, address: ADDR, fresh: true });
    expect(anew.created).toBe(true);
    expect(anew.username).not.toBe(a.username);
    expect(await rt.accounts.get(a.username)).toBeUndefined();
  });

  it("through the route: the same cookie gets its kitchen back; another browser gets one of its own", async () => {
    const first = await freshPost(post("/ui-api/account/fresh", {}));
    expect(first.status).toBe(201);
    const cookie = first.headers.get("set-cookie")!.split(";")[0];
    const { next } = (await first.json()) as { next: string };
    const same = await freshPost(post("/ui-api/account/fresh", {}, cookie));
    expect(same.status).toBe(200);
    expect(((await same.json()) as { next: string }).next).toBe(next);
    const other = await freshPost(post("/ui-api/account/fresh", {}));
    expect(((await other.json()) as { next: string }).next).not.toBe(next);
  });

  it("goes after 24 hours without use (the ledger keeps it, marked a visitor's); a kept one stays", async () => {
    const then = new Date(Date.now() - 25 * 3_600_000);
    const one = await fresh(then);
    const two = await fresh(then);
    await keepFreeKitchen(two.rt, two.a, { login: "my-bistro", password: "a long enough password" });
    const n = one.rt.dock.ledger.length;
    const gone = await sweepFreeKitchens(one.rt);
    expect(gone).toEqual([one.a.username]);
    expect(await one.rt.accounts.get(one.a.username)).toBeUndefined();
    expect(await one.rt.accounts.get(two.a.username)).toBeDefined();
    expect(one.rt.dock.ledger.length).toBeGreaterThan(n);
    expect(one.rt.dock.ledger.entries().some((e) => e.data.step === "fresh_kitchen_expired" && e.data.visitor === true)).toBe(true);
  });

  it("kept: signs in with the chosen name and password, the same kitchen, nothing lost", async () => {
    const { rt, a } = await fresh();
    await renameFreeKitchen(rt, a, "Bistro Testi");
    await keepFreeKitchen(rt, (await rt.accounts.get(a.username))!, { login: "bistro-testi", password: "a long enough password" });
    const s = await rt.accounts.signIn({ username: "bistro-testi", password: "a long enough password" }, ADDR);
    expect(s.account.username).toBe(a.username);
    expect(s.account.restaurant).toBe("Bistro Testi");
    expect(s.account.kitchen).toBe(a.username);
    expect((await rt.accounts.get(a.username))!.kitchen!.orgId).toBe(a.kitchen!.orgId);
    // A name in use is refused.
    const b = await fresh();
    await expect(keepFreeKitchen(rt, b.a, { login: "bistro-testi", password: "another long password" })).rejects.toMatchObject({ status: 409 });
  });

  it("given a limit: only with a passkey for its signer, then 250 € alone and the rest as before", async () => {
    const { rt, a } = await fresh();
    await expect(giveFreeKitchenLimit(rt, a)).rejects.toMatchObject({ status: 409, code: "device_needed" });
    const signer = (await rt.passkeys.store.findApprover(a.kitchen!.orgId, a.kitchen!.approverRole))!;
    await rt.passkeys.store.putCredential({ credentialId: "cred_test", approverId: signer.approverId, publicKey: "x", counter: 0, rpId: "dock.test", deviceType: "singleDevice", backedUp: false, createdAt: new Date().toISOString() });
    await giveFreeKitchenLimit(rt, (await rt.accounts.get(a.username))!);
    const k = (await rt.accounts.get(a.username))!.kitchen!;
    expect(k.terms.perOrderLimitEur).toBe(250);
    expect(k.terms.groups.length).toBe(FREE_TERMS.groups.length);
    expect(k.mandate.perOrderLimitCents).toBe(25_000);
  });

  it("is private: another browser can neither use nor change it", async () => {
    const { a } = await fresh();
    const other = await fresh();
    const ctx = { params: Promise.resolve({ kitchen: a.username }) } as never;
    for (const body of [{ action: "rename", name: "Stolen" }, { action: "keep", login: "thief", password: "a long enough password" }, { action: "limit" }, { action: "sample" }]) {
      const r = await demoPost(post(`/ui-api/kitchens/${a.username}/demo`, body, other.cookie), ctx);
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
    const rt = await getRuntime();
    expect((await rt.accounts.get(a.username))!.restaurant).toBe(a.restaurant);
  });
});

describe("the conversation's opening for a fresh kitchen", () => {
  it("one sentence, in the buyer's language, only for a fresh kitchen", async () => {
    const { rt, a } = await fresh();
    const { freeKitchenOpening } = await import("./thread");
    expect((await freeKitchenOpening(rt, a.username, "en"))?.say).toBe("A fresh kitchen with no rules: order anything, and I'll learn as you go.");
    expect((await freeKitchenOpening(rt, a.username, "fi"))?.say).toMatch(/Uusi keittiö/);
    expect(await freeKitchenOpening(rt, "kaari", "en")).toBeUndefined();
  });
});

describe("a fresh kitchen in other people's lists", () => {
  it("never appears in another visitor's kitchen list, and its store refuses another browser", async () => {
    const { a } = await fresh();
    const other = await fresh();
    const rt = await getRuntime();
    const { listConsoleKitchens } = await import("../console-kitchens");
    const theirs = await listConsoleKitchens(undefined, rt.accounts.view(other.a));
    expect(theirs.some((k) => k.slug === a.username)).toBe(false);
    const { consoleKitchen } = await import("../authz");
    await expect(consoleKitchen(new Request(`${BASE}/ui-api/kitchens/${a.username}/portal`, { headers: { cookie: other.cookie } }), rt, a.username)).rejects.toMatchObject({ status: 403 });
  });
});
