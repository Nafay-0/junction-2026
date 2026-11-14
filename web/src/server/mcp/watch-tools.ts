import { z } from "zod";
import { tool, type ToolContext } from "./tools";

/** Loaded on first call: the watch service reaches the runtime, which must not load while this table is defined. */
const svc = async () => ({ ...(await import("../watch/service")), getRuntime: (await import("../runtime")).getRuntime });

/**
 * The kitchen agent's watch as MCP tools (the same operations as REST /api/v1/watch): what cannot come for the day
 * it is needed and the ranked substitutes, the learned recurring orders and their drift, renewals placed or held,
 * and the kitchen's answers. Kept apart from the ordering table (tools.ts TOOLS), like the offer tools: that table is
 * bound to the crash-test licences, and the kitchen's own agent uses the watch through server/watch/thread.ts.
 * For more substitutes, or the gate's preview of one, use find_alternatives; to take an order back, withdraw_order.
 */

const nextStep = z.string().describe("What to do next.");
const by = z.string().min(1).max(120).describe("Who answered. Do not invent one.");
const who = (ctx: ToolContext, given?: string) => given ?? ctx.defaultBy ?? `${ctx.session.mandate.issuer.name}'s buying agent (relayed)`;
const via = (ctx: ToolContext) => ctx.session.door ?? "mcp";

export const WATCH_TOOLS = [
  tool({
    name: "watch_orders",
    title: "What may not arrive, and how recurring orders drift",
    description:
      "Watch over recurring and undelivered orders. findings: a product that cannot come for its day, good/better/best substitutes with trade-offs (insidePreferences: no sign-off needed) and a signed availability claim. standing: learned weekly patterns, drift, auto-renew. renewals: placed or held.",
    input: z.object({ fresh: z.boolean().optional().describe("Check live now (one call).") }),
    output: z.looseObject({ findings: z.array(z.looseObject({})), renewals: z.array(z.looseObject({})), nextStep }),
    readOnly: true,
    run: async (ctx, { fresh }) => {
      const { getRuntime, watchForOrg, watchNowFor } = await svc();
      const rt = await getRuntime();
      if (fresh) await watchNowFor(rt, ctx.session, { fresh: true });
      const w = await watchForOrg(rt, ctx.session.mandate.issuer.orgId);
      const open = w.findings.filter((f) => f.state === "open");
      const held = w.renewals.filter((r) => r.state === "held");
      return {
        findings: w.findings,
        renewals: w.renewals,
        standing: w.standing,
        staged: w.stagedNow,
        keysUrl: "/.well-known/jwks.json",
        nextStep: open.length || held.length ? "Tell the buyer in one or two sentences (what, the day, the closest substitute and its trade-off; or the drift with its figures) and pass their answer with answer_watch." : "Nothing needs the buyer.",
      };
    },
  }),
  tool({
    name: "answer_watch",
    title: "Answer a watch finding or a held renewal",
    description:
      "The buyer's own answer. findingId: switch (best, or productId) or keep. renewalId: renew_new, usual or skip. A switch or renewal is an ordinary order through the gate; beyond the mandate it waits for sign-off.",
    input: z.object({ findingId: z.string().optional(), renewalId: z.string().optional(), choice: z.enum(["switch", "keep", "renew_new", "usual", "skip"]), productId: z.string().optional(), by }),
    output: z.looseObject({ state: z.string(), nextStep }),
    run: async (ctx, a) => {
      const { getRuntime, answerFinding, answerRenewal } = await svc();
      const { DockError } = await import("@/core/errors");
      const rt = await getRuntime();
      const w = { by: who(ctx, a.by), via: via(ctx) };
      let r: { order?: unknown; refused?: unknown; state: string };
      if (a.findingId && (a.choice === "switch" || a.choice === "keep")) {
        const x = await answerFinding(rt, ctx.session, a.findingId, { choice: a.choice, ...(a.productId ? { productId: a.productId } : {}) }, w);
        r = { order: x.order, refused: x.refused, state: x.finding.state };
      } else if (a.renewalId && (a.choice === "renew_new" || a.choice === "usual" || a.choice === "skip")) {
        const x = await answerRenewal(rt, ctx.session, a.renewalId, a.choice, w);
        r = { order: x.order, refused: x.refused, state: x.renewal.state };
      } else throw new DockError(400, "invalid_request", "Pass findingId with switch or keep, or renewalId with renew_new, usual or skip.");
      const status = (r.order as { status?: string } | undefined)?.status;
      return { ...(r.order ? { order: r.order as Record<string, unknown> } : {}), ...(r.refused ? { refused: r.refused as Record<string, unknown> } : {}), state: r.state, nextStep: status === "pending_approval" ? "It waits for the person the mandate names, on their phone: tell the buyer who, then get_order with waitSeconds." : status === "committed" ? "Committed. Tell the buyer in one sentence." : "Done." };
    },
  }),
  tool({
    name: "set_auto_renew",
    title: "Switch auto-renew for a recurring order",
    description: "The kitchen's explicit choice, recorded with who (off by default). On: placed before the cut-off when nothing drifted, through the gate; held and asked when something did. family: from watch_orders standing.",
    input: z.object({ family: z.string().min(1).max(60), on: z.boolean(), by }),
    output: z.looseObject({ nextStep }),
    run: async (ctx, a) => {
      const { getRuntime, setAutoRenew } = await svc();
      const rt = await getRuntime();
      const r = await setAutoRenew(rt, ctx.session, { family: a.family, on: a.on, by: who(ctx, a.by), via: via(ctx) });
      return { autoRenew: r, nextStep: "Done." };
    },
  }),
];
