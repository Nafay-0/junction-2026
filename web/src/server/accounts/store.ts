import type { JWK } from "jose";
import type { Mandate } from "@/core/mandate";
import type { MandateTerms } from "./terms";

/**
 * Accounts and their sessions, behind a store: in memory by default, PostgreSQL when DOCK_STORE=postgres
 * (src/server/aiven/pg/accounts.ts, tables `accounts` and `account_sessions`), so accounts, their kitchens and their
 * sessions outlive a restart on the deployment.
 *
 *   own    a restaurant or buyer that signed up; its kitchen is made when it signs its first mandate
 *   demo   one of the two built-in demo kitchens (kaari, laakso): password from the environment, kitchen built in
 *   test   a shared test account from the seed file (test-accounts.ts); reset on a schedule and from operations
 */
export type AccountKind = "own" | "demo" | "test";

/**
 * The kitchen an account signed for. DEMO ASSUMPTION: the service holds the kitchen's private signing key on its
 * behalf, so it can sign the mandate the kitchen sets on the page. In production the kitchen holds its own key and
 * signs elsewhere; Dock would keep only the public key, as it does for every other buyer organisation.
 */
export type AccountKitchen = {
  orgId: string;
  agentId: string;
  approverRole: string;
  terms: MandateTerms;
  mandate: Mandate;
  mandateToken: string;
  key: { kid: string; privateJwk: JWK; publicJwk: JWK };
  signedAt: string;
  /** Mandates this kitchen signed before the current one; their keys are no longer trusted. */
  retired: { mandateId: string; kid: string; at: string }[];
};

export type Account = {
  username: string;
  restaurant: string;
  kind: AccountKind;
  passwordHash: string;
  createdAt: string;
  kitchen?: AccountKitchen;
  /** Test accounts: how many times it was reset (each reset is a fresh organisation, so its weekly budget is free). */
  generation?: number;
  /** A visitor kitchen this account was kept from. */
  keptFrom?: string;
};

export type AccountSession = { username: string; createdAt: string; expiresAt: string };

export interface AccountStore {
  /** Insert a new account. False when the username is taken (atomic: two sign-ups cannot both win). */
  create(a: Account): Promise<boolean>;
  get(username: string): Promise<Account | undefined>;
  put(a: Account): Promise<void>;
  list(): Promise<Account[]>;
  delete(username: string): Promise<void>;
  putSession(tokenHash: string, s: AccountSession): Promise<void>;
  getSession(tokenHash: string): Promise<AccountSession | undefined>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteSessionsOf(username: string): Promise<void>;
  sweepSessions(now: Date): Promise<void>;
}

export class InMemoryAccountStore implements AccountStore {
  private readonly accounts = new Map<string, Account>();
  private readonly sessions = new Map<string, AccountSession>();

  async create(a: Account) {
    if (this.accounts.has(a.username)) return false;
    this.accounts.set(a.username, structuredClone(a));
    return true;
  }
  async get(username: string) {
    const a = this.accounts.get(username);
    return a && structuredClone(a);
  }
  async put(a: Account) {
    this.accounts.set(a.username, structuredClone(a));
  }
  async list() {
    return structuredClone([...this.accounts.values()]);
  }
  async delete(username: string) {
    this.accounts.delete(username);
    await this.deleteSessionsOf(username);
  }
  async putSession(h: string, s: AccountSession) {
    this.sessions.set(h, { ...s });
  }
  async getSession(h: string) {
    const s = this.sessions.get(h);
    return s && { ...s };
  }
  async deleteSession(h: string) {
    this.sessions.delete(h);
  }
  async deleteSessionsOf(username: string) {
    for (const [h, s] of this.sessions) if (s.username === username) this.sessions.delete(h);
  }
  async sweepSessions(now: Date) {
    for (const [h, s] of this.sessions) if (Date.parse(s.expiresAt) <= now.getTime()) this.sessions.delete(h);
  }
}
