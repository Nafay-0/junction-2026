import { DockError } from "@/core/errors";
import { emptyMemory, emptyProfile, isSafetyFact, type KitchenProfile, type KitchenRepository, type MemoryFact, type MemoryItem, type MemoryStrength } from "@/core/kitchen";
import type { Ledger } from "@/core/ledger";
import type { Mandate } from "@/core/mandate";
import { newId } from "@/core/util";
import { answerConfirmation, correct, decide, forget, setAudience, touch, type ItemChange } from "./decide";
import { InteractionSchema, KIND_LABEL, itemView, normaliseFact, type Interaction, type InteractionEvent } from "./model";
import type { Proposer } from "./propose";
import { applyScopedRules, recall, usageLines, type RecallQuery } from "./recall";
import { fromHistory } from "./signals";
import type { MemoryIndex } from "./vectors";
import { writeMemory, type WriteReport } from "./writer";

/**
 * Memory, bound to a kitchen repository and the ledger. Every per-kitchen call takes the org id that the CALLER
 * resolved from its own session (the kitchen console's mandate, never a request body), loads only that
 * kitchen's profile, and finds items only inside it: one kitchen's memory cannot be read or changed through
 * another's session. The wholesaler's view reads shared items only and records each read in the kitchen's memory.
 *
 * The ledger gets one line per change. A private item's words never go into it (the wholesaler's staff read the
 * ledger): only its kind.
 */

export type MemoryServiceDeps = {
  kitchens: KitchenRepository;
  ledger?: Ledger;
  now?: () => Date;
  proposer?: Proposer;
  index?: MemoryIndex;
  /** Kitchens to look at when the repository cannot list them. */
  knownOrgIds?: () => Promise<string[]>;
};

export type InteractionInput = Omit<Partial<Interaction>, "events"> & { door: Interaction["door"]; events?: InteractionEvent[] };

const MAX_STAFF_READS = 100;

export function createMemoryService(deps: MemoryServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const locks = new Map<string, Promise<unknown>>();
  const indexed = new Map<string, Map<string, string>>(); // org -> item -> text in the index

  /** One change at a time per kitchen: read, change, save, without losing a concurrent change. */
  function withOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(orgId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    locks.set(
      orgId,
      run.catch(() => undefined),
    );
    return run;
  }

  async function load(orgId: string, name?: string): Promise<KitchenProfile> {
    const p = (await deps.kitchens.getProfile(orgId)) ?? emptyProfile(orgId, name ?? orgId);
    return { ...p, memory: { ...emptyMemory(), ...p.memory } };
  }

  async function save(p: KitchenProfile) {
    await deps.kitchens.saveProfile(p);
    await syncIndex(p);
  }

  async function syncIndex(p: KitchenProfile) {
    if (!deps.index) return;
    const had = indexed.get(p.orgId) ?? new Map<string, string>();
    const items = (p.memory?.items ?? []).filter((m) => m.status === "active");
    const now = new Map(items.map((m) => [m.id, `${m.text} ${m.family ?? ""}`]));
    const removed = [...had.keys()].filter((id) => !now.has(id));
    const changed = [...now.entries()].filter(([id, t]) => had.get(id) !== t).map(([id, text]) => ({ id, text }));
    try {
      await deps.index.remove(p.orgId, removed);
      await deps.index.upsert(p.orgId, changed);
      indexed.set(p.orgId, now);
    } catch {
      // A vector store outage only weakens recall's wording match; recall falls back to in-process matching.
    }
  }

  const publicText = (m: MemoryItem) => (m.audience === "shared" ? `"${m.text}"` : `a private ${KIND_LABEL[m.fact.kind]}`);
  function log(actor: string, summary: string, data: Record<string, unknown>) {
    deps.ledger?.append({ type: "intake", actor, summary, data: { step: "memory", ...data } });
  }
  const person = (by: string) => `buyer:${by}`;
  const find = (p: KitchenProfile, itemId: string) => {
    const m = p.memory?.items.find((x) => x.id === itemId);
    if (!m) throw new DockError(404, "memory_item_not_found", "That item is not in this kitchen's memory.");
    return m;
  };

  /** Learn standing orders and delivery days from the order history, and keep projections in step. */
  async function refresh(p: KitchenProfile): Promise<KitchenProfile> {
    const at = now();
    const d = decide(p, fromHistory(p, at), { id: `hist_${at.getTime()}`, at: at.toISOString(), door: "order", segments: [], events: [] }, at);
    return d.profile;
  }

  function overview(p: KitchenProfile) {
    const items = p.memory!.items;
    const views = items.filter((m) => m.status !== "superseded").map(itemView);
    return {
      orgId: p.orgId,
      name: p.name,
      items: views,
      pending: items.filter((m) => m.status === "pending_confirmation").map((m) => ({ itemId: m.id, question: m.replaces ? `Replace "${items.find((x) => x.id === m.replaces)?.text ?? "the earlier rule"}" with "${m.text}"?` : `Remember "${m.text}"${m.family ? ` for every ${m.family} order` : " for every order"}?` })),
      superseded: items.filter((m) => m.status === "superseded").map(itemView),
      /** What the wholesaler's staff can see: shared items only. */
      sharedWithWholesaler: views.filter((v) => v.audience === "shared" && v.status === "active").map((v) => v.id),
      proposals: p.memory!.proposals,
      staffReads: p.memory!.staffReads.slice(-20).reverse(),
      forgotten: p.memory!.forgotten.filter((t) => t.reason !== "declined").map((t) => ({ kind: t.kind, at: t.at, by: t.by })),
      deliveryWeekdays: p.deliveryWeekdays,
    };
  }

  return {
    /** Everything the kitchen's memory holds, for its memory page. */
    async view(orgId: string, name?: string) {
      return withOrg(orgId, async () => {
        const before = await load(orgId, name);
        const p = await refresh(before);
        if (JSON.stringify(p) !== JSON.stringify(before)) await save(p);
        return overview(p);
      });
    },

    /** Learn from one interaction. The org id is the session's; nothing in the input can name another kitchen. */
    async write(orgId: string, input: InteractionInput, name?: string): Promise<WriteReport> {
      const parsed = InteractionSchema.parse({ ...input, events: input.events ?? [] });
      const at = now();
      const interaction: Interaction = {
        id: parsed.id ?? newId("int"),
        at: at.toISOString(),
        door: parsed.door,
        ...(input.by ? { by: String(input.by).slice(0, 120) } : {}),
        ...(parsed.site ? { site: parsed.site } : {}),
        ...(parsed.requestId ? { requestId: parsed.requestId } : {}),
        ...(parsed.orderId ? { orderId: parsed.orderId } : {}),
        segments: parsed.segments,
        events: (input.events ?? []).slice(0, 20),
      };
      return withOrg(orgId, async () => {
        const p = await load(orgId, name);
        const { profile, report } = await writeMemory(p, interaction, { proposer: deps.proposer, now: at });
        await save(profile);
        const changed = report.outcomes.filter((o) => o.action !== "discarded" && o.action !== "merged");
        if (changed.length || report.questions.length) {
          const byId = new Map(profile.memory!.items.map((m) => [m.id, m]));
          log(interaction.by ? person(interaction.by) : "dock", `Memory learned from ${interaction.door}: ${changed.map((o) => `${o.action} ${byId.get(o.itemId ?? "") ? publicText(byId.get(o.itemId!)!) : "an item"}`).join("; ") || "nothing new"}${report.questions.length ? `; asked ${report.questions.length} question${report.questions.length > 1 ? "s" : ""}` : ""}.`, {
            action: "learn",
            interactionId: interaction.id,
            requestId: interaction.requestId,
            outcomes: report.outcomes.map((o) => ({ action: o.action, itemId: o.itemId, reason: o.reason })),
            model: report.model,
          });
        }
        return report;
      });
    },

    /** A person's yes or no to "should I remember this?" or "keep this rule?". */
    async confirm(orgId: string, itemId: string, yes: boolean, by: string) {
      return withOrg(orgId, async () => {
        const p = await load(orgId);
        const item = find(p, itemId);
        const r = answerConfirmation(p, itemId, yes, by, now());
        if (r.outcome === "not_pending") throw new DockError(409, "memory_not_pending", "That item is not waiting for an answer.");
        await save(r.profile);
        log(person(by), `${by} ${yes ? "confirmed" : "declined"} ${publicText(item)} (${r.outcome}).`, { action: "confirm", itemId, yes, outcome: r.outcome });
        return { outcome: r.outcome, memory: overview(r.profile) };
      });
    },

    async correct(orgId: string, itemId: string, change: ItemChange, by: string) {
      return withOrg(orgId, async () => {
        const p = await load(orgId);
        const before = find(p, itemId);
        const r = correct(p, itemId, change, by, now());
        if (!r.ok) throw new DockError(400, "memory_change_invalid", r.reason ?? "That change cannot be made.");
        await save(r.profile);
        log(person(by), `${by} corrected ${publicText(before)}${before.audience === "shared" ? ` to "${find(r.profile, itemId).text}"` : ""}.`, { action: "correct", itemId });
        return overview(r.profile);
      });
    },

    /** Forget: the item, the items it replaced, its projections and its vectors go. The ledger keeps that it happened, not what it was. */
    async forget(orgId: string, itemId: string, by: string) {
      return withOrg(orgId, async () => {
        const p = await load(orgId);
        const r = forget(p, itemId, by, now());
        if (!r.tombstone) throw new DockError(404, "memory_item_not_found", "That item is not in this kitchen's memory.");
        await save(r.profile);
        log(person(by), `${by} told the agent to forget a ${KIND_LABEL[r.tombstone.kind]}. It is gone from memory; this line only records that it was forgotten.`, { action: "forget", kind: r.tombstone.kind });
        return overview(r.profile);
      });
    },

    async setAudience(orgId: string, itemId: string, audience: "shared" | "private", by: string) {
      return withOrg(orgId, async () => {
        const p = await load(orgId);
        const item = find(p, itemId);
        const r = setAudience(p, itemId, audience, by, now());
        await save(r.profile);
        log(person(by), `${by} made a ${KIND_LABEL[item.fact.kind]} ${audience === "shared" ? "visible to the wholesaler" : "private to the kitchen"}.`, { action: "audience", itemId, audience });
        return overview(r.profile);
      });
    },

    /** A person states something to remember on the memory page: a rule, or a note to keep. */
    async state(orgId: string, input: { fact: unknown; family?: string; text?: string; strength?: MemoryStrength; site?: string; by: string }) {
      const n = normaliseFact(input.fact);
      if (!n.ok) throw new DockError(400, "memory_fact_invalid", n.reason);
      const strength: MemoryStrength = input.strength ?? (n.fact.kind === "note" ? "habit" : "rule");
      const report = await this.write(orgId, {
        door: "memory_page",
        by: input.by,
        events: [{ type: "rule_stated", fact: n.fact, ...(input.family ? { family: input.family } : {}), ...(input.text ? { text: input.text } : {}), strength, ...(input.site ? { scope: { site: input.site } } : {}) }],
      });
      return report;
    },

    async recall(orgId: string, q: RecallQuery) {
      const p = await load(orgId);
      let similarity: Map<string, number> | undefined;
      const text = [q.text, q.dish, q.family].filter(Boolean).join(" ");
      if (deps.index && text) {
        try {
          similarity = new Map((await deps.index.search(orgId, text, 30)).map((h) => [h.id, h.score]));
        } catch {
          similarity = undefined;
        }
      }
      return recall(p, q, { now: now(), similarity });
    },

    /** Site- or person-scoped rules for a request from that site, applied to the need before the intake. */
    async applyScoped<N extends Parameters<typeof applyScopedRules>[0]>(orgId: string, need: N, scope: { site?: string; person?: string }) {
      return applyScopedRules(need, await load(orgId), scope, now());
    },

    /** The card's memory lines for an intake, and its items' last use set to now. */
    async usage(orgId: string, intake: Parameters<typeof usageLines>[1]) {
      return withOrg(orgId, async () => {
        const p = await load(orgId);
        const u = usageLines(p, intake);
        if (u.itemIds.length) await save(touch(p, u.itemIds, now()));
        return u.lines;
      });
    },

    /**
     * Safety rules the gate does not enforce yet: offered for the kitchen's signed mandate. A kitchen-wide allergen
     * rule becomes a forbidden allergen; a diet rule for every family a required attribute. Family- or site-scoped
     * rules stay in memory: the mandate's attributes apply to every product.
     */
    async mandateOffers(orgId: string, mandate: Pick<Mandate, "forbiddenAllergens" | "requiredAttributes">) {
      return withOrg(orgId, async () => {
        const p = await load(orgId);
        const at = now().toISOString();
        const offers = p.memory!.items.filter((m) => m.status === "active" && m.strength === "rule" && isSafetyFact(m.fact) && !m.scope && !m.family && m.mandate?.status !== "declined").flatMap((m): { item: MemoryItem; patch: { forbiddenAllergens?: string[]; requiredAttributes?: string[] } }[] => {
          const f = m.fact;
          if (f.kind === "allergen" && !mandate.forbiddenAllergens.includes(f.allergen)) return [{ item: m, patch: { forbiddenAllergens: [f.allergen] } }];
          if (f.kind === "diet" && !mandate.requiredAttributes.includes(f.claim)) return [{ item: m, patch: { requiredAttributes: [f.claim] } }];
          if (f.kind === "allergen" || f.kind === "diet") m.mandate = { status: "added", at: m.mandate?.at ?? at };
          return [];
        });
        for (const o of offers) if (!o.item.mandate) o.item.mandate = { status: "offered", at };
        await save(p);
        return offers.map((o) => ({
          itemId: o.item.id,
          text: o.item.text,
          patch: o.patch,
          line: `"${o.item.text}" is remembered, but only memory enforces it. Add it to the signed mandate so the gate refuses any order that breaks it, whoever's agent sends it.`,
        }));
      });
    },

    async decideMandate(orgId: string, itemId: string, decision: "added" | "declined", by: string) {
      return withOrg(orgId, async () => {
        const p = await load(orgId);
        const m = find(p, itemId);
        m.mandate = { status: decision, at: now().toISOString(), by };
        m.history.push({ at: now().toISOString(), change: decision === "added" ? "added to the signed mandate" : "kept in memory only, not the mandate", by });
        await save(p);
        log(person(by), `${by} ${decision === "added" ? "added" : "did not add"} ${publicText(m)} to the kitchen's mandate.`, { action: "mandate", itemId, decision });
        return overview(p);
      });
    },

    // ---------- the wholesaler's side ----------

    /**
     * Shared items across kitchens (or one), with their provenance, for the wholesaler's staff. Private items are
     * never in it. Each kitchen whose memory is shown gets a read record it can see.
     */
    async staffView(staff: string, orgIds?: string[]) {
      const ids = orgIds ?? (await (deps.kitchens.listOrgIds?.() ?? deps.knownOrgIds?.() ?? Promise.resolve([])));
      const kitchens = [];
      for (const orgId of [...new Set(ids)]) {
        const view = await withOrg(orgId, async () => {
          const p = await deps.kitchens.getProfile(orgId);
          if (!p) return undefined;
          const shared = (p.memory?.items ?? []).filter((m) => m.audience === "shared" && m.status === "active");
          if (shared.length) {
            const mem = { ...emptyMemory(), ...p.memory };
            mem.staffReads = [...mem.staffReads, { by: staff, at: now().toISOString(), items: shared.length }].slice(-MAX_STAFF_READS);
            await deps.kitchens.saveProfile({ ...p, memory: mem });
            log(`staff:${staff}`, `${staff} (wholesaler staff) read ${shared.length} shared memory item${shared.length > 1 ? "s" : ""} of ${p.name}.`, { action: "staff_read", orgId, items: shared.length });
          }
          return { orgId, name: p.name, items: shared.map(itemView), openProposals: (p.memory?.proposals ?? []).filter((x) => x.status === "open" && x.by === staff) };
        });
        if (view && view.items.length) kitchens.push(view);
      }
      return { staff, kitchens };
    },

    /** Staff propose a correction; only the kitchen can make it. A proposal may point at a shared item only. */
    async staffPropose(staff: string, orgId: string, input: { itemId?: string; text: string; fact?: unknown }) {
      return withOrg(orgId, async () => {
        const p = await deps.kitchens.getProfile(orgId);
        if (!p) throw new DockError(404, "kitchen_not_found", "No such kitchen.");
        const mem = { ...emptyMemory(), ...p.memory };
        if (input.itemId && !mem.items.some((m) => m.id === input.itemId && m.audience === "shared" && m.status === "active")) throw new DockError(404, "memory_item_not_found", "No shared item with that id.");
        let fact: MemoryFact | undefined;
        if (input.fact !== undefined) {
          const n = normaliseFact(input.fact);
          if (!n.ok) throw new DockError(400, "memory_fact_invalid", n.reason);
          fact = n.fact;
        }
        const text = input.text.trim().slice(0, 300);
        if (!text) throw new DockError(400, "invalid_request", "Say what should change.");
        const proposal = { id: newId("prop"), by: staff, at: now().toISOString(), ...(input.itemId ? { itemId: input.itemId } : {}), text, ...(fact ? { fact } : {}), status: "open" as const };
        mem.proposals = [...mem.proposals, proposal].slice(-100);
        await deps.kitchens.saveProfile({ ...p, memory: mem });
        log(`staff:${staff}`, `${staff} (wholesaler staff) proposed a memory correction to ${p.name}: "${text}". The kitchen decides.`, { action: "staff_proposal", orgId, proposalId: proposal.id });
        return proposal;
      });
    },

    /** The kitchen accepts or declines a staff proposal. Accepting makes it the kitchen person's own statement. */
    async decideProposal(orgId: string, proposalId: string, accept: boolean, by: string) {
      const p0 = await load(orgId);
      const proposal = p0.memory!.proposals.find((x) => x.id === proposalId && x.status === "open");
      if (!proposal) throw new DockError(404, "proposal_not_found", "No open proposal with that id.");
      if (accept && proposal.fact) {
        if (proposal.itemId && p0.memory!.items.some((m) => m.id === proposal.itemId)) await this.correct(orgId, proposal.itemId, { fact: proposal.fact }, by);
        else await this.write(orgId, { door: "staff_proposal", by, events: [{ type: "rule_stated", fact: proposal.fact, strength: "rule" }] });
      }
      return withOrg(orgId, async () => {
        const p = await load(orgId);
        const x = p.memory!.proposals.find((y) => y.id === proposalId)!;
        Object.assign(x, { status: accept ? "accepted" : "declined", decidedBy: by, decidedAt: now().toISOString() });
        if (accept && x.itemId && !x.fact) {
          const m = p.memory!.items.find((i) => i.id === x.itemId);
          m?.history.push({ at: now().toISOString(), change: `wholesaler staff (${x.by}) noted: ${x.text}; accepted by the kitchen`, by });
        }
        await save(p);
        log(person(by), `${by} ${accept ? "accepted" : "declined"} a memory correction proposed by ${x.by}.`, { action: "proposal_decided", proposalId, accept });
        return overview(p);
      });
    },

    /** For tests and scripts. */
    load,
  };
}

export type MemoryService = ReturnType<typeof createMemoryService>;
