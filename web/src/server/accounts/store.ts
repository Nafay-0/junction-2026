import type { JWK } from "jose";
import type { MemoryFact } from "@/core/kitchen";
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
  /**
   * A DEMO ACCOUNT: opened on a deployment that runs on synthetic data (every account here is one, DOCK_DEMO_ACCOUNTS).
   * The mark is what lets the account stage conditions for its own kitchen, take a sample history and start over
   * (server/demo). Absent: a restaurant's own account; nothing is staged for it, ever.
   */
  demo?: DemoMark;
  /**
   * A FRESH KITCHEN: started with one click from /k (server/demo/fresh.ts), no form, free-play rules. The session
   * cookie is its key; it expires after 24 hours without use unless kept (`kept`: a sign-in name and password set).
   */
  free?: { at: string; lastUsedAt: string; kept?: string };
  /** A sign-in name chosen when a fresh kitchen was kept (its username, the kitchen's address, stays as generated). */
  login?: string;
};

/** What a demo account chose at the end of onboarding, and what it staged (capped per account, server/demo). */
export type DemoMark = {
  at: string;
  /** "sample": several weeks of made-up orders, labelled sample wherever they show; "empty": real orders only. */
  start?: "sample" | "empty";
  startedAt?: string;
  /** The terms signed at onboarding, so "start over" puts the kitchen back to them. */
  onboarded?: MandateTerms;
  /** What the agent remembered from the onboarding answers (written to memory again on "start over"). */
  remembered?: { fact: MemoryFact; text: string }[];
  /** When each staging was done (the per-account cap counts the last day). */
  staged?: { at: string; kind: string }[];
  resets?: number;
  resetsAt?: string[];
};

/**
 * `scope: "call"`: a session a phone got from the one-time "call your agent" code. Whoever scans that code first has
 * it, so it is for the call and nothing else (accounts/http.ts requireFullSession) and lasts an hour, not two weeks.
 */
export type AccountSession = { username: string; createdAt: string; expiresAt: string; scope?: "call" };

/**
 * A one-time link an account shows as a QR code: a phone adds itself as a signing device ("device"), or continues
 * the signed-in session on the phone ("session", e.g. to call the kitchen's agent). Stored only as the SHA-256 of
 * its token, so a restart mid-enrolment strands nobody, and taken (deleted) on use.
 */
export type AccountLink = { username: string; purpose: "device" | "session"; createdAt: string; expiresAt: string };

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
  putLink(tokenHash: string, l: AccountLink): Promise<void>;
  getLink(tokenHash: string): Promise<AccountLink | undefined>;
  /** Get and delete in one step: the second caller with the same token gets nothing. */
  takeLink(tokenHash: string): Promise<AccountLink | undefined>;
}

export class InMemoryAccountStore implements AccountStore {
  private readonly accounts = new Map<string, Account>();
  private readonly sessions = new Map<string, AccountSession>();
  private readonly links = new Map<string, AccountLink>();

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
    for (const [h, l] of this.links) if (l.username === username) this.links.delete(h);
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
    for (const [h, l] of this.links) if (Date.parse(l.expiresAt) <= now.getTime()) this.links.delete(h);
  }
  async putLink(h: string, l: AccountLink) {
    this.links.set(h, { ...l });
  }
  async getLink(h: string) {
    const l = this.links.get(h);
    return l && { ...l };
  }
  async takeLink(h: string) {
    const l = this.links.get(h);
    this.links.delete(h);
    return l && { ...l };
  }
}
