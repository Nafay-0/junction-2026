import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import type { Product } from "@/core/catalog";
import type { KitchenRepository } from "@/core/kitchen";
import { generateEd25519KeyPair, type KeyPair } from "@/core/keys";
import { signMandate, type Mandate, type createTrustRegistry } from "@/core/mandate";
import { DockError, type Dock, type PublicOrder } from "@/core/orders";
import { PasskeyError, type PasskeyService, type RelyingParty } from "@/core/passkeys";
import { addMinutes, newId } from "@/core/util";
import { SANDBOX_ROLE, sandboxIdentity, sandboxMandate, type SandboxIdentity } from "./dev-fixtures";
import { hotelKitchenProfile } from "./demo-kitchen";
import { runKitchenScenario } from "./sandbox-scenario";

/**
 * Visitor kitchens. Each visitor who scans the QR code gets their own buyer organisation (with its own Ed25519
 * signing key, trusted by Dock), a signed mandate, a buyer agent, and becomes that organisation's only approver,
 * with a passkey on their phone. Visitors never see each other's orders. Kitchens expire; their number is capped.
 *
 * In memory, single process. With several instances, keep sandboxes and keys in Postgres (the private key
 * encrypted, or not kept at all once the mandate is signed) and add the org key to the trust registry table.
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

export type SandboxDeps = {
  dock: Dock;
  registry: ReturnType<typeof createTrustRegistry>;
  passkeys: PasskeyService;
  limits: () => { max: number; ttlMinutes: number };
  now?: () => Date;
  /** Where each new kitchen's order history goes (the same repository the Dock instance reads). */
  kitchens?: KitchenRepository;
  /** Catalogue products the history is drawn from, by attribute (seed or real catalogue). */
  products?: () => Promise<Product[]>;
};

export class SandboxService {
  private readonly sandboxes = new Map<string, Sandbox & { key: KeyPair }>();
  private seq = 0;
  private readonly now: () => Date;

  constructor(private readonly deps: SandboxDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Drops expired kitchens and their approver accounts. Their orders stay in the ledger. */
  async sweep(): Promise<void> {
    const t = this.now().getTime();
    for (const [id, s] of this.sandboxes) {
      if (Date.parse(s.expiresAt) > t) continue;
      this.sandboxes.delete(id);
      await this.deps.passkeys.store.deleteAccount(s.approverId);
    }
  }

  private async ensureRoom(): Promise<void> {
    await this.sweep();
    if (this.sandboxes.size >= this.deps.limits().max) {
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
    const sandbox: Sandbox & { key: KeyPair } = {
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
      key,
    };
    this.sandboxes.set(sandboxId, sandbox);
    const sessionToken = await this.deps.passkeys.newSession(approverId, expiresAt);
    return { sandbox: summarize(sandbox), sessionToken };
  }

  async get(sandboxId: string): Promise<SandboxSummary | undefined> {
    await this.sweep();
    const s = this.sandboxes.get(sandboxId);
    return s && summarize(s);
  }

  async forApprover(approverId: string): Promise<SandboxSummary | undefined> {
    await this.sweep();
    const s = [...this.sandboxes.values()].find((x) => x.approverId === approverId);
    return s && summarize(s);
  }

  async list(): Promise<SandboxSummary[]> {
    await this.sweep();
    return [...this.sandboxes.values()].map(summarize);
  }

  /** The agent credentials of a kitchen, for server-side callers (the scripted agent, an MCP bridge). */
  async agentCredentials(sandboxId: string): Promise<{ mandateToken: string; agentId: string } | undefined> {
    await this.sweep();
    const s = this.sandboxes.get(sandboxId);
    return s && { mandateToken: s.mandateToken, agentId: s.agentId };
  }

  /** Run the scripted buyer for this kitchen: the 1,000 L milk order, which needs the visitor's sign-off. */
  async runDemoOrder(sandboxId: string): Promise<PublicOrder> {
    const creds = await this.agentCredentials(sandboxId);
    if (!creds) throw new DockError(404, "sandbox_not_found", "This demo kitchen does not exist or has closed.");
    const session = await this.deps.dock.authenticate(creds.mandateToken, creds.agentId);
    const s = this.sandboxes.get(sandboxId);
    return runKitchenScenario(this.deps.dock, session, { now: this.now(), by: s ? `${s.approverName} (scripted buyer)` : undefined });
  }
}

function summarize(s: Sandbox): SandboxSummary {
  const { mandateToken: _t, mandate, key: _k, ...rest } = s as Sandbox & { key?: KeyPair };
  void _t;
  void _k;
  return { ...rest, perOrderLimitCents: mandate.perOrderLimitCents, weeklyBudgetCents: mandate.weeklyBudgetCents };
}
