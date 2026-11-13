import type { LedgerEntry } from "@/core/ledger";
import { SEED_PRODUCTS } from "@/core/seed";
import { amount, eur, humanize, roleLabel, ruleTitle } from "@/app/_ui/plain";
import { KITCHEN_ORG } from "./demo-kitchen";
import { DEMO_ORG } from "./dev-fixtures";
import type { Runtime } from "./runtime";

/**
 * What the wall shows, read from the ledger, the orders and the catalogue meter of this server.
 * The public v1 API has no cross-kitchen activity view (and should not hand every org's orders to anyone),
 * so the wall reads the runtime directly and sends only plain sentences and counts.
 */
export type FeedItem = {
  key: string;
  kitchen: string;
  what: string;
  /** 1 asked, 2 checked and priced, 3 price fixed, 4 at the gate, 5 signed (or a final refusal/decline). */
  reached: number;
  status: string;
  tone: "plain" | "safety" | "done";
  totalCents?: number;
  at: string;
};

export type RefusalItem = { key: string; kitchen: string; rule: string; reason: string; at: string };

export type WallSnapshot = {
  at: string;
  counters: { orders: number; agentAlone: number; humanSignedOff: number; refused: number; liveCalls: number; waiting: number };
  chain: { ok: boolean; length: number };
  feed: FeedItem[];
  refusals: RefusalItem[];
  kitchens: { slug: string; name: string; approverName: string }[];
  lastActivityAt?: string;
};

const PRODUCT_NAMES = Object.fromEntries(SEED_PRODUCTS.map((p) => [p.id, p.name]));
const say = (t: string) => humanize(t, PRODUCT_NAMES);

export async function wallSnapshot(rt: Runtime): Promise<WallSnapshot> {
  const { dock, sandboxes } = rt;
  const entries = dock.ledger.entries();
  const orders = await dock.listOrders();
  const kitchens = await sandboxes.list();
  const chain = dock.ledger.verify();

  const agentOrg = new Map<string, string>([
    [KITCHEN_ORG.agentId, KITCHEN_ORG.name],
    [DEMO_ORG.agentId, DEMO_ORG.name],
    ...kitchens.map((k) => [k.agentId, `${k.kitchenName}, ${k.city}`] as [string, string]),
  ]);
  const orgOfRequest = new Map<string, string>();
  for (const o of orders) orgOfRequest.set(o.requestId, o.orgName);

  const byRequest = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    if (!e.requestId) continue;
    const list = byRequest.get(e.requestId) ?? [];
    list.push(e);
    byRequest.set(e.requestId, list);
  }

  const kitchenOf = (requestId: string | undefined, actor: string): string => {
    if (requestId && orgOfRequest.has(requestId)) return orgOfRequest.get(requestId)!;
    if (requestId) {
      const req = byRequest.get(requestId)?.find((e) => e.type === "request");
      const m = req && / of (.+?) opened a request/.exec(req.summary);
      if (m) return m[1];
    }
    return agentOrg.get(actor.replace(/^agent:/, "")) ?? "An unknown agent";
  };

  const feed: FeedItem[] = [];
  for (const [requestId, list] of byRequest) {
    const first = list.find((e) => e.type === "request");
    if (!first) continue;
    feed.push({ key: requestId, kitchen: kitchenOf(requestId, first.actor), ...progress(list), at: list.at(-1)!.at });
  }
  feed.sort((a, b) => b.at.localeCompare(a.at));

  const refusals: RefusalItem[] = [];
  for (const e of entries) {
    if (e.type === "refusal") {
      const rule = typeof e.data.rule === "string" ? e.data.rule : undefined;
      refusals.push({ key: `r${e.seq}`, kitchen: kitchenOf(e.requestId, e.actor), rule: ruleTitle(rule), reason: say(e.summary.replace(/^Refused: /, "")), at: e.at });
    } else if (e.type === "decision" && e.data.outcome === "reject") {
      const rules = (e.data.rules as { rule: string; outcome: string }[] | undefined) ?? [];
      const failed = rules.find((r) => r.outcome === "fail");
      const reasons = (e.data.reasons as string[] | undefined) ?? [];
      refusals.push({ key: `r${e.seq}`, kitchen: kitchenOf(e.requestId, e.actor), rule: ruleTitle(failed?.rule), reason: say(reasons[0] ?? e.summary), at: e.at });
    }
  }
  refusals.sort((a, b) => b.at.localeCompare(a.at));

  const committed = orders.filter((o) => o.status === "committed");
  return {
    at: new Date().toISOString(),
    counters: {
      orders: committed.length,
      agentAlone: committed.filter((o) => !o.approval).length,
      humanSignedOff: committed.filter((o) => o.approval?.status === "approved").length,
      refused: refusals.length,
      liveCalls: dock.stats().liveCalls,
      waiting: orders.filter((o) => o.status === "pending_approval").length,
    },
    chain: { ok: chain.ok, length: entries.length },
    feed: feed.slice(0, 8),
    refusals: refusals.slice(0, 4),
    kitchens: kitchens
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((k) => ({ slug: k.sandboxId, name: `${k.kitchenName}, ${k.city}`, approverName: k.approverName })),
    lastActivityAt: entries.at(-1)?.at,
  };
}

/** Where one request is, in a few words. Reads its ledger entries in order; the last word wins. */
function progress(list: LedgerEntry[]): Pick<FeedItem, "what" | "reached" | "status" | "tone" | "totalCents"> {
  const request = list.find((e) => e.type === "request")!;
  let what = String(request.data.text ?? "").trim();
  let reached = 1;
  let status = "Reading the request";
  let tone: FeedItem["tone"] = "plain";
  let totalCents: number | undefined;

  for (const e of list) {
    const d = e.data;
    if (e.type === "intake") {
      const step = d.step;
      if (step === "need") {
        const need = d.need as { item?: { text?: string }; quantity?: { amount: number; unit: string }; sameAsLastTime?: boolean } | undefined;
        if (need?.item?.text) what = need.quantity ? `${amount(need.quantity.amount, need.quantity.unit)} ${need.item.text}` : `${need.item.text}, same as last time`;
        status = "Reading the request";
      } else if (step === "concerns") [reached, status] = [2, "Checking a possible mistake"];
      else if (step === "questions") [reached, status] = [2, "Asking the kitchen one question"];
      else if (step === "confirmation" || step === "correction") [reached, status] = [2, "Kitchen corrected the request"];
      else if (step === "options") [reached, status] = [2, `Comparing ${(d.options as unknown[] | undefined)?.length ?? "the"} options`];
      else if (step === "no_options") [reached, status, tone] = [2, "Nothing fits the rules", "plain"];
      else if (step === "cancelled") [reached, status, tone] = [2, "Cancelled by the kitchen", "plain"];
      else if (step === "choice") [reached, status] = [2, "Option chosen"];
    } else if (e.type === "lookup" && d.source === "live") [reached, status] = [Math.max(reached, 2), "Checking live prices"];
    else if (e.type === "quote") {
      totalCents = d.totalCents as number;
      [reached, status] = [3, `Price fixed at ${eur(totalCents)}`];
    } else if (e.type === "decision") {
      totalCents = d.totalCents as number;
      const approver = d.approver as { name: string; role: string } | undefined;
      if (d.outcome === "auto_approve") [reached, status, tone] = [4, "Within the agent's mandate", "plain"];
      else if (d.outcome === "needs_human_approval") [reached, status, tone] = [4, `Waiting for ${approver?.name ?? "a person"}${approver ? `, ${roleLabel(approver.role)}` : ""}`, "safety"];
      else {
        const failed = (d.rules as { rule: string; outcome: string }[] | undefined)?.find((r) => r.outcome === "fail");
        [reached, status, tone] = [4, `Refused: ${ruleTitle(failed?.rule).toLowerCase()}`, "safety"];
      }
    } else if (e.type === "approval") {
      const name = /^(.+?) \(/.exec(e.summary)?.[1] ?? "The approver";
      if (d.decision === "approved") [reached, status, tone] = [4, `Signed off by ${name}`, "safety"];
      else [reached, status, tone] = [5, `Declined by ${name}`, "safety"];
    } else if (e.type === "order") {
      const by = d.authorisedBy as { kind: string; name?: string } | undefined;
      [reached, status, tone] = [5, by?.kind === "approver" ? `Signed order, approved by ${by.name}` : "Signed order, agent alone", "done"];
    } else if (e.type === "refusal") {
      const rule = typeof d.rule === "string" ? d.rule : undefined;
      [reached, status, tone] = [Math.max(reached, 3), `Refused: ${ruleTitle(rule).toLowerCase()}`, "safety"];
    }
  }
  if (what.length > 80) what = `${what.slice(0, 77).trimEnd()}…`;
  return { what: say(what), reached, status: say(status), tone, totalCents };
}
