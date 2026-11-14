import type { IntakeRepository } from "@/core/intake";
import type { KitchenProfile, KitchenRepository } from "@/core/kitchen";
import type { DockRepository, Order, OrderSpend, PurchaseRequest, SplitQuery } from "@/core/orders";
import type { SplitWindow } from "@/core/policy";
import type { ApproverAccount, ApproverSession, Ceremony, PasskeyStore, StoredCredential } from "@/core/passkeys";
import type { PgDocs } from "./docs";

type Intake = NonNullable<Awaited<ReturnType<IntakeRepository["get"]>>>;

/**
 * Requests and orders as documents; "this quote was used" as a primary key, so claiming it is one atomic insert.
 * The gate's queries (ordersOf, spendOf, splitWindow, the pending orders) filter and sum in SQL on the stored
 * columns schema.ts adds for orders (status, created_iso, total_cents, categories, ...), so deciding one order reads
 * a few rows and sums, never every stored order.
 */
export class PgDockRepository implements DockRepository {
  private readonly t: string;
  constructor(private readonly docs: PgDocs) {
    this.t = `${docs.schema}.docs`;
  }

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
    return this.orders("true", []);
  }
  async ordersOf(orgId: string, since?: string) {
    return since ? this.orders("org_id = $1 and created_iso > $2", [orgId, since]) : this.orders("org_id = $1", [orgId]);
  }
  async ordersOfRequest(requestId: string) {
    return this.orders("request_id = $1", [requestId]);
  }
  async pendingOrders(orgId?: string) {
    return orgId ? this.orders("status = 'pending_approval' and org_id = $1", [orgId]) : this.orders("status = 'pending_approval'", []);
  }
  async pendingExpired(at: string, orgId?: string) {
    const due = "status = 'pending_approval' and quote_expires::timestamptz <= $1::timestamptz";
    return orgId ? this.orders(`${due} and org_id = $2`, [at, orgId]) : this.orders(due, [at]);
  }
  async spendOf(orgId: string, q: { since: string; at: string; excludeOrderId?: string }): Promise<OrderSpend> {
    const r = await this.docs.pool.query<{ committed: string; held: { orderId: string; totalCents: number | string; expiresAt: string }[] }>(
      `select coalesce(sum(total_cents) filter (where status = 'committed'), 0)::text as committed,
              coalesce(jsonb_agg(jsonb_build_object('orderId', id, 'totalCents', total_cents, 'expiresAt', quote_expires) order by created_iso, id)
                         filter (where status = 'pending_approval' and quote_expires::timestamptz > $3::timestamptz), '[]'::jsonb) as held
         from ${this.t}
        where collection = 'order' and org_id = $1 and created_iso > $2 and status in ('committed', 'pending_approval') and id <> $4`,
      [orgId, q.since, q.at, q.excludeOrderId ?? ""],
    );
    const row = r.rows[0];
    return { committedCents: Number(row?.committed ?? 0), held: (row?.held ?? []).map((h) => ({ orderId: h.orderId, totalCents: Number(h.totalCents), expiresAt: h.expiresAt })) };
  }
  /** Counted and summed on the row's own columns; only the newest `latest` documents are opened (for their delivery days). */
  async splitWindow(orgId: string, q: SplitQuery): Promise<SplitWindow> {
    const r = await this.docs.pool.query<{ n: number; total: string; latest: { id: string; request_id: string; created_iso: string; total_cents: number | string; categories: string[]; dates: string[] }[] }>(
      `with w as (
         select id, request_id, created_iso, total_cents, categories
           from ${this.t}
          where collection = 'order' and org_id = $1 and created_iso > $2 and status = 'committed' and approval_id is null and id <> $3
            and (request_id = $4 or categories ?| $5::text[])
       )
       select (select count(*) from w)::int as n,
              (select coalesce(sum(total_cents), 0) from w)::text as total,
              coalesce((select jsonb_agg(x order by x.created_iso desc, x.id desc)
                          from (select l.*, jsonb_path_query_array(d.doc, '$.lines[*].deliveryDate') as dates
                                  from (select * from w order by created_iso desc, id desc limit $6) l
                                  join ${this.t} d on d.collection = 'order' and d.id = l.id) x), '[]'::jsonb) as latest`,
      [orgId, q.since, q.excludeOrderId ?? "", q.requestId, q.categories, q.latest ?? 10],
    );
    const row = r.rows[0];
    return {
      count: row?.n ?? 0,
      totalCents: Number(row?.total ?? 0),
      latest: (row?.latest ?? []).map((x) => ({
        orderId: x.id,
        requestId: x.request_id,
        placedAt: x.created_iso,
        totalCents: Number(x.total_cents),
        categories: [...new Set(x.categories ?? [])],
        deliveryDates: [...new Set(x.dates ?? [])],
        authorisedBy: "mandate" as const,
      })),
    };
  }
  async claimQuote(quoteId: string) {
    const r = await this.docs.pool.query(`insert into ${this.docs.schema}.used_quotes (quote_id) values ($1) on conflict do nothing`, [quoteId]);
    return r.rowCount === 1;
  }
  async isQuoteUsed(quoteId: string) {
    const r = await this.docs.pool.query(`select 1 from ${this.docs.schema}.used_quotes where quote_id = $1`, [quoteId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Orders matching `where` (placeholders from $1), oldest first. */
  private async orders(where: string, args: unknown[]): Promise<Order[]> {
    const r = await this.docs.pool.query<{ doc: Order }>(`select doc from ${this.t} where collection = 'order' and (${where}) order by created_iso, id`, args);
    return r.rows.map((x) => x.doc);
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
