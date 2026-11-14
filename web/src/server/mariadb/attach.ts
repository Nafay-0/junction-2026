import type { EventBus } from "@/core/events";
import type { IntakeRepository } from "@/core/intake";
import type { KitchenProfile, KitchenRepository } from "@/core/kitchen";
import type { LedgerInput } from "@/core/ledger";
import type { Mandate } from "@/core/mandate";
import type { Dock, DockRepository, Order, PurchaseRequest } from "@/core/orders";
import type { Suspension } from "../ops/suspensions";
import { radarStore } from "../radar/store";
import { connectMaria, type Maria } from "./client";
import { mariaUrl } from "./config";
import { MariaMirror } from "./mirror";
import type { GateSources } from "./rows";
import { decisionDoc, indexDecisions, openAiEmbedder, type TextEmbedder } from "./vector";

/**
 * Wiring the time machine into a running app, when DOCK_MARIADB_URL is set; nothing at all happens otherwise.
 *
 * It taps what the app already has, after the fact, and only to say "something may have changed":
 *   - the Dock's ledger (every order, decision, sign-off, refusal and suspension is a ledger entry),
 *   - the kitchen store (stated rules, remembered habits),
 *   - the mandate check (`authenticate`), which is where a reissued mandate is first seen,
 *   - the event bus (sign-offs, expiries).
 * The mirror then reads the state through the same stores and writes what differs. A tap never awaits MariaDB,
 * never throws into the caller, and the original call's result is returned untouched.
 */
export type TimeMachineHandle = { db: Maria; mirror: MariaMirror; embedder?: TextEmbedder; display: string };

// On globalThis, like the runtime itself: every route bundle must see the one mirror of the one Dock.
const g = globalThis as typeof globalThis & { __dockTimeMachines?: WeakMap<Dock, TimeMachineHandle> };
const handles = (g.__dockTimeMachines ??= new WeakMap<Dock, TimeMachineHandle>());

/** The time machine attached to this runtime's Dock, if any. */
export function timeMachineOf(dock: Dock): TimeMachineHandle | undefined {
  return handles.get(dock);
}

export const APP_WRITER = "app";

export function attachTimeMachine(
  rt: { dock: Dock; kitchens: KitchenRepository; events: EventBus },
  stores: { repo: DockRepository; intakes: IntakeRepository },
  env: NodeJS.ProcessEnv = process.env,
): TimeMachineHandle | undefined {
  const url = mariaUrl(env);
  if (!url || handles.has(rt.dock)) return handles.get(rt.dock);
  if (env.NEXT_PHASE === "phase-production-build") return undefined; // never connect while the site is being built
  if (env.VITEST) return undefined; // the live tests use their own throwaway database (mariadb.live.test.ts)
  const db = connectMaria(url, { connections: 3 });
  const { dock } = rt;
  const presented = new Map<string, { mandate: Mandate; at: number }>();
  const see = (m: Mandate, at: number) => {
    const prev = presented.get(m.agentId);
    if (!prev || prev.at <= at) presented.set(m.agentId, { mandate: m, at });
  };

  const read = async (): Promise<GateSources> => {
    const now = new Date();
    const orders: Order[] = await stores.repo.listOrders();
    for (const o of orders) see(o.mandate, Date.parse(o.createdAt));
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
    const mandates = [...presented.values()].map((x) => x.mandate).filter((m) => Date.parse(m.validUntil) > now.getTime());
    return { now, mandates, orders, requests, unverified, kitchens, holds: structuredClone(radarStore(dock).state.holds), suspensions: suspensionsFromLedger(dock.ledger.entries()) };
  };

  const embedder = openAiEmbedder(env.OPENAI_API_KEY?.trim());
  let indexedSeq = -1;
  const afterSync = embedder
    ? async () => {
        const fresh = dock.ledger.entries().filter((e) => e.seq > indexedSeq && e.type === "decision");
        if (!fresh.length) return;
        const owners = new Map((await stores.repo.listOrders()).map((o) => [o.orderId, { orgId: o.orgId, agentId: o.agentId }]));
        const docs = fresh.map((e) => decisionDoc(e, (id) => owners.get(id))).filter((d): d is NonNullable<typeof d> => !!d);
        await indexDecisions(db, APP_WRITER, docs.slice(0, 200), embedder);
        indexedSeq = Math.max(indexedSeq, ...fresh.slice(0, 200).map((e) => e.seq));
      }
    : undefined;

  const mirror = new MariaMirror({ db, writer: APP_WRITER, read, afterSync });

  // ---- taps ----
  const ledger = dock.ledger;
  const append = ledger.append.bind(ledger);
  ledger.append = (input: LedgerInput) => {
    const e = append(input);
    mirror.poke();
    return e;
  };
  const save = rt.kitchens.saveProfile.bind(rt.kitchens);
  rt.kitchens.saveProfile = async (p: KitchenProfile) => {
    await save(p);
    mirror.poke();
  };
  const authenticate = dock.authenticate;
  dock.authenticate = async (token, agentId) => {
    const s = await authenticate(token, agentId);
    try {
      see(s.mandate, Date.now());
      mirror.poke();
    } catch {
      // the tap never fails a call
    }
    return s;
  };
  rt.events.subscribe(
    () => true,
    () => mirror.poke(),
  );

  const handle: TimeMachineHandle = { db, mirror: mirror.start(), embedder, display: db.config.display };
  handles.set(dock, handle);
  return handle;
}

/**
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
