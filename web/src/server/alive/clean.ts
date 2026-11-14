import type { AgentSession } from "@/core/orders";
import type { Runtime } from "@/server/runtime";
import { isSampleId, isSampleOrder, isSampleThread } from "./marks";

/**
 * Clearing what an earlier sample left in kitchens people sign into (the demo kitchens Kaari and Laakso, and the shared
 * test kitchens): the sample that played through the live conversation, before the sample kept to its own kitchens.
 * Only records the sample marked as its own are touched, each through the engine's own action, by staff, recorded:
 *
 *   orders     a sample order still waiting for a person is taken back
 *   staged     a stock-out or drift the sample staged is lifted
 *   auto-renew switched on by the sample: switched off again
 *   offers     a sample offer still open is declined; a mute the sample set on a sample offer is lifted
 *   memory     the sample's orders leave the kitchen's order history (the profile, not the ledger), so its usual
 *              amounts are its own again
 *   thread     a conversation that holds sample turns is started over (the old one stays in the ledger and the trace)
 *
 * The ledger itself is append-only and hash-chained: the sample's entries stay, marked as sample, hidden by "Hide the
 * sample", and listed nowhere as waiting.
 */
export const SIGNABLE = ["kaari", "laakso", "hotel-lumo", "koulu-metsola", "kahvila-sointu"] as const;

type Kitchen = { slug: string; orgId: string; session: AgentSession };

async function kitchens(rt: Runtime): Promise<Kitchen[]> {
  const { resolveKitchen } = await import("@/server/console-kitchens");
  const out: Kitchen[] = [];
  for (const slug of SIGNABLE) {
    const k = await resolveKitchen(slug).catch(() => undefined);
    if (!k) continue;
    const session = await rt.dock.authenticate(k.mandateToken, k.agentId, { via: "onsite", transport: "direct", path: "/ops-api/sample", method: "POST" } as never);
    out.push({ slug, orgId: k.info.orgId, session });
  }
  return out;
}

export type CleanReport = { kitchen: string; done: string[] }[];

export async function cleanSample(rt: Runtime, by: string): Promise<CleanReport> {
  const ledger = rt.dock.ledger;
  const who = { by: `${by} (clearing the earlier sample)`, via: "the operations portal" };
  const w = await import("@/server/watch/service");
  const offers = await import("@/server/offers/service");
  const { threadStore } = await import("@/server/thread/engine");
  const store = await threadStore();
  const report: CleanReport = [];
  for (const k of await kitchens(rt)) {
    const done: string[] = [];
    for (const o of await rt.dock.pendingOrders(k.orgId)) {
      if (!isSampleOrder(ledger, o)) continue;
      const back = await rt.dock.withdrawOrder(k.session, o.orderId, { reason: "An order of the earlier sample activity: taken back so nothing of it waits in this kitchen.", by: who.by }).catch((err: Error) => err);
      done.push(back instanceof Error ? `could not take back ${o.orderId}: ${back.message}` : `took back ${o.orderId}`);
    }
    const view = await w.watchView(rt);
    for (const g of view.stages.filter((x) => x.orgId === k.orgId && !x.liftedAt && isSampleId(ledger, x.stageId))) {
      await w.liftStage(rt, g.stageId, who.by);
      done.push(`lifted staged ${g.kind} ${g.stageId}`);
    }
    for (const a of view.auto.filter((x) => x.orgId === k.orgId && x.on && /\(sample\)|sample activity/i.test(`${x.by} ${x.via}`))) {
      await w.setAutoRenew(rt, k.session, { family: a.family, on: false, by: who.by, via: who.via });
      done.push(`auto-renew off for ${a.family}`);
    }
    for (const o of await offers.offersForOrg(rt, k.orgId, { open: true })) {
      if (!isSampleId(ledger, o.offerId)) continue;
      await offers.declineOffer(rt, k.session, o.offerId, who).catch(() => undefined);
      done.push(`declined open offer ${o.offerId}`);
    }
    for (const m of (await offers.prefsOf(rt, k.orgId)).mutes) {
      if (!m.offerId || !isSampleId(ledger, m.offerId)) continue;
      await offers.unmuteOffers(rt, k.session, { scope: m.scope, value: m.value }, who).catch(() => undefined);
      done.push(`lifted the mute on ${m.scope} ${m.value}`);
    }
    const profile = await rt.kitchens.getProfile(k.orgId);
    if (profile) {
      const kept = profile.history.filter((h) => !isSampleOrder(ledger, { orderId: h.orderId }));
      if (kept.length !== profile.history.length) {
        await rt.kitchens.saveProfile({ ...profile, history: kept });
        done.push(`removed ${profile.history.length - kept.length} sample order(s) from the kitchen's order history`);
      }
    }
    const t = store.peek(k.slug);
    if (t && t.orgId !== k.orgId) {
      // The kitchen is a new organisation (a test account reset): its old conversation is closed for good.
      store.get(k.slug, k.orgId);
      done.push("closed the conversation of the kitchen's earlier organisation");
    } else if (t && (isSampleThread(ledger, t.threadId) || t.turns.some((x) => isSampleId(ledger, x.turnId)))) {
      store.reset(k.slug, k.orgId);
      done.push(`started the conversation over (it held sample turns)`);
    }
    if (done.length) {
      ledger.append({ type: "control", actor: `ops:${by}`, summary: `${by} cleared what the earlier sample activity left in ${k.slug}: ${done.join("; ")}.`, data: { step: "sample_cleared", kitchen: k.slug, done, by } });
    }
    report.push({ kitchen: k.slug, done });
  }
  return report;
}

export type SampleCheck = { kitchens: { kitchen: string; sampleTurnsInConversation: boolean; sampleOrdersWaiting: number }[]; waiting: number; sampleWaitingInSignable: number };

/** What a person who signs in would meet of the sample: turns in the conversation, orders waiting. And the top bar's count. */
export async function sampleCheck(rt: Runtime): Promise<SampleCheck> {
  const ledger = rt.dock.ledger;
  const { threadStore } = await import("@/server/thread/engine");
  const store = await threadStore();
  const out: SampleCheck["kitchens"] = [];
  for (const k of await kitchens(rt)) {
    const t = store.peek(k.slug);
    out.push({
      kitchen: k.slug,
      // A conversation of the kitchen's earlier organisation is not the one a person opens (a new one starts).
      sampleTurnsInConversation: !!t && t.orgId === k.orgId && (isSampleThread(ledger, t.threadId) || t.turns.some((x) => isSampleId(ledger, x.turnId))),
      sampleOrdersWaiting: (await rt.dock.pendingOrders(k.orgId)).filter((o) => isSampleOrder(ledger, o)).length,
    });
  }
  return { kitchens: out, waiting: (await rt.dock.listPendingApprovals()).length, sampleWaitingInSignable: out.reduce((s, k) => s + k.sampleOrdersWaiting, 0) };
}
