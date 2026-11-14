import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as handoff from "@/app/k/handoff/route";
import * as planRoute from "@/app/ui-api/plan/[kitchen]/route";
import { createTrustRegistry } from "@/core/mandate";
import { getRuntime, resetRuntime } from "../runtime";
import { resolveMenuKitchen } from "../agent/menu/kitchens";
import { open, seal, SealingAccountStore } from "./sealed";
import { AccountService } from "./service";
import { InMemoryAccountStore } from "./store";
import { DEFAULT_TERMS } from "./terms";
import { sessionCookieFor } from "./test-session";

const ADDR = "198.51.100.9";
const SECRET = "a-test-secret-of-enough-length-1";
const env = { ...process.env };
beforeEach(() => {
  resetRuntime();
  process.env.DOCK_CATALOG = "seed";
});
afterEach(() => {
  process.env = { ...env };
});

/** A service on its own sealing store over a plain in-memory store, so the test can look at what is "on disk". */
async function sealedService(secret: () => string | undefined = () => SECRET, mustSeal = () => false) {
  const rt = await getRuntime();
  const disk = new InMemoryAccountStore();
  const store = new SealingAccountStore(disk, secret, mustSeal);
  const registry = createTrustRegistry([]);
  const svc = new AccountService({ store, registry, passkeys: rt.passkeys, kitchens: rt.kitchens, dock: rt.dock });
  return { rt, disk, store, svc, registry };
}

describe("kitchen keys at rest", () => {
  it("AES-256-GCM under a derived key: opens with the secret and the same account, nothing else", () => {
    const aad = Buffer.from("aalto|org_acct_aalto|kid1");
    const box = seal({ privateJwk: { kty: "OKP", crv: "Ed25519", d: "secret-d", x: "x" }, mandateToken: "tok" }, SECRET, aad);
    expect(JSON.stringify(box)).not.toMatch(/secret-d|tok"/);
    expect(open(box, SECRET, aad).privateJwk.d).toBe("secret-d");
    expect(() => open(box, "another-secret-of-enough-length", aad)).toThrow();
    expect(() => open(box, SECRET, Buffer.from("other|org_acct_other|kid1"))).toThrow(); // moved to another account
    expect(() => open({ ...box, ct: box.ct.slice(0, -2) + "AA" }, SECRET, aad)).toThrow(); // tampered
  });

  it("the database holds neither the private key nor the mandate token; the service reads them as before", async () => {
    const { disk, svc, registry } = await sealedService();
    await svc.signUp({ restaurant: "Ravintola Aalto", username: "aalto", password: "a-long-password" }, ADDR);
    const a = await svc.signKitchen("aalto", DEFAULT_TERMS);
    const raw = JSON.stringify(await disk.get("aalto"));
    expect(raw).not.toContain(a.kitchen!.key.privateJwk.d as string);
    expect(raw).not.toContain(a.kitchen!.mandateToken);
    expect(raw).toContain('"sealed"');
    const k = (await svc.kitchenOf("aalto"))!.kitchen;
    expect(k.mandateToken).toBe(a.kitchen!.mandateToken);
    expect(registry.get(k.key.kid)).toBeTruthy();
  });

  it("migrates kitchens stored in plain form; a wrong secret leaves sign-in working and the kitchen closed (503)", async () => {
    const rt = await getRuntime();
    const disk = new InMemoryAccountStore();
    const plain = new AccountService({ store: disk, registry: createTrustRegistry([]), passkeys: rt.passkeys, kitchens: rt.kitchens, dock: rt.dock });
    await plain.signUp({ restaurant: "Bistro", username: "bistro", password: "a-long-password" }, ADDR);
    const before = (await plain.signKitchen("bistro", DEFAULT_TERMS)).kitchen!;
    expect(JSON.stringify(await disk.get("bistro"))).toContain(before.key.privateJwk.d as string); // the old, plain form

    const sealing = new SealingAccountStore(disk, () => SECRET, () => false);
    expect(await sealing.migrate()).toBe(1);
    expect(JSON.stringify(await disk.get("bistro"))).not.toContain(before.key.privateJwk.d as string);
    expect((await sealing.get("bistro"))!.kitchen!.key.privateJwk.d).toBe(before.key.privateJwk.d);
    expect(await sealing.migrate()).toBe(0);

    const wrong = new AccountService({ store: new SealingAccountStore(disk, () => "the-wrong-secret-of-some-length", () => false), registry: createTrustRegistry([]), passkeys: rt.passkeys, kitchens: rt.kitchens, dock: rt.dock });
    expect((await wrong.signIn({ username: "bistro", password: "a-long-password" }, ADDR)).account.username).toBe("bistro");
    await expect(wrong.kitchenOf("bistro")).rejects.toMatchObject({ status: 503, code: "account_key_unreadable" });
    await expect(wrong.signKitchen("bistro", DEFAULT_TERMS)).rejects.toMatchObject({ status: 503 });
  });

  it("on a public host without the secret no kitchen key is written at all", async () => {
    const { svc, disk } = await sealedService(() => undefined, () => true);
    await svc.signUp({ restaurant: "Cafe", username: "cafe-x", password: "a-long-password" }, ADDR);
    await expect(svc.signKitchen("cafe-x", DEFAULT_TERMS)).rejects.toMatchObject({ status: 503, code: "account_key_secret_missing" });
    expect((await disk.get("cafe-x"))?.kitchen).toBeUndefined();
  });
});

describe("one-time phone links", () => {
  it("are stored hashed, survive a restart (a new service on the same store), and work once", async () => {
    const { store, svc, rt } = await sealedService();
    await svc.signUp({ restaurant: "Bistro", username: "bistro", password: "a-long-password" }, ADDR);
    const { token } = await svc.oneTimeLink("bistro", "device");
    expect(JSON.stringify(await store.getLink(token))).toBe(undefined); // only the hash is a key
    const after = new AccountService({ store, registry: createTrustRegistry([]), passkeys: rt.passkeys, kitchens: rt.kitchens, dock: rt.dock });
    expect(await after.linkAccount(token, "session")).toBeUndefined(); // another purpose
    expect(await after.linkAccount(token, "device")).toBe("bistro");
    expect(await after.linkAccount(token, "device", true)).toBe("bistro");
    expect(await after.linkAccount(token, "device")).toBeUndefined();
  });

  it("the call QR's link signs a phone in once and goes on to a path on this site only", async () => {
    const rt = await getRuntime();
    await rt.accounts.signUp({ restaurant: "Bistro", username: "bistro", password: "a-long-password" }, ADDR);
    const { token } = await rt.accounts.oneTimeLink("bistro", "session");
    const go = (next: string) => handoff.GET(new Request(`https://dock.test/k/handoff?t=${token}&next=${encodeURIComponent(next)}`));
    const first = await go("//evil.example/x");
    expect(first.status).toBe(303);
    expect(first.headers.get("location")).toBe("https://dock.test/k");
    expect(first.headers.get("set-cookie")).toMatch(/^dock_account=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax/);
    const again = await go("/call?k=bistro");
    expect(again.headers.get("location")).toBe("https://dock.test/k?handoff=expired");
    expect(again.headers.get("set-cookie")).toBeNull();
  });
});

describe("the menu planner for an account's kitchen", () => {
  it("opens for its own account only, with a menu mandate never wider than the kitchen's", async () => {
    const rt = await getRuntime();
    await rt.accounts.signUp({ restaurant: "Ravintola Aalto", username: "aalto", password: "a-long-password" }, ADDR);
    const buyer = (await rt.accounts.signKitchen("aalto", { ...DEFAULT_TERMS, groups: ["10"], forbid: ["nuts"], require: ["lactose_free"] })).kitchen!.mandate;
    const menu = (await resolveMenuKitchen("aalto", rt))!;
    expect(menu.mandate).toMatchObject({ perOrderLimitCents: buyer.perOrderLimitCents, weeklyBudgetCents: buyer.weeklyBudgetCents, allowedCategories: buyer.allowedCategories, approvers: buyer.approvers });
    expect(menu.mandate.forbiddenAllergens).toEqual(expect.arrayContaining(["nuts", "lactose"]));
    expect((await rt.dock.authenticate(menu.mandateToken, menu.agentId)).mandate.issuer.orgId).toBe(buyer.issuer.orgId);
    const get = (cookie?: string) => planRoute.GET(new Request("https://dock.test/ui-api/plan/aalto", { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ kitchen: "aalto" }) } as never);
    expect((await get()).status).toBe(401);
    expect((await get(await sessionCookieFor(rt, "hotel-lumo"))).status).toBe(403);
    const own = await get(await sessionCookieFor(rt, "aalto"));
    expect(own.status).toBe(200);
    expect((await own.json()).kitchen).toMatchObject({ slug: "aalto", name: "Ravintola Aalto" });
  });
});
