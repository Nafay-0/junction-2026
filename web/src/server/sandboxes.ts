import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { importJWK, type CryptoKey, type JWK } from "jose";
import type { Product } from "@/core/catalog";
import type { KitchenRepository } from "@/core/kitchen";
import { SIGN_ALG, generateEd25519KeyPair } from "@/core/keys";
import { signMandate, type Mandate, type createTrustRegistry } from "@/core/mandate";
import { DockError, type Dock, type PublicOrder } from "@/core/orders";
import { PasskeyError, type PasskeyService, type RelyingParty } from "@/core/passkeys";
import { addMinutes, newId } from "@/core/util";
import { SANDBOX_ROLE, sandboxIdentity, sandboxMandate, type SandboxIdentity } from "./dev-fixtures";
import { hotelKitchenProfile } from "./demo-kitchen";
import { onsiteSession } from "./ops/onsite";
import { runKitchenScenario } from "./sandbox-scenario";

/**
 * Visitor kitchens. Each visitor who scans the QR code gets their own buyer organisation (with its own Ed25519
 * signing key, trusted by Dock), a signed mandate, a buyer agent, and becomes that organisation's only approver,
 * with a passkey on their phone. Visitors never see each other's orders. Kitchens expire; their number is capped.
 *
 * Kept in a SandboxStore: in memory by default, PostgreSQL when DOCK_STORE=postgres (src/server/aiven). The
 * organisation's private key is used once, to sign the mandate, and never stored; the store keeps the public
 * key, and `restore()` puts it back in the trust registry after a restart so the kitchen's agent still works.
 */
export type Sandbox = SandboxIdentity & {
  sandboxId: string;
  orgId: string;
  agentId: string;
  approverId: string;
  role: string;
  roleLabel: string;
  mandate: Mandate;
  mandateToken: string;
  passkey: boolean; // false only for the demo-only fallback join
  createdAt: string;
  expiresAt: string;
};

/** What a screen may show about a sandbox. No keys, no mandate token. */
export type SandboxSummary = Omit<Sandbox, "mandateToken" | "mandate"> & {
  perOrderLimitCents: number;
  weeklyBudgetCents: number;
};

/** A sandbox as stored: everything but the private key, plus the organisation's public key. */
export type SandboxRecord = Sandbox & { publicJwk: JWK };

/** Async so a database can hold the sandboxes (see src/server/aiven/pg/repositories.ts). */
export interface SandboxStore {
  put(s: SandboxRecord): Promise<void>;
  get(sandboxId: string): Promise<SandboxRecord | undefined>;
  list(): Promise<SandboxRecord[]>;
  delete(sandboxId: string): Promise<void>;
}

export class InMemorySandboxStore implements SandboxStore {
  private readonly items = new Map<string, SandboxRecord>();
  async put(s: SandboxRecord) {
    this.items.set(s.sandboxId, structuredClone(s));
  }
  async get(id: string) {
    const s = this.items.get(id);
    return s && structuredClone(s);
  }
  async list() {
    return structuredClone([...this.items.values()]);
  }
  async delete(id: string) {
    this.items.delete(id);
  }
}

export type SandboxDeps = {
  dock: Dock;
  registry: ReturnType<typeof createTrustRegistry>;
  passkeys: PasskeyService;
  limits: () => { max: number; ttlMinutes: number };
  now?: () => Date;
  store?: SandboxStore;
  /** Where each new kitchen's order history goes (the same repository the Dock instance reads). */
  kitchens?: KitchenRepository;
  /** Catalogue products the history is drawn from, by attribute (seed or real catalogue). */
  products?: () => Promise<Product[]>;
};

export class SandboxService {
  private readonly sandboxes: SandboxStore;
  private seq = 0;
  private readonly now: () => Date;

  constructor(private readonly deps: SandboxDeps) {
    this.now = deps.now ?? (() => new Date());
    this.sandboxes = deps.store ?? new InMemorySandboxStore();
  }

  /** After a restart: trust the stored kitchens' organisation keys again. Returns how many are open. */
  async restore(): Promise<number> {
    await this.sweep();
    const open = await this.sandboxes.list();
    for (const s of open) {
      const publicKey = (await importJWK(s.publicJwk, SIGN_ALG)) as CryptoKey;
      this.deps.registry.add({ kid: String(s.publicJwk.kid ?? `${s.orgId}-key`), orgId: s.orgId, publicKey });
    }
    this.seq = Math.max(this.seq, open.length);
    return open.length;
  }

  /** Drops expired kitchens and their approver accounts. Their orders stay in the ledger. */
  async sweep(): Promise<void> {
    const t = this.now().getTime();
    for (const s of await this.sandboxes.list()) {
      if (Date.parse(s.expiresAt) > t) continue;
      await this.sandboxes.delete(s.sandboxId);
      await this.deps.passkeys.store.deleteAccount(s.approverId);
    }
  }

  private async ensureRoom(): Promise<void> {
    await this.sweep();
    if ((await this.sandboxes.list()).length >= this.deps.limits().max) {
      throw new DockError(503, "sandbox_full", "All demo kitchens are taken right now. Try again in a few minutes.");
    }
  }

  /** Step 1 of joining: a made-up identity to show, and the passkey prompt to create. Nothing is stored but the prompt. */
  async beginJoin(rp: RelyingParty): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; identity: SandboxIdentity }> {
    await this.ensureRoom();
    const identity = sandboxIdentity(this.seq++);
    const { options } = await this.deps.passkeys.registrationOptions(
      rp,
      { name: `${identity.approverName} · ${identity.kitchenName}`, displayName: identity.approverName },
      { identity },
    );
    return { options, identity };
  }

  /** Step 2: the phone made a passkey. Verify it, then create the kitchen with this visitor as its approver. */
  async completeJoin(response: RegistrationResponseJSON): Promise<{ sandbox: SandboxSummary; sessionToken: string }> {
    const reg = await this.deps.passkeys.verifyRegistration(response);
    const identity = reg.context.identity as SandboxIdentity | undefined;
    if (!identity) throw new PasskeyError(400, "registration_unknown", "This passkey prompt was not for joining a kitchen.");
    return this.create(identity, { userHandle: reg.userHandle, credential: reg.credential });
  }

  /** DEMO ONLY (DOCK_DEMO_TAP_APPROVAL=1): join without a passkey. Approvals from this kitchen are recorded as unverified. */
  async joinWithoutPasskey(): Promise<{ sandbox: SandboxSummary; sessionToken: string }> {
    return this.create(sandboxIdentity(this.seq++), undefined);
  }

  private async create(
    identity: SandboxIdentity,
    passkey: { userHandle: string; credential: Parameters<PasskeyService["enrol"]>[1] } | undefined,
  ): Promise<{ sandbox: SandboxSummary; sessionToken: string }> {
    await this.ensureRoom();
    const now = this.now();
    const expiresAt = addMinutes(now, this.deps.limits().ttlMinutes);
    const sandboxId = newId("sbx");
    const orgId = `org_${sandboxId}`;
    const agentId = `agent_${sandboxId}`;
    const key = await generateEd25519KeyPair(`${orgId}-key`);
    this.deps.registry.add({ kid: key.kid, orgId, publicKey: key.publicKey });
    const mandate = sandboxMandate({ now, expiresAt, orgId, orgName: `${identity.kitchenName}, ${identity.city}`, agentId, approverName: identity.approverName });
    const mandateToken = await signMandate(mandate, key);
    if (this.deps.kitchens) {
      // A plausible past: a hotel buying a few hundred litres of milk twice a week, from the catalogue it runs on.
      await this.deps.kitchens.saveProfile(hotelKitchenProfile(orgId, mandate.issuer.name, now, await this.deps.products?.()));
    }
    const approverId = newId("apv");
    await this.deps.passkeys.enrol(
      { approverId, orgId, role: SANDBOX_ROLE.id, name: identity.approverName, userHandle: passkey?.userHandle ?? "", createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() },
      passkey?.credential,
    );
    const sandbox: SandboxRecord = {
      ...identity,
      sandboxId,
      orgId,
      agentId,
      approverId,
      role: SANDBOX_ROLE.id,
      roleLabel: SANDBOX_ROLE.label,
      mandate,
      mandateToken,
      passkey: passkey !== undefined,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      publicJwk: key.publicJwk,
    };
    await this.sandboxes.put(sandbox);
    const sessionToken = await this.deps.passkeys.newSession(approverId, expiresAt);
    return { sandbox: summarize(sandbox), sessionToken };
  }

  async get(sandboxId: string): Promise<SandboxSummary | undefined> {
    await this.sweep();
    const s = await this.sandboxes.get(sandboxId);
    return s && summarize(s);
  }

  async forApprover(approverId: string): Promise<SandboxSummary | undefined> {
    await this.sweep();
    const s = (await this.sandboxes.list()).find((x) => x.approverId === approverId);
    return s && summarize(s);
  }

  async list(): Promise<SandboxSummary[]> {
    await this.sweep();
    return (await this.sandboxes.list()).map(summarize);
  }

  /** The agent credentials of a kitchen, for server-side callers (the scripted agent, an MCP bridge). */
  async agentCredentials(sandboxId: string): Promise<{ mandateToken: string; agentId: string } | undefined> {
    await this.sweep();
    const s = await this.sandboxes.get(sandboxId);
    return s && { mandateToken: s.mandateToken, agentId: s.agentId };
  }

  /**
   * Reissue a visitor kitchen's mandate with new terms (server/mandates.ts decides them). The organisation's first
   * private key was used once and never stored, so the kitchen signs with a fresh key: Dock trusts its public half
   * from now on, the private half is used for this one signature and discarded again. The kitchen's agent, console
   * and connector address present the new mandate from the next call.
   */
  async reissue(sandboxId: string, mandate: Mandate): Promise<void> {
    const s = await this.sandboxes.get(sandboxId);
    if (!s) throw new DockError(404, "sandbox_not_found", "This demo kitchen does not exist or has closed.");
    const key = await generateEd25519KeyPair(`${s.orgId}-key-${newId("k").slice(2, 10)}`);
    this.deps.registry.add({ kid: key.kid, orgId: s.orgId, publicKey: key.publicKey });
    await this.sandboxes.put({ ...s, mandate, mandateToken: await signMandate(mandate, key), publicJwk: key.publicJwk });
  }

  /** The mandate a kitchen's agent presents now. */
  async mandateOf(sandboxId: string): Promise<Mandate | undefined> {
    return (await this.sandboxes.get(sandboxId))?.mandate;
  }

  /** Run the scripted buyer for this kitchen: the 1,000 L milk order, which needs the visitor's sign-off. */
  async runDemoOrder(sandboxId: string): Promise<PublicOrder> {
    const creds = await this.agentCredentials(sandboxId);
    if (!creds) throw new DockError(404, "sandbox_not_found", "This demo kitchen does not exist or has closed.");
    // The scripted buyer passes the same operations check as every other caller (ops/onsite.ts admission).
    const session = await onsiteSession(this.deps.dock, creds, "scripted demo order");
    const s = await this.sandboxes.get(sandboxId);
    return runKitchenScenario(this.deps.dock, session, { now: this.now(), by: s ? `${s.approverName} (scripted buyer)` : undefined });
  }
}

function summarize(s: Sandbox): SandboxSummary {
  const { mandateToken: _t, mandate, publicJwk: _k, ...rest } = s as Sandbox & { publicJwk?: JWK };
  void _t;
  void _k;
  return { ...rest, perOrderLimitCents: mandate.perOrderLimitCents, weeklyBudgetCents: mandate.weeklyBudgetCents };
}
