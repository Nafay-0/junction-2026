import type { Pool } from "pg";
import type { EventBus } from "@/core/events";
import type { IntakeRepository } from "@/core/intake";
import type { KitchenProfile, KitchenRepository } from "@/core/kitchen";
import type { LedgerInput } from "@/core/ledger";
import type { Mandate } from "@/core/mandate";
import type { Dock, DockRepository, Order, PurchaseRequest } from "@/core/orders";
import { backfill, type BackfillReport, type BackfillSources } from "../history/backfill";
import { MariaStore } from "../history/maria-store";
import { MemoryStore } from "../history/memory-store";
import { PgStore, historySchema } from "../history/pg-store";
import { BACKEND_LABEL, type Backend, type HistoryStore } from "../history/store";
import type { Suspension } from "../ops/suspensions";
import { radarStore } from "../radar/store";
import { connectMaria, type Maria } from "./client";
import { mariaUrl } from "./config";
import { HistoryMirror } from "./mirror";
import type { GateSources } from "./rows";
import { decisionDoc, indexDecisions, openAiEmbedder, type TextEmbedder } from "./vector";

/**
 * Wiring the time machine into a running app. Always on, with the best history store this deployment has:
 *
 *   1. MariaDB, when DOCK_MARIADB_URL is set: system-versioned tables (and "decisions like this one" by vector)
 *   2. PostgreSQL, when the site's own database is on (the Aiven PostgreSQL the store and telemetry use): a schema of
 *      its own (DOCK_HISTORY_SCHEMA, default `<app schema>_history`), versions as tstzranges; built from the ledger
 *      once on its first start (history/backfill.ts)
 *   3. this server's memory otherwise (a laptop, a preview with the hosted services blank): built from the ledger at
 *      start, then mirrored as it runs
 *
 * It taps what the app already has, after the fact, and only to say "something may have changed":
 *   - the Dock's ledger (every order, decision, sign-off, refusal and suspension is a ledger entry),
 *   - the kitchen store (stated rules, remembered habits),
 *   - the mandate check (`authenticate`), which is where a reissued mandate is first seen,
 *   - the event bus (sign-offs, expiries).
 * The mirror then reads the state through the same stores and writes what differs. A tap never awaits the store,
 * never throws into the caller, and the original call's result is returned untouched.
 */
export type TimeMachineHandle = {
  backend: Backend;
  /** "History kept in Aiven PostgreSQL" and the like, for the page. */
  label: string;
  store: HistoryStore;
  mirror: HistoryMirror;
  display: string;
  /** MariaDB only: the connection, for "decisions like this one" (vector.ts). */
  db?: Maria;
  embedder?: TextEmbedder;
  /** The history built from the ledger (PostgreSQL and memory): running, done (with what it did) or failed. */
  backfill: { state: "running" | "done" | "failed" | "not_needed"; report?: BackfillReport; error?: string };
};

// On globalThis, like the runtime itself: every route bundle must see the one mirror of the one Dock.
const g = globalThis as typeof globalThis & { __dockTimeMachines?: WeakMap<Dock, TimeMachineHandle> };
const handles = (g.__dockTimeMachines ??= new WeakMap<Dock, TimeMachineHandle>());

/** The time machine attached to this runtime's Dock, if any. */
export function timeMachineOf(dock: Dock): TimeMachineHandle | undefined {
  return handles.get(dock);
}

export const APP_WRITER = "app";

export function attachTimeMachine(
  rt: { dock: Dock; kitchens: KitchenRepository; events: EventBus; aiven?: { pool?: Pool; schema?: string } },
  stores: { repo: DockRepository; intakes: IntakeRepository },
  env: NodeJS.ProcessEnv = process.env,
): TimeMachineHandle | undefined {
  if (handles.has(rt.dock)) return handles.get(rt.dock);
  if (env.NEXT_PHASE === "phase-production-build") return undefined; // never connect while the site is being built
  if (env.VITEST) return undefined; // tests build their own stores (history/*.test.ts, mariadb.live.test.ts)
  const url = mariaUrl(env);
  const db = url ? connectMaria(url, { connections: 3 }) : undefined;
  const pool = rt.aiven?.pool;
  const store: HistoryStore = db ? new MariaStore(db) : pool && rt.aiven?.schema ? new PgStore(pool, historySchema(rt.aiven.schema, env), `dock-pg, schema ${historySchema(rt.aiven.schema, env)}`) : new MemoryStore();
  const { dock } = rt;
  const presented = new Map<string, { mandate: Mandate; at: number }>();
  const see = (m: Mandate, at: number) => {
    const prev = presented.get(m.agentId);
    if (!prev || prev.at <= at) presented.set(m.agentId, { mandate: m, at });
  };

  const gather = async () => {
    const orders: Order[] = await stores.repo.listOrders();
    const requests = new Map<string, PurchaseRequest>();
    const unverified = new Map<string, { code: string; message: string; by: string }[]>();
    for (const o of orders) {
      const r = await stores.repo.getRequest(o.requestId);
      if (r) requests.set(r.requestId, r);
      const u = (await stores.intakes.get(o.requestId))?.unverified;
      if (u?.length) unverified.set(o.requestId, u.map(({ code, message, by }) => ({ code, message, by })));
    }
    const orgIds = new Set([...(rt.kitchens.listOrgIds ? await rt.kitchens.listOrgIds() : []), ...orders.map((o) => o.orgId)]);
    const kitchens = (await Promise.all([...orgIds].map((id) => rt.kitchens.getProfile(id)))).filter((p): p is KitchenProfile => !!p);
    return { orders, requests, unverified, kitchens, holds: structuredClone(radarStore(dock).state.holds) };
  };

  const read = async (): Promise<GateSources> => {
    const now = new Date();
    const { orders, requests, unverified, kitchens, holds } = await gather();
    for (const o of orders) see(o.mandate, Date.parse(o.createdAt));
    const mandates = [...presented.values()].map((x) => x.mandate).filter((m) => Date.parse(m.validUntil) > now.getTime());
    return { now, mandates, orders, requests, unverified, kitchens, holds, suspensions: suspensionsFromLedger(dock.ledger.readonly()) /* SWITCH POINT, see below */ };
  };

  const embedder = db ? openAiEmbedder(env.OPENAI_API_KEY?.trim()) : undefined;
  let indexedSeq = -1;
  const afterSync =
    db && embedder
      ? async () => {
          const fresh = dock.ledger.since(indexedSeq).filter((e) => e.type === "decision");
          if (!fresh.length) return;
          const owners = new Map<string, { orgId: string; agentId: string; door?: string }>();
          for (const o of await stores.repo.listOrders()) owners.set(o.orderId, { orgId: o.orgId, agentId: o.agentId, door: (await stores.repo.getRequest(o.requestId))?.door });
          const docs = fresh.map((e) => decisionDoc(e, (id) => owners.get(id))).filter((d): d is NonNullable<typeof d> => !!d);
          await indexDecisions(db, APP_WRITER, docs.slice(0, 200), embedder);
          indexedSeq = Math.max(indexedSeq, ...fresh.slice(0, 200).map((e) => e.seq));
        }
      : undefined;

  const mirror = new HistoryMirror({ store, writer: APP_WRITER, read, afterSync });
  // The live mirror starts once the past is written: a change seen meanwhile is picked up by its first sync.
  let live = false;
  const poke = () => {
    if (live) mirror.poke();
  };

  // ---- taps ----
  const ledger = dock.ledger;
  const append = ledger.append.bind(ledger);
  ledger.append = (input: LedgerInput) => {
    const e = append(input);
    poke();
    return e;
  };
  const save = rt.kitchens.saveProfile.bind(rt.kitchens);
  rt.kitchens.saveProfile = async (p: KitchenProfile) => {
    await save(p);
    poke();
  };
  const authenticate = dock.authenticate;
  dock.authenticate = async (token, agentId) => {
    const s = await authenticate(token, agentId);
    try {
      see(s.mandate, Date.now());
      poke();
    } catch {
      // the tap never fails a call
    }
    return s;
  };
  rt.events.subscribe(
    () => true,
    () => poke(),
  );

  const handle: TimeMachineHandle = { backend: store.backend, label: BACKEND_LABEL[store.backend], store, mirror, display: store.display, ...(db ? { db } : {}), ...(embedder ? { embedder } : {}), backfill: { state: store.backend === "mariadb" ? "not_needed" : "running" } };
  handles.set(dock, handle);
  const start = () => {
    live = true;
    mirror.start();
  };
  if (store.backend === "mariadb") start();
  else {
    void (async () => {
      try {
        const g0 = await gather();
        const src: BackfillSources = { ledger: dock.ledger.readonly(), ...g0 };
        const report = await backfill(store, APP_WRITER, src);
        handle.backfill = { state: "done", report };
        if (report.ran) console.log(`[time machine] history built from the ledger in ${store.backend}: ${report.moments} moments, ${report.writes} writes, ${report.ms} ms`);
      } catch (err) {
        handle.backfill = { state: "failed", error: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
        console.error("[time machine] building the history from the ledger failed:", err);
      } finally {
        start();
      }
    })();
  }
  return handle;
}

/**
 * SWITCH POINT (suspensions): read from the ledger until claude/review-core lands, which persists suspensions and
 * enforces admission inside the core's `authenticate`. Then replace `suspensionsFromLedger(dock.ledger.readonly())` in
 * `read()` above with the persisted store's list; rows.ts `suspensionRow` takes the same Suspension shape.
 *
 * Suspensions as the ledger records them (every suspend and resume is a "control" entry, server/ops/suspensions.ts).
 * Read from the ledger rather than the registry object: the ledger is the one shared record, whichever route bundle
 * made the change.
 */
export function suspensionsFromLedger(entries: readonly { type: string; at: string; data: Record<string, unknown> }[]): Suspension[] {
  const byId = new Map<string, Suspension>();
  for (const e of entries) {
    if (e.type !== "control") continue;
    const d = e.data as Record<string, string | number | undefined>;
    const id = String(d.suspensionId ?? "");
    if (!id) continue;
    if (d.action === "suspend")
      byId.set(id, { suspensionId: id, scope: d.scope === "org" ? "org" : "agent", target: String(d.target), label: String(d.label ?? d.target), reason: String(d.reason ?? ""), by: String(d.by ?? "operations"), at: e.at, refusals: 0 });
    else if (d.action === "resume") {
      const s = byId.get(id);
      if (s) Object.assign(s, { resumedAt: e.at, resumedBy: String(d.by ?? "operations"), resumeNote: d.note ? String(d.note) : undefined });
    }
  }
  return [...byId.values()];
}
