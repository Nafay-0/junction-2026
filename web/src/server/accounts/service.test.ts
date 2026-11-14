import { beforeEach, describe, expect, it } from "vitest";
import { isDockError } from "@/core/errors";
import { createTrustRegistry } from "@/core/mandate";
import { RateLimiter } from "../limits";
import { getRuntime, resetRuntime } from "../runtime";
import { AccountService, SIGN_IN_FAILURES_PER_ACCOUNT, tokenHash } from "./service";
import { InMemoryAccountStore } from "./store";
import { DEFAULT_TERMS } from "./terms";
import { TEST_ACCOUNTS } from "./test-accounts";

beforeEach(() => {
  resetRuntime();
  process.env.DOCK_CATALOG = "seed";
});

const ADDR = "198.51.100.7";

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    if (isDockError(err)) return `${err.status} ${err.code}`;
    throw err;
  }
}

/** A service of its own (own store, clock and limiter) on the runtime's Dock. */
async function fresh(clock = { t: Date.parse("2026-11-14T10:00:00Z") }) {
  const rt = await getRuntime();
  const store = new InMemoryAccountStore();
  const svc = new AccountService({ store, registry: createTrustRegistry([]), passkeys: rt.passkeys, kitchens: rt.kitchens, dock: rt.dock, now: () => new Date(clock.t), limiter: new RateLimiter() });
  return { rt, svc, store, clock };
}

describe("accounts: sign-up, sign-in, sessions", () => {
  it("signs up with a restaurant name, a username and a password only; the hash is stored, never shown", async () => {
    const { svc, store } = await fresh();
    const s = await svc.signUp({ restaurant: "Ravintola Aalto", username: " Aalto ", password: "a-long-password" }, ADDR);
    expect(s.account).toMatchObject({ username: "aalto", restaurant: "Ravintola Aalto", kind: "own", shared: false });
    expect(JSON.stringify(s.account)).not.toMatch(/scrypt|passwordHash|a-long-password/);
    const stored = await store.get("aalto");
    expect(stored?.passwordHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(stored)).not.toContain("a-long-password");
    // Only the token's hash is stored.
    expect(await store.getSession(tokenHash(s.token))).toMatchObject({ username: "aalto" });
    expect(await store.getSession(s.token)).toBeUndefined();
  });

  it("refuses a taken username, a reserved one, a short password and a missing name", async () => {
    const { svc } = await fresh();
    await svc.signUp({ restaurant: "Cafe One", username: "cafe-one", password: "0123456789" }, ADDR);
    expect(await code(svc.signUp({ restaurant: "Cafe Two", username: "CAFE-ONE", password: "0123456789" }, ADDR))).toBe("409 username_taken");
    expect(await code(svc.signUp({ restaurant: "Kaari", username: "kaari", password: "0123456789" }, ADDR))).toBe("400 username_reserved");
    expect(await code(svc.signUp({ restaurant: "Cafe", username: "cafe-x", password: "short" }, ADDR))).toBe("400 password_too_short");
    expect(await code(svc.signUp({ username: "cafe-y", password: "0123456789" }, ADDR))).toBe("400 restaurant_invalid");
    expect(await code(svc.signUp({ restaurant: "Cafe", username: "../etc", password: "0123456789" }, ADDR))).toBe("400 username_shape");
  });

  it("an unknown username and a wrong password get exactly the same answer", async () => {
    const { svc } = await fresh();
    await svc.signUp({ restaurant: "Bistro", username: "bistro", password: "right-password" }, ADDR);
    const caught = (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => e as { status: number; code: string; message: string });
    const wrong = await caught(svc.signIn({ username: "bistro", password: "wrong-password" }, ADDR));
    const unknown = await caught(svc.signIn({ username: "nobody-here", password: "wrong-password" }, ADDR));
    expect(isDockError(wrong) && isDockError(unknown)).toBe(true);
    expect([wrong!.status, wrong!.code, wrong!.message]).toEqual([unknown!.status, unknown!.code, unknown!.message]);
    expect((await svc.signIn({ username: "BISTRO", password: "right-password" }, ADDR)).account.username).toBe("bistro");
  });

  it("limits failed sign-ins per account (any address) and per address (any account)", async () => {
    const { svc, clock } = await fresh();
    await svc.signUp({ restaurant: "Bistro", username: "bistro", password: "right-password" }, ADDR);
    for (let i = 0; i < SIGN_IN_FAILURES_PER_ACCOUNT.limit; i++) expect(await code(svc.signIn({ username: "bistro", password: `guess-${i}-xxxx` }, `203.0.113.${i}`))).toBe("401 sign_in_failed");
    // Locked for this account, even with the right password and from a new address ...
    expect(await code(svc.signIn({ username: "bistro", password: "right-password" }, "192.0.2.99"))).toBe("429 sign_in_attempts_exceeded");
    // ... until the window passes.
    clock.t += SIGN_IN_FAILURES_PER_ACCOUNT.windowMs + 1000;
    expect(await code(svc.signIn({ username: "bistro", password: "right-password" }, "192.0.2.99"))).toBe("ok");
    // One address spraying many usernames is stopped too.
    let last = "";
    for (let i = 0; i < 45; i++) last = await code(svc.signIn({ username: `user-${i}`, password: "whatever-pass" }, "192.0.2.50"));
    expect(last).toBe("429 sign_in_attempts_exceeded");
    // Successful sign-ins are not counted: a shared test account can be used by many people.
    for (let i = 0; i < 12; i++) expect(await code(svc.signIn({ username: "bistro", password: "right-password" }, "192.0.2.51"))).toBe("ok");
  }, 60_000);

  it("sessions: expire, end on sign-out, and a tampered or made-up token is nobody", async () => {
    const { svc, clock } = await fresh();
    const s = await svc.signUp({ restaurant: "Bistro", username: "bistro", password: "right-password" }, ADDR);
    expect((await svc.session(s.token))?.account.username).toBe("bistro");
    const flipped = s.token.slice(0, -1) + (s.token.endsWith("A") ? "B" : "A");
    for (const bad of [flipped, "", "x", `${s.token}=`, "a".repeat(43), s.token.toUpperCase(), tokenHash(s.token)]) expect(await svc.session(bad)).toBeUndefined();
    const other = await svc.signIn({ username: "bistro", password: "right-password" }, ADDR);
    await svc.signOut(s.token);
    expect(await svc.session(s.token)).toBeUndefined();
    expect((await svc.session(other.token))?.account.username).toBe("bistro"); // only that session ended
    clock.t += 15 * 86_400_000; // sessions last 14 days
    expect(await svc.session(other.token)).toBeUndefined();
  });
});

describe("accounts: the kitchen and its mandate", () => {
  it("signing the terms makes the kitchen through the same path as a visitor's: key, mandate, agent, memory, signer", async () => {
    const rt = await getRuntime();
    await rt.accounts.signUp({ restaurant: "Ravintola Aalto", username: "aalto", password: "a-long-password" }, ADDR);
    const a = await rt.accounts.signKitchen("aalto", { ...DEFAULT_TERMS, perOrderLimitEur: 150, forbid: ["nuts"], require: ["lactose_free"], signer: "Head chef" });
    const k = a.kitchen!;
    expect(k.orgId).toBe("org_acct_aalto");
    const session = await rt.dock.authenticate(k.mandateToken, k.agentId);
    expect(session.mandate).toMatchObject({ perOrderLimitCents: 15_000, forbiddenAllergens: ["nuts"], requiredAttributes: ["lactose_free"], approvers: [{ role: "kitchen_signer", name: "Head chef" }] });
    expect(session.mandate.allowedCategories).toEqual(expect.arrayContaining(["milk", "cream"]));
    expect(await rt.kitchens.getProfile(k.orgId)).toMatchObject({ name: "Ravintola Aalto", history: [] });
    // The signer is enrolled with no passkey: the one-time link cannot stand in for one.
    expect(await rt.passkeys.store.findApprover(k.orgId, "kitchen_signer")).toMatchObject({ name: "Head chef" });
    expect((await rt.accounts.devices(a)).devices).toEqual([]);
    expect(rt.dock.ledger.entries().some((e) => e.data.step === "mandate_signed" && e.data.orgId === k.orgId)).toBe(true);
  });

  it("a new mandate retires the old one at once: the old token no longer verifies", async () => {
    const rt = await getRuntime();
    await rt.accounts.signUp({ restaurant: "Bistro", username: "bistro", password: "a-long-password" }, ADDR);
    const first = (await rt.accounts.signKitchen("bistro", DEFAULT_TERMS)).kitchen!;
    const second = (await rt.accounts.signKitchen("bistro", { ...DEFAULT_TERMS, perOrderLimitEur: 50 })).kitchen!;
    expect(second.orgId).toBe(first.orgId);
    expect(second.mandate.mandateId).not.toBe(first.mandate.mandateId);
    await expect(rt.dock.authenticate(first.mandateToken, first.agentId)).rejects.toMatchObject({ status: 401 });
    expect((await rt.dock.authenticate(second.mandateToken, second.agentId)).mandate.perOrderLimitCents).toBe(5_000);
    expect(second.retired.map((r) => r.mandateId)).toEqual([first.mandate.mandateId]);
  });

  it("the built-in demo kitchens' mandates cannot be changed through an account", async () => {
    const rt = await getRuntime();
    expect(await code(rt.accounts.signKitchen("kaari", DEFAULT_TERMS))).toBe("409 demo_mandate_fixed");
  });

  it("the account kitchen's key is trusted again after a restart (a new service on the same store)", async () => {
    const rt = await getRuntime();
    await rt.accounts.signUp({ restaurant: "Bistro", username: "bistro", password: "a-long-password" }, ADDR);
    const k = (await rt.accounts.signKitchen("bistro", DEFAULT_TERMS)).kitchen!;
    const registry = createTrustRegistry([]);
    const after = new AccountService({ store: rt.accounts.store, registry, passkeys: rt.passkeys, kitchens: rt.kitchens, dock: rt.dock });
    expect(registry.get(k.key.kid)).toBeUndefined();
    await after.restore();
    expect(registry.get(k.key.kid)?.orgId).toBe(k.orgId);
  });
});

describe("accounts: the demo and test accounts", () => {
  it("the stage kitchens' passwords come only from the environment; without them nobody can sign in", async () => {
    delete process.env.DOCK_KAARI_PASSWORD;
    const rt = await getRuntime();
    expect(await code(rt.accounts.signIn({ username: "kaari", password: "-" }, ADDR))).toBe("401 sign_in_failed");
    process.env.DOCK_KAARI_PASSWORD = "stage-password-from-env";
    try {
      resetRuntime();
      const rt2 = await getRuntime();
      const s = await rt2.accounts.signIn({ username: "kaari", password: "stage-password-from-env" }, ADDR);
      expect(s.account).toMatchObject({ kind: "demo", kitchen: "kaari", orgId: "org_ravintola_kaari" });
    } finally {
      delete process.env.DOCK_KAARI_PASSWORD;
    }
  });

  it("the public test accounts sign in with the seed's credentials and come with history and rules", async () => {
    const rt = await getRuntime();
    for (const t of TEST_ACCOUNTS) {
      const s = await rt.accounts.signIn({ username: t.username, password: t.password }, ADDR);
      expect(s.account).toMatchObject({ kind: "test", shared: true, kitchen: t.username });
      const k = (await rt.accounts.kitchenOf(t.username))!.kitchen;
      const profile = await rt.kitchens.getProfile(k.orgId);
      expect(profile?.history.length).toBeGreaterThan(0);
      expect(profile?.stated.length).toBeGreaterThan(0);
    }
    const school = (await rt.accounts.kitchenOf("koulu-metsola"))!.kitchen;
    expect(school.mandate.forbiddenAllergens).toEqual(expect.arrayContaining(["nuts", "peanuts", "sesame", "fish"]));
  });

  it("reset puts a test account back to its seed as a fresh organisation, and retires the old key", async () => {
    const rt = await getRuntime();
    const before = (await rt.accounts.kitchenOf("kahvila-sointu"))!.kitchen;
    await rt.accounts.signKitchen("kahvila-sointu", { ...DEFAULT_TERMS, perOrderLimitEur: 5000, weeklyBudgetEur: 9000 }); // a stranger raised the limit
    const changed = (await rt.accounts.kitchenOf("kahvila-sointu"))!.kitchen;
    await rt.accounts.resetTestAccounts("in a test");
    const after = (await rt.accounts.kitchenOf("kahvila-sointu"))!.kitchen;
    expect(after.orgId).not.toBe(before.orgId);
    expect(after.terms.perOrderLimitEur).toBe(60);
    await expect(rt.dock.authenticate(changed.mandateToken, changed.agentId)).rejects.toMatchObject({ status: 401 });
    expect((await rt.dock.authenticate(after.mandateToken, after.agentId)).mandate.perOrderLimitCents).toBe(6_000);
    expect((await rt.kitchens.getProfile(after.orgId))?.history.length).toBeGreaterThan(0);
  });
});
