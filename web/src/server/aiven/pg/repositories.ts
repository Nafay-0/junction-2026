import type { IntakeRepository } from "@/core/intake";
import type { KitchenProfile, KitchenRepository } from "@/core/kitchen";
import type { DockRepository, Order, PurchaseRequest } from "@/core/orders";
import type { ApproverAccount, ApproverSession, Ceremony, PasskeyStore, StoredCredential } from "@/core/passkeys";
import type { PgDocs } from "./docs";

type Intake = NonNullable<Awaited<ReturnType<IntakeRepository["get"]>>>;

/** Requests and orders as documents; "this quote was used" as a primary key, so claiming it is one atomic insert. */
export class PgDockRepository implements DockRepository {
  constructor(private readonly docs: PgDocs) {}

  async saveRequest(r: PurchaseRequest) {
    await this.docs.put("request", r.requestId, r);
  }
  async getRequest(id: string) {
    return this.docs.get<PurchaseRequest>("request", id);
  }
  async saveOrder(o: Order) {
    await this.docs.put("order", o.orderId, o);
  }
  async getOrder(id: string) {
    return this.docs.get<Order>("order", id);
  }
  async getOrderByApprovalId(approvalId: string) {
    return (await this.docs.find<Order>("order", { approvalId }, { limit: 1 }))[0];
  }
  async listOrders() {
    return this.docs.find<Order>("order");
  }
  async claimQuote(quoteId: string) {
    const r = await this.docs.pool.query(`insert into ${this.docs.schema}.used_quotes (quote_id) values ($1) on conflict do nothing`, [quoteId]);
    return r.rowCount === 1;
  }
  async isQuoteUsed(quoteId: string) {
    const r = await this.docs.pool.query(`select 1 from ${this.docs.schema}.used_quotes where quote_id = $1`, [quoteId]);
    return (r.rowCount ?? 0) > 0;
  }
}

/** Kitchen memory: one document per organisation (profile, preferences, order history). */
export class PgKitchenRepository implements KitchenRepository {
  constructor(private readonly docs: PgDocs) {}

  async getProfile(orgId: string) {
    return this.docs.get<KitchenProfile>("kitchen", orgId);
  }
  async saveProfile(profile: KitchenProfile) {
    await this.docs.put("kitchen", profile.orgId, profile);
  }
  /** First start only: a returning kitchen for the demo, kept as it grows afterwards. */
  async seed(profiles: KitchenProfile[]) {
    for (const p of profiles) await this.docs.putIfAbsent("kitchen", p.orgId, p);
  }
}

export class PgIntakeRepository implements IntakeRepository {
  constructor(private readonly docs: PgDocs) {}

  async get(requestId: string) {
    return this.docs.get<Intake>("intake", requestId);
  }
  async save(intake: Intake) {
    await this.docs.put("intake", intake.requestId, intake);
  }
}

/**
 * Approvers, passkeys, sessions and open passkey prompts. `takeCeremony` is `delete ... returning`: the replay
 * guard holds across processes and restarts, since a prompt can only be deleted once.
 */
export class PgPasskeyStore implements PasskeyStore {
  constructor(private readonly docs: PgDocs) {}

  async putAccount(a: ApproverAccount) {
    await this.docs.put("approver", a.approverId, a, a.expiresAt);
  }
  async getAccount(approverId: string) {
    return this.docs.get<ApproverAccount>("approver", approverId);
  }
  async findApprover(orgId: string, role: string) {
    return (await this.docs.find<ApproverAccount>("approver", { orgId, role }, { limit: 1 }))[0];
  }
  async deleteAccount(approverId: string) {
    await this.docs.delete("approver", approverId);
    await this.docs.deleteWhere("credential", { approverId });
    await this.docs.deleteWhere("session", { approverId });
  }
  async putCredential(c: StoredCredential) {
    await this.docs.put("credential", c.credentialId, c);
  }
  async getCredential(credentialId: string) {
    return this.docs.get<StoredCredential>("credential", credentialId);
  }
  async credentialsOf(approverId: string) {
    return this.docs.find<StoredCredential>("credential", { approverId });
  }
  async putCeremony(c: Ceremony) {
    await this.docs.put("ceremony", c.challenge, c, c.expiresAt);
  }
  async takeCeremony(challenge: string) {
    return this.docs.take<Ceremony>("ceremony", challenge);
  }
  async sweepCeremonies(nowMs: number) {
    return this.docs.sweep("ceremony", nowMs);
  }
  async putSession(tokenHash: string, s: ApproverSession) {
    await this.docs.put("session", tokenHash, s, s.expiresAt);
  }
  async getSession(tokenHash: string) {
    return this.docs.get<ApproverSession>("session", tokenHash);
  }
}

/** Generic expiring records (visitor sandboxes): what SandboxService needs from a store. */
export class PgRecordStore<T extends { expiresAt: string }> {
  constructor(
    private readonly docs: PgDocs,
    private readonly collection: string,
    private readonly idOf: (r: T) => string,
  ) {}

  async put(r: T) {
    await this.docs.put(this.collection, this.idOf(r), r, r.expiresAt);
  }
  async get(id: string) {
    return this.docs.get<T>(this.collection, id);
  }
  async list() {
    return this.docs.find<T>(this.collection);
  }
  async delete(id: string) {
    await this.docs.delete(this.collection, id);
  }
}
