import { createHash, randomBytes } from "node:crypto";
import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { decodeJwt, exportJWK, importJWK, type CryptoKey, type JWK } from "jose";
import type { Product } from "@/core/catalog";
import { DockError } from "@/core/errors";
import { emptyProfile, type KitchenRepository } from "@/core/kitchen";
import { SIGN_ALG, importEd25519KeyPair } from "@/core/keys";
import { signMandate, type Mandate } from "@/core/mandate";
import type { Dock } from "@/core/orders";
import { PasskeyError, type PasskeyService, type RelyingParty } from "@/core/passkeys";
import { addDays, newId } from "@/core/util";
import { KITCHEN_ORG, demoKitchenMandate } from "../demo-kitchen";
import { DEMO_ORG, demoMandate } from "../dev-fixtures";
import { openKitchenOrg, type TrustRegistryHandle } from "../kitchen-org";
import { RateLimiter, type RateRule } from "../limits";
import type { SandboxService } from "../sandboxes";
import { cleanRestaurantName, normaliseUsername, usernameProblem } from "./names";
import { dummyHash, hashPassword, passwordProblem, verifyPassword, PASSWORD_MIN } from "./password";
import type { Account, AccountKitchen, AccountLink, AccountSession, AccountStore } from "./store";
import { FORBID_ALLERGENS, MANDATE_DAYS, REQUIRE_CLAIMS, SIGNER_ROLE, mandateFromTerms, termsFromMandate, type MandateTerms } from "./terms";
import type { MandateBook } from "../mandates";
import { kitchenUnreadable } from "./sealed";
import { TEST_ACCOUNTS, testAccountProducts, type TestAccountSeed } from "./test-accounts";

/**
 * Restaurant and buyer accounts. One account, one kitchen: a restaurant signs up with its name, a username and a
 * password, then signs what its agent may do (accounts/terms.ts), which makes its kitchen the same way a visitor's
 * kitchen is made (kitchen-org.ts): its own key, its first mandate, its agent and its memory profile. The account's
 * signed-in session is then the kitchen's own person (server/authz.ts): the only one who may change its rules.
 *
 * Passwords: scrypt (password.ts); an unknown username and a wrong password get the same answer after the same
 * work; failed attempts are limited per account and per address. Sessions: a random token in an HttpOnly cookie,
 * stored only as its SHA-256, ended by signing out. Sign-off stays a passkey bound to the exact order: adding a
 * "signing device" registers a passkey for the kitchen's signer; the password never approves anything.
 */

export const SESSION_DAYS = 14;
const RENEW_BEFORE_MS = 2 * 86_400_000;
const DEVICE_LINK_MINUTES = 10;
/** How long a phone stays signed in by the call code: longer than any call (the caps are minutes), far shorter than a sign-in. */
export const CALL_SESSION_MINUTES = 60;

export const SIGN_IN_FAILURES_PER_ACCOUNT: RateRule = { name: "signin-fail-account", limit: 8, windowMs: 15 * 60_000 };
export const SIGN_IN_FAILURES_PER_ADDRESS: RateRule = { name: "signin-fail-address", limit: 40, windowMs: 15 * 60_000 };
export const SIGN_UPS_PER_ADDRESS: RateRule = { name: "signup-address", limit: 12, windowMs: 60 * 60_000 };

const env = (k: string) => process.env[k]?.trim() || undefined;

/** The built-in demo kitchens as accounts: username = their store address, password from the environment. */
export const DEMO_ACCOUNTS = [
  { username: "kaari", restaurant: KITCHEN_ORG.name, orgId: KITCHEN_ORG.orgId, passwordEnv: "DOCK_KAARI_PASSWORD", mandate: (now: Date) => demoKitchenMandate(now) },
  { username: "laakso", restaurant: DEMO_ORG.name, orgId: DEMO_ORG.orgId, passwordEnv: "DOCK_LAAKSO_PASSWORD", mandate: (now: Date) => demoMandate(now) },
] as const;

/** What any page or route may show about an account. Never the password hash, the key or a session. */
export type AccountView = {
  username: string;
  restaurant: string;
  kind: Account["kind"];
  createdAt: string;
  /** The store address of its kitchen, once it has one (the built-in demo kitchens always do). */
  kitchen?: string;
  orgId?: string;
  signedAt?: string;
  terms?: MandateTerms;
  shared: boolean;
};

export type SignedIn = { account: AccountView; token: string; expiresAt: string };

export type AccountDeps = {
  store: AccountStore;
  registry: TrustRegistryHandle;
  passkeys: PasskeyService;
  kitchens: KitchenRepository;
  dock: Dock;
  sandboxes?: SandboxService;
  catalog?: { searchProducts(q: { category: string; limit: number }): Promise<Product[]> };
  now?: () => Date;
  limiter?: RateLimiter;
  maxAccounts?: () => number;
  /** The gate's register of reissued mandates (server/mandates.ts): an account's new mandate retires the old there. */
  mandates?: MandateBook;
};

const signInFailed = () => new DockError(401, "sign_in_failed", "That username and password do not match an account here. Check both and try again.", "account");

const PROBLEM_TEXT: Record<string, string> = {
  username_missing: "Choose a username.",
  username_shape: "A username is 3 to 32 characters: letters a to z, digits, hyphen or underscore, starting with a letter or digit.",
  username_reserved: "That username is used by the shop itself. Choose another.",
  password_missing: "Choose a password.",
  password_too_short: `A password needs at least ${PASSWORD_MIN} characters.`,
  password_too_long: "That password is too long (at most 200 characters).",
  restaurant_invalid: "Give the restaurant's name, 2 to 80 characters.",
};
const invalid = (code: string) => new DockError(400, code, PROBLEM_TEXT[code] ?? code, "account");

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class AccountService {
  private readonly now: () => Date;
  private readonly limiter: RateLimiter;
  private products?: Promise<Product[]>;

  constructor(private readonly deps: AccountDeps) {
    this.now = deps.now ?? (() => new Date());
    this.limiter = deps.limiter ?? new RateLimiter(20_000);
  }

  get store(): AccountStore {
    return this.deps.store;
  }

  // ---------- start ----------

  /**
   * At start: the built-in demo kitchens as accounts (passwords from the environment, or no sign-in at all), the
   * public test accounts if absent, and every account kitchen's key trusted again after a restart.
   */
  async restore(): Promise<void> {
    const now = this.now();
    for (const d of DEMO_ACCOUNTS) {
      const password = env(d.passwordEnv);
      const existing = await this.deps.store.get(d.username);
      const keeps = existing && password && (await verifyPassword(password, existing.passwordHash));
      if (keeps) continue;
      await this.deps.store.put({
        username: d.username,
        restaurant: d.restaurant,
        kind: "demo",
        // Without its variable the account exists but cannot be signed into ("-" is not a hash any password matches).
        passwordHash: password ? await hashPassword(password) : "-",
        createdAt: existing?.createdAt ?? now.toISOString(),
      });
      if (existing) await this.deps.store.deleteSessionsOf(d.username); // the password changed: sessions end
    }
    for (const seed of TEST_ACCOUNTS) {
      if (await this.deps.store.get(seed.username)) continue;
      // Not a reason to stop the server (e.g. DOCK_ACCOUNT_KEY_SECRET missing on a public host): said, and skipped.
      await this.seedTestAccount(seed, 0).catch((err: Error) => console.error(`test account ${seed.username} not seeded: ${err.message}`));
    }
    for (const a of await this.deps.store.list()) if (a.kitchen) await this.trust(a.kitchen.key.publicJwk, a.kitchen.orgId);
    await this.deps.store.sweepSessions(now);
  }

  private async trust(publicJwk: JWK, orgId: string): Promise<void> {
    const publicKey = (await importJWK(publicJwk, SIGN_ALG)) as CryptoKey;
    this.deps.registry.add({ kid: String(publicJwk.kid), orgId, publicKey });
  }

  // ---------- sign-up, sign-in, sessions ----------

  async signUp(input: { restaurant?: unknown; username?: unknown; password?: unknown }, address: string): Promise<SignedIn> {
    const restaurant = cleanRestaurantName(input.restaurant);
    if (!restaurant) throw invalid("restaurant_invalid");
    const username = normaliseUsername(input.username);
    const up = usernameProblem(username);
    if (up) throw invalid(up);
    const pp = passwordProblem(input.password);
    if (pp) throw invalid(pp);
    if (this.limiter.hit(SIGN_UPS_PER_ADDRESS, address, this.now().getTime()) !== null) {
      throw new DockError(429, "sign_up_limit", "Too many new accounts from this address in the last hour. Try again later, or use a test account.", "account");
    }
    const max = this.deps.maxAccounts?.() ?? 1000;
    if ((await this.deps.store.list()).filter((a) => a.kind === "own").length >= max) {
      throw new DockError(503, "accounts_full", "This demo server has as many accounts as it takes. Use a test account, or scan the QR code to try without one.", "account");
    }
    const account: Account = { username, restaurant, kind: "own", passwordHash: await hashPassword(input.password as string), createdAt: this.now().toISOString() };
    if (!(await this.deps.store.create(account))) throw new DockError(409, "username_taken", "That username is taken. Choose another.", "account");
    return this.openSession(account);
  }

  /** Same answer, after the same work, for an unknown username and a wrong password. Failures are limited. */
  async signIn(input: { username?: unknown; password?: unknown }, address: string): Promise<SignedIn> {
    const username = normaliseUsername(input.username);
    const password = typeof input.password === "string" ? input.password : "";
    const t = this.now().getTime();
    const blocked = [
      [SIGN_IN_FAILURES_PER_ACCOUNT, `u:${username}`],
      [SIGN_IN_FAILURES_PER_ADDRESS, `a:${address}`],
    ] as const;
    for (const [rule, key] of blocked) {
      if (this.limiter.count(rule, key, t) >= rule.limit) {
        const wait = Math.ceil(this.limiter.retryAfter(rule, key, t) / 60);
        throw new DockError(429, "sign_in_attempts_exceeded", `Too many failed sign-ins. Try again in ${wait} min.`, "account", { retryAfterSeconds: this.limiter.retryAfter(rule, key, t) });
      }
    }
    const account = username && password.length <= 200 ? await this.deps.store.get(username) : undefined;
    const ok = await verifyPassword(password, account?.passwordHash && account.passwordHash !== "-" ? account.passwordHash : await dummyHash());
    if (!account || !ok) {
      for (const [rule, key] of blocked) this.limiter.hit(rule, key, t);
      throw signInFailed();
    }
    return this.openSession(account);
  }

  private async openSession(a: Account, scope?: AccountSession["scope"]): Promise<SignedIn> {
    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    const expiresAt = scope === "call" ? new Date(now.getTime() + CALL_SESSION_MINUTES * 60_000).toISOString() : addDays(now, SESSION_DAYS).toISOString();
    await this.deps.store.putSession(tokenHash(token), { username: a.username, createdAt: now.toISOString(), expiresAt, ...(scope ? { scope } : {}) });
    return { account: this.view(a), token, expiresAt };
  }

  /** The account a session cookie belongs to, or undefined (no cookie, unknown, tampered, expired, signed out). */
  async session(token: string | undefined): Promise<{ account: Account; session: AccountSession } | undefined> {
    if (!token || token.length > 100 || !/^[A-Za-z0-9_-]+$/.test(token)) return undefined;
    const h = tokenHash(token);
    const s = await this.deps.store.getSession(h);
    if (!s) return undefined;
    if (Date.parse(s.expiresAt) <= this.now().getTime()) {
      await this.deps.store.deleteSession(h);
      return undefined;
    }
    const account = await this.deps.store.get(s.username);
    return account ? { account, session: s } : undefined;
  }

  async signOut(token: string | undefined): Promise<void> {
    if (token && /^[A-Za-z0-9_-]{1,100}$/.test(token)) await this.deps.store.deleteSession(tokenHash(token));
  }

  view(a: Account): AccountView {
    const demo = a.kind === "demo";
    return {
      username: a.username,
      restaurant: a.restaurant,
      kind: a.kind,
      createdAt: a.createdAt,
      kitchen: demo || a.kitchen ? a.username : undefined,
      orgId: a.kitchen?.orgId ?? DEMO_ACCOUNTS.find((d) => d.username === a.username)?.orgId,
      signedAt: a.kitchen?.signedAt,
      terms: a.kitchen?.terms,
      shared: a.kind === "test",
    };
  }

  async get(username: string): Promise<Account | undefined> {
    return this.deps.store.get(normaliseUsername(username));
  }

  async list(): Promise<AccountView[]> {
    return (await this.deps.store.list()).map((a) => this.view(a));
  }

  // ---------- the kitchen: its mandate, signed with the key held for it ----------

  /**
   * Sign the kitchen's mandate: the first time this makes the kitchen (key, mandate, agent, memory, signer); after
   * that it reissues the mandate through the gate's register (server/mandates.ts), so the old one is refused at once,
   * and moves to a new key.
   */
  async signKitchen(username: string, terms: MandateTerms, opts: { profile?: TestAccountSeed["profile"] } = {}): Promise<Account> {
    const a = await this.deps.store.get(username);
    if (!a) throw new DockError(404, "account_not_found", "No such account.", "account");
    if (a.kind === "demo") throw new DockError(409, "demo_mandate_fixed", `${a.restaurant} is a built-in demo kitchen: its mandate is fixed for the stage. Its remembered rules can still be changed while signed in.`, "account");
    const now = this.now();
    if (!a.kitchen) {
      const orgId = `org_acct_${username.replaceAll("-", "_")}${a.generation ? `_g${a.generation}` : ""}`;
      const agentId = `agent_${username.replaceAll("-", "_")}_buyer${a.generation ? `_g${a.generation}` : ""}`;
      const mandate = mandateFromTerms(terms, { orgId, orgName: a.restaurant, agentId, now, seq: 1 });
      const profile = opts.profile ? opts.profile(orgId, a.restaurant, now, await this.historyProducts()) : emptyProfile(orgId, a.restaurant);
      const { key, mandateToken } = await openKitchenOrg({ registry: this.deps.registry, kitchens: this.deps.kitchens, kid: `${orgId}-k1`, mandate, profile });
      // The signer, with no passkey yet: until a signing device is added, an order above the limit waits. The one-time
      // approval link is not accepted for a kitchen whose signer is enrolled (core/passkeys.ts).
      await this.deps.passkeys.enrol({ approverId: newId("apv"), orgId, role: SIGNER_ROLE, name: terms.signer, userHandle: "", createdAt: now.toISOString() });
      a.kitchen = {
        orgId,
        agentId,
        approverRole: SIGNER_ROLE,
        terms,
        mandate,
        mandateToken,
        key: { kid: key.kid, privateJwk: { ...(await exportJWK(key.privateKey)), kid: key.kid }, publicJwk: key.publicJwk },
        signedAt: now.toISOString(),
        retired: [],
      };
      this.deps.dock.ledger.append({
        type: "intake",
        actor: `account:${username}`,
        summary: `${a.restaurant} signed its first mandate: its agent may spend up to ${eur(mandate.perOrderLimitCents)} per order alone and ${eur(mandate.weeklyBudgetCents)} a week in all; above the limit ${terms.signer} signs with a passkey.`,
        data: { step: "mandate_signed", orgId, agentId, mandateId: mandate.mandateId, kid: key.kid, keyHeldBy: "service (demo assumption)" },
      });
    } else {
      const k = a.kitchen;
      const n = k.retired.length + 2;
      const mandate = this.restrict(mandateFromTerms(terms, { orgId: k.orgId, orgName: a.restaurant, agentId: k.agentId, now, seq: n }));
      const { key, mandateToken } = await openKitchenOrg({ registry: this.deps.registry, kid: `${k.orgId}-k${n}`, mandate });
      // The gate's register of reissued mandates (server/mandates.ts) refuses the earlier ones from this second on,
      // with the same refusal as any reissue; the old key is also no longer trusted.
      await this.deps.mandates?.supersede(mandate, `${a.restaurant} (signed in as ${username})`, k.mandate.mandateId, now);
      this.deps.registry.remove(k.key.kid);
      const signer = await this.deps.passkeys.store.findApprover(k.orgId, k.approverRole);
      if (signer && signer.name !== terms.signer) await this.deps.passkeys.store.putAccount({ ...signer, name: terms.signer });
      a.kitchen = {
        ...k,
        terms,
        mandate,
        mandateToken,
        key: { kid: key.kid, privateJwk: { ...(await exportJWK(key.privateKey)), kid: key.kid }, publicJwk: key.publicJwk },
        signedAt: now.toISOString(),
        retired: [...k.retired, { mandateId: k.mandate.mandateId, kid: k.key.kid, at: now.toISOString() }].slice(-50),
      };
      this.deps.dock.ledger.append({
        type: "intake",
        actor: `account:${username}`,
        summary: `${a.restaurant} signed a new mandate (${eur(mandate.perOrderLimitCents)} per order alone, ${eur(mandate.weeklyBudgetCents)} a week); the previous one (${k.mandate.mandateId}) is retired and no longer verifies.`,
        data: { step: "mandate_reissued", orgId: k.orgId, mandateId: mandate.mandateId, retiredMandateId: k.mandate.mandateId, retiredKid: k.key.kid, kid: key.kid },
      });
    }
    await this.deps.store.put(a);
    return a;
  }

  /**
   * The kitchen's agent credentials for the store. The mandate is valid for MANDATE_DAYS and re-signed, with the
   * same terms and key, when fewer than two days are left.
   */
  async kitchenOf(username: string): Promise<{ account: Account; kitchen: AccountKitchen } | undefined> {
    const a = await this.deps.store.get(username);
    if (!a?.kitchen) return undefined;
    if (kitchenUnreadable(a.kitchen)) throw new DockError(503, "account_key_unreadable", `${a.restaurant}'s kitchen key cannot be read with this server's DOCK_ACCOUNT_KEY_SECRET. Its orders and memory are safe; ask the operator.`, "account");
    const k = a.kitchen;
    const now = this.now();
    if (Date.parse(k.mandate.validUntil) - now.getTime() < RENEW_BEFORE_MS) {
      const key = await importEd25519KeyPair(k.key.kid, k.key.privateJwk);
      const mandate = this.restrict(mandateFromTerms(k.terms, { orgId: k.orgId, orgName: a.restaurant, agentId: k.agentId, now, seq: k.retired.length + 1 }));
      a.kitchen = { ...k, mandate, mandateToken: await signMandate(mandate, key) };
      await this.deps.store.put(a);
    }
    return { account: a, kitchen: a.kitchen };
  }

  /**
   * Sign another mandate of this kitchen (its menu agent's) with the key held for it. Only for a mandate of the
   * kitchen's own organisation; the caller makes sure it is never wider than the kitchen's buyer mandate.
   */
  async signForKitchen(username: string, mandate: Mandate): Promise<string> {
    const a = await this.deps.store.get(username);
    if (!a?.kitchen || mandate.issuer.orgId !== a.kitchen.orgId) throw new DockError(404, "kitchen_not_found", "This account has no such kitchen.", "account");
    return signMandate(mandate, await importEd25519KeyPair(a.kitchen.key.kid, a.kitchen.key.privateJwk));
  }

  /** What the kitchen added to its mandate from its memory page ("Add to signed mandate") stays in every mandate signed for it. */
  private restrict(m: Mandate): Mandate {
    return this.deps.mandates?.restrict(m) ?? m;
  }

  /**
   * "Add to signed mandate" for an account's kitchen (server/mandate-reissue.ts, through the gate's register): sign
   * the narrowed mandate with the key held for the kitchen and keep it, with the rule folded into the terms the form
   * shows where the form has a word for it.
   */
  async applyReissue(username: string, mandate: Mandate): Promise<void> {
    const a = await this.deps.store.get(username);
    if (!a?.kitchen) throw new DockError(404, "kitchen_not_found", "This account has no kitchen yet.", "account");
    const k = a.kitchen;
    const key = await importEd25519KeyPair(k.key.kid, k.key.privateJwk);
    const forbid = [...new Set([...k.terms.forbid, ...mandate.forbiddenAllergens.filter((x): x is MandateTerms["forbid"][number] => (FORBID_ALLERGENS as readonly string[]).includes(x))])];
    const require = [...new Set([...k.terms.require, ...mandate.requiredAttributes.filter((x): x is MandateTerms["require"][number] => (REQUIRE_CLAIMS as readonly string[]).includes(x))])];
    a.kitchen = { ...k, terms: { ...k.terms, forbid, require }, mandate, mandateToken: await signMandate(mandate, key), signedAt: this.now().toISOString(), retired: [...k.retired, { mandateId: k.mandate.mandateId, kid: k.key.kid, at: this.now().toISOString() }].slice(-50) };
    await this.deps.store.put(a);
  }

  private historyProducts(): Promise<Product[]> {
    this.products ??= this.deps.catalog ? testAccountProducts(this.deps.catalog) : Promise.resolve([]);
    return this.products;
  }

  // ---------- test accounts ----------

  private async seedTestAccount(seed: TestAccountSeed, generation: number): Promise<void> {
    await this.deps.store.put({ username: seed.username, restaurant: seed.restaurant, kind: "test", passwordHash: await hashPassword(seed.password), createdAt: this.now().toISOString(), generation });
    await this.signKitchen(seed.username, seed.terms, { profile: seed.profile });
  }

  /**
   * Back to the seed file: password, mandate, history and rules (signed-in sessions stay). Each reset is a fresh
   * organisation (its earlier orders stay in the ledger, under the old one), and the old key is retired.
   */
  async resetTestAccounts(by: string): Promise<{ reset: string[] }> {
    const reset: string[] = [];
    for (const seed of TEST_ACCOUNTS) {
      const old = await this.deps.store.get(seed.username);
      if (old?.kitchen) {
        this.deps.registry.remove(old.kitchen.key.kid);
        const signer = await this.deps.passkeys.store.findApprover(old.kitchen.orgId, old.kitchen.approverRole);
        if (signer) await this.deps.passkeys.store.deleteAccount(signer.approverId);
      }
      // Whoever is signed in stays signed in; they find the kitchen as the seed has it.
      await this.seedTestAccount(seed, (old?.generation ?? 0) + 1);
      reset.push(seed.username);
    }
    this.deps.dock.ledger.append({ type: "intake", actor: "dock", summary: `The shared test accounts (${reset.join(", ")}) were reset to their seed: rules, mandate and history; ${by}.`, data: { step: "test_accounts_reset", accounts: reset, by } });
    return { reset };
  }

  // ---------- a visitor keeps their kitchen ----------

  /**
   * A visitor from the QR code keeps their kitchen: an account with the username and password they choose, the
   * same organisation, agent, memory, orders and passkey. The kitchen gets a key of its own held for it (the visitor
   * kitchen's key was used once and never stored), and its signer no longer expires.
   */
  async keepVisitor(sandboxId: string, approverId: string, input: { username?: unknown; password?: unknown }, address: string): Promise<SignedIn> {
    const sandboxes = this.deps.sandboxes;
    if (!sandboxes) throw new DockError(503, "keep_unavailable", "Keeping a visitor kitchen is not available on this server.", "account");
    const s = await sandboxes.get(sandboxId);
    if (!s || s.approverId !== approverId) throw new DockError(403, "not_your_kitchen", "Only the phone that joined this kitchen can keep it.", "account");
    const creds = await sandboxes.agentCredentials(sandboxId);
    const old = creds && (decodeJwt(creds.mandateToken) as { mandate?: Mandate }).mandate;
    if (!old) throw new DockError(404, "sandbox_not_found", "This visitor kitchen has closed.", "account");
    const restaurant = `${s.kitchenName}, ${s.city}`;
    const signed = await this.signUp({ restaurant, username: input.username, password: input.password }, address);
    const terms = termsFromMandate(old);
    const now = this.now();
    const mandate = this.restrict(mandateFromTerms(terms, { orgId: s.orgId, orgName: restaurant, agentId: s.agentId, now, seq: 1 }));
    const { key, mandateToken } = await openKitchenOrg({ registry: this.deps.registry, kid: `${s.orgId}-k1`, mandate });
    await this.deps.mandates?.supersede(mandate, `${restaurant} (kept as ${signed.account.username})`, old.mandateId, now);
    const signer = await this.deps.passkeys.store.getAccount(s.approverId);
    // The visitor stays the signer, now in the account kitchens' signer role and without the 90-minute end.
    if (signer) await this.deps.passkeys.store.putAccount({ ...signer, role: SIGNER_ROLE, expiresAt: undefined });
    const account = (await this.deps.store.get(signed.account.username))!;
    account.keptFrom = sandboxId;
    account.kitchen = {
      orgId: s.orgId,
      agentId: s.agentId,
      approverRole: SIGNER_ROLE,
      terms,
      mandate,
      mandateToken,
      key: { kid: key.kid, privateJwk: { ...(await exportJWK(key.privateKey)), kid: key.kid }, publicJwk: key.publicJwk },
      signedAt: now.toISOString(),
      retired: [{ mandateId: old.mandateId, kid: `${s.orgId}-key`, at: now.toISOString() }],
    };
    await this.deps.store.put(account);
    await sandboxes.release(sandboxId);
    this.deps.dock.ledger.append({
      type: "intake",
      actor: `account:${account.username}`,
      summary: `The visitor kitchen ${restaurant} was kept as an account: same organisation, memory, orders and passkey; its 90-minute mandate is retired and a new one signed for ${MANDATE_DAYS} days.`,
      data: { step: "visitor_kept", orgId: s.orgId, sandboxId, mandateId: mandate.mandateId, retiredMandateId: old.mandateId },
    });
    return { ...signed, account: this.view(account) };
  }

  // ---------- signing devices: a passkey for the kitchen's signer ----------

  /** Who signs for this account's kitchen above the limit: the approver role a device's passkey is added to. */
  signerOf(a: Account): { orgId: string; role: string; name: string } | undefined {
    if (a.kitchen) return { orgId: a.kitchen.orgId, role: a.kitchen.approverRole, name: a.kitchen.terms.signer };
    const demo = DEMO_ACCOUNTS.find((d) => d.username === a.username);
    const first = demo?.mandate(this.now()).approvers[0];
    return demo && first ? { orgId: demo.orgId, role: first.role, name: first.name } : undefined;
  }

  async devices(a: Account): Promise<{ signer?: { name: string; role: string }; devices: { createdAt: string; lastUsedAt?: string; deviceType: string }[] }> {
    const s = this.signerOf(a);
    if (!s) return { devices: [] };
    const approver = await this.deps.passkeys.store.findApprover(s.orgId, s.role);
    const creds = approver ? await this.deps.passkeys.store.credentialsOf(approver.approverId) : [];
    return { signer: { name: approver?.name ?? s.name, role: s.role }, devices: creds.map((c) => ({ createdAt: c.createdAt, lastUsedAt: c.lastUsedAt, deviceType: c.deviceType })) };
  }

  /**
   * A one-time address (10 minutes) for a phone: to add itself as a signing device ("device"), or to continue this
   * account's session on the phone ("session"). Kept as the SHA-256 of the token in the account store, so a restart
   * in between strands nobody.
   */
  async oneTimeLink(username: string, purpose: AccountLink["purpose"]): Promise<{ token: string; expiresAt: string }> {
    const now = this.now();
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(now.getTime() + DEVICE_LINK_MINUTES * 60_000).toISOString();
    await this.deps.store.putLink(tokenHash(token), { username, purpose, createdAt: now.toISOString(), expiresAt });
    return { token, expiresAt };
  }

  /** The account a phone's link names, if the link is open and for this purpose. `take` uses it up. */
  async linkAccount(token: unknown, purpose: AccountLink["purpose"], take = false): Promise<string | undefined> {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) return undefined;
    const h = tokenHash(token);
    const l = take ? await this.deps.store.takeLink(h) : await this.deps.store.getLink(h);
    if (!l || l.purpose !== purpose || Date.parse(l.expiresAt) <= this.now().getTime()) return undefined;
    return l.username;
  }

  /** A phone opened the "continue on your phone" link: a session of its own for the same account. */
  async handOff(token: unknown): Promise<SignedIn | undefined> {
    const username = await this.linkAccount(token, "session", true);
    const a = username ? await this.deps.store.get(username) : undefined;
    // For the call only (store.ts AccountSession.scope): the code was on a screen, and whoever scanned it has this.
    return a ? this.openSession(a, "call") : undefined;
  }

  async beginDevice(a: Account, rp: RelyingParty, via: "session" | "link", link?: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const s = this.signerOf(a);
    if (!s) throw new DockError(409, "no_kitchen_yet", "Sign the kitchen's mandate first; then add a signing device.", "account");
    const { options } = await this.deps.passkeys.registrationOptions(rp, { name: `${s.name} · ${a.restaurant}`, displayName: s.name }, { accountDevice: { username: a.username, via, link } });
    return options;
  }

  /** The device made a passkey: add it to the kitchen's signer, and sign this device in as that signer. */
  async completeDevice(response: RegistrationResponseJSON, expect: { username?: string; link?: string }): Promise<{ account: Account; approverId: string; sessionToken: string; sessionExpiresAt: string }> {
    const reg = await this.deps.passkeys.verifyRegistration(response);
    const ctx = reg.context.accountDevice as { username: string; via: "session" | "link"; link?: string } | undefined;
    if (!ctx) throw new PasskeyError(400, "registration_unknown", "This passkey prompt was not for adding a signing device.");
    const allowed = ctx.via === "session" ? expect.username === ctx.username : !!expect.link && expect.link === ctx.link && (await this.linkAccount(expect.link, "device", true)) === ctx.username;
    if (!allowed) throw new DockError(403, "device_not_yours", "This passkey prompt was started for another kitchen, or its link has expired.", "account");
    const a = await this.deps.store.get(ctx.username);
    const s = a && this.signerOf(a);
    if (!a || !s) throw new DockError(404, "account_not_found", "No such account.", "account");
    const now = this.now();
    let approver = await this.deps.passkeys.store.findApprover(s.orgId, s.role);
    if (!approver) {
      approver = { approverId: newId("apv"), orgId: s.orgId, role: s.role, name: s.name, userHandle: reg.userHandle, createdAt: now.toISOString() };
      await this.deps.passkeys.enrol(approver, reg.credential);
    } else {
      if (!approver.userHandle) await this.deps.passkeys.store.putAccount({ ...approver, userHandle: reg.userHandle });
      await this.deps.passkeys.store.putCredential({ ...reg.credential, approverId: approver.approverId });
    }
    this.deps.dock.ledger.append({
      type: "approval",
      actor: `account:${a.username}`,
      summary: `${a.restaurant} added a signing device: a passkey for ${approver.name}. Orders above the limit are signed with it, bound to the exact order.`,
      data: { step: "signing_device_added", orgId: s.orgId, role: s.role, approverId: approver.approverId, credentialId: reg.credential.credentialId, via: ctx.via },
    });
    const sessionExpiresAt = approver.expiresAt && Date.parse(approver.expiresAt) < Date.parse(addDays(now, SESSION_DAYS).toISOString()) ? approver.expiresAt : addDays(now, SESSION_DAYS).toISOString();
    const sessionToken = await this.deps.passkeys.newSession(approver.approverId, new Date(sessionExpiresAt));
    return { account: a, approverId: approver.approverId, sessionToken, sessionExpiresAt };
  }
}

function eur(cents: number): string {
  return `€${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
