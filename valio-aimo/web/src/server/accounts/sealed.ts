import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { JWK } from "jose";
import { DockError } from "@/core/errors";
import type { Account, AccountKitchen, AccountLink, AccountSession, AccountStore } from "./store";

/**
 * The kitchens' secrets at rest. An account kitchen's private signing key (held for it, a demo assumption) and its
 * current mandate token are kept sealed with AES-256-GCM under a key derived (HKDF-SHA256, a fresh salt per seal)
 * from DOCK_ACCOUNT_KEY_SECRET, bound to the account, organisation and key id. A copy of the database alone can
 * then neither sign a mandate nor present one.
 *
 *   SealingAccountStore   wraps any AccountStore: seals on every put, opens on every read, so the service never
 *                         sees the difference. `migrate()` seals kitchens written in plain form before the secret
 *                         existed; the runtime runs it at start.
 *
 * DOCK_ACCOUNT_KEY_SECRET is required on a public host (a production build whose DOCK_PUBLIC_URL is not localhost):
 * there, without it, no kitchen's key is written at all (503), rather than written in plain form. Locally it is
 * optional and kitchens are kept in plain form. Changing the secret makes the sealed kitchens unreadable: their
 * accounts still sign in, and their kitchens answer 503 until the old secret is back.
 */
export type Sealed = { v: 1; alg: "A256GCM"; kdf: "HKDF-SHA256"; salt: string; iv: string; tag: string; ct: string };
type Secrets = { privateJwk: JWK; mandateToken: string };
const INFO = "dock account kitchen secrets v1";

export function accountKeySecret(): string | undefined {
  const v = process.env.DOCK_ACCOUNT_KEY_SECRET?.trim();
  return v && v.length >= 16 ? v : undefined;
}

/** A production build answering on a public address. */
export function publicHost(): boolean {
  const url = process.env.DOCK_PUBLIC_URL?.trim();
  return process.env.NODE_ENV === "production" && !!url && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);
}

const aadOf = (username: string, k: { orgId: string; key: { kid: string } }) => Buffer.from(`${username}|${k.orgId}|${k.key.kid}`);

function derive(secret: string, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret), salt, INFO, 32));
}

export function seal(secrets: Secrets, secret: string, aad: Buffer): Sealed {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", derive(secret, salt), iv);
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(JSON.stringify(secrets), "utf8"), c.final()]);
  const b = (x: Buffer) => x.toString("base64url");
  return { v: 1, alg: "A256GCM", kdf: "HKDF-SHA256", salt: b(salt), iv: b(iv), tag: b(c.getAuthTag()), ct: b(ct) };
}

/** Throws on a wrong secret, a tampered box or a box moved to another account. */
export function open(s: Sealed, secret: string, aad: Buffer): Secrets {
  const f = (x: string) => Buffer.from(x, "base64url");
  const d = createDecipheriv("aes-256-gcm", derive(secret, f(s.salt)), f(s.iv));
  d.setAAD(aad);
  d.setAuthTag(f(s.tag));
  return JSON.parse(Buffer.concat([d.update(f(s.ct)), d.final()]).toString("utf8")) as Secrets;
}

type StoredKitchen = Omit<AccountKitchen, "key"> & { key: { kid: string; publicJwk: JWK; privateJwk?: JWK }; sealed?: Sealed; unreadable?: true };

export class SealingAccountStore implements AccountStore {
  constructor(
    private readonly inner: AccountStore,
    private readonly secret: () => string | undefined = accountKeySecret,
    private readonly mustSeal: () => boolean = publicHost,
  ) {}

  private sealed(a: Account): Account {
    if (!a.kitchen) return a;
    const k = a.kitchen as StoredKitchen;
    if (k.unreadable) throw new DockError(503, "account_key_unreadable", "This kitchen's signing key cannot be read with this server's DOCK_ACCOUNT_KEY_SECRET; nothing was changed.", "account");
    const secret = this.secret();
    if (!secret) {
      if (this.mustSeal()) throw new DockError(503, "account_key_secret_missing", "This server has no DOCK_ACCOUNT_KEY_SECRET, so it does not store a kitchen's signing key. Ask the operator to set it.", "account");
      return a;
    }
    const { privateJwk, ...pub } = k.key;
    const box = seal({ privateJwk: privateJwk!, mandateToken: k.mandateToken }, secret, aadOf(a.username, k));
    const stored: StoredKitchen = { ...k, key: pub, mandateToken: "", sealed: box };
    return { ...a, kitchen: stored as unknown as AccountKitchen };
  }

  private opened(a: Account | undefined): Account | undefined {
    const k = a?.kitchen as StoredKitchen | undefined;
    if (!a || !k?.sealed) return a;
    const secret = this.secret();
    const { sealed, ...rest } = k;
    try {
      if (!secret) throw new Error("no secret");
      const s = open(sealed, secret, aadOf(a.username, k));
      return { ...a, kitchen: { ...rest, key: { ...rest.key, privateJwk: s.privateJwk }, mandateToken: s.mandateToken } as AccountKitchen };
    } catch {
      // Signs in still; its kitchen answers 503 (accounts/service.ts kitchenOf) until the right secret is back.
      return { ...a, kitchen: { ...rest, unreadable: true } as unknown as AccountKitchen };
    }
  }

  /** Seal every kitchen still stored in plain form. Returns how many were sealed. */
  async migrate(): Promise<number> {
    if (!this.secret()) return 0;
    let n = 0;
    for (const a of await this.inner.list()) {
      const k = a.kitchen as StoredKitchen | undefined;
      if (!k || k.sealed || !k.key.privateJwk) continue;
      await this.inner.put(this.sealed(a));
      n++;
    }
    return n;
  }

  async create(a: Account) {
    return this.inner.create(this.sealed(a));
  }
  async get(username: string) {
    return this.opened(await this.inner.get(username));
  }
  async put(a: Account) {
    await this.inner.put(this.sealed(a));
  }
  async list() {
    return (await this.inner.list()).map((a) => this.opened(a)!);
  }
  delete(username: string) {
    return this.inner.delete(username);
  }
  putSession(h: string, s: AccountSession) {
    return this.inner.putSession(h, s);
  }
  getSession(h: string) {
    return this.inner.getSession(h);
  }
  deleteSession(h: string) {
    return this.inner.deleteSession(h);
  }
  deleteSessionsOf(username: string) {
    return this.inner.deleteSessionsOf(username);
  }
  sweepSessions(now: Date) {
    return this.inner.sweepSessions(now);
  }
  putLink(h: string, l: AccountLink) {
    return this.inner.putLink(h, l);
  }
  getLink(h: string) {
    return this.inner.getLink(h);
  }
  takeLink(h: string) {
    return this.inner.takeLink(h);
  }
}

/** True for a kitchen this server could not open (wrong or missing DOCK_ACCOUNT_KEY_SECRET). */
export function kitchenUnreadable(k: AccountKitchen | undefined): boolean {
  return !!(k as { unreadable?: true } | undefined)?.unreadable;
}
