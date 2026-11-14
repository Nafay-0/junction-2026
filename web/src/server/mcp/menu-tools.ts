import { z } from "zod";
import { nextStepForOrder } from "./next-step";
import { tool, type ToolContext } from "./tools";

/** Loaded on first call: the planner reaches the runtime, which must not load while this table is defined. */
const svc = async () => {
  const [{ menuScenarios }, { outsideMenuKitchen }] = await Promise.all([import("../agent/menu/runtime"), import("../agent/menu/kitchens")]);
  return { menuScenarios, outsideMenuKitchen };
};

/**
 * The partner's two menu scenarios for an outside agent, as MCP tools (the same operations as REST /api/v1/menus):
 * a menu around what is in season, buying only what is missing; and a booking at short notice, with what cannot
 * arrive and substitutes by the ingredient's role. Planned under the calling agent's own mandate; nothing orders until
 * order_menu, which goes through the signed quote and the gate like any order.
 *
 * Kept apart from the ordering table (tools.ts TOOLS), like the offer tools: that table is bound to the crash-test
 * harness. For one product that is short, find_alternatives ranks what can stand in.
 */

const nextStep = z.string().describe("What to do next, in one or two sentences.");
const by = z.string().min(1).max(120).optional();
const result = z.looseObject({ planId: z.string(), requestId: z.string().nullable() });

export const SeasonalInput = z.object({
  text: z.string().min(1).max(2000).describe("The chef's words."),
  covers: z.number().int().positive().max(20_000).optional(),
  deliverBy: z.iso.date().optional().describe("Service day, YYYY-MM-DD."),
  have: z.array(z.string().min(1).max(60)).max(20).optional().describe("What the kitchen says it has."),
  by,
});
export const EventInput = z.object({
  text: z.string().min(1).max(2000).describe("The booking, in the buyer's words."),
  deliverBy: z.iso.date().optional().describe("YYYY-MM-DD; default: the day the words name."),
  by,
});
export const OrderMenuInput = z.object({
  planId: z.string().min(1),
  choices: z.array(z.object({ lineId: z.string().min(1), optionId: z.string().min(1) })).max(20).optional().describe("The buyer's pick per ingredient that cannot arrive. Left out: the best option, only where no sign-off is needed."),
  by,
});

const who = (ctx: ToolContext, given?: string) => given ?? ctx.defaultBy ?? `${ctx.session.mandate.issuer.name}'s buying agent (relayed)`;

async function kitchenOf(ctx: ToolContext) {
  const { menuScenarios, outsideMenuKitchen } = await svc();
  const { rt, scenarios } = await menuScenarios();
  const profile = await rt.kitchens.getProfile(ctx.session.mandate.issuer.orgId).catch(() => undefined);
  return { scenarios, k: outsideMenuKitchen({ ...ctx.session, door: ctx.session.door ?? "mcp" }, profile) };
}

const withDetails = (text: string, a: { covers?: number; deliverBy?: string; have?: string[] }) =>
  [text, a.covers ? `${a.covers} covers.` : "", a.deliverBy ? `Service day ${a.deliverBy}.` : "", a.have?.length ? `We have ${a.have.join(", ")}.` : ""].filter(Boolean).join(" ");

export const MENU_TOOLS = [
  tool({
    name: "plan_seasonal_menu",
    title: "Plan a menu around what is in season",
    description:
      "2-3 dishes on an ingredient in season now that the assortment has (season calendar, with source). Per ingredient: need, on hand (kitchen history or the person's words, labelled; unknown = none), what to buy (shortfall, smallest covering pack), gate preview. Buys nothing.",
    input: SeasonalInput,
    output: z.object({ result, nextStep }),
    run: async (ctx, a) => {
      const { scenarios, k } = await kitchenOf(ctx);
      const r = await scenarios.seasonal(k, withDetails(a.text, a), who(ctx, a.by));
      return { result: r, nextStep: r.lines.some((l) => l.product) ? `Tell the buyer the dishes, why the ingredient is in season, and what will be bought (and what is taken as on hand). On their yes, order_menu with planId ${r.planId}.` : "Nothing could be planned to buy. Tell the buyer why (notes, blockers)." };
    },
  }),
  tool({
    name: "plan_event_menu",
    title: "Plan a booking at short notice",
    description:
      "A booking at short notice: each ingredient checked for the day (cut-off, stock). cannotArrive: which, why, earliest day. options[lineId]: substitutes by the ingredient's role (same job at an adjusted amount, technique, another dish), verified, ranked best/better/good, with trade-off and signOff. Buys nothing.",
    input: EventInput,
    output: z.object({ result, nextStep }),
    run: async (ctx, a) => {
      const { scenarios, k } = await kitchenOf(ctx);
      const r = await scenarios.event(k, a.text, who(ctx, a.by), a.deliverBy ? { date: a.deliverBy } : {});
      return {
        result: r,
        nextStep: r.allLate
          ? `Nothing can arrive by ${r.allLate.neededBy}${r.allLate.earliest ? `; the earliest is ${r.allLate.earliest}` : ""}. Tell the buyer; plan again with another deliverBy only if they agree.`
          : r.cannotArrive.length
            ? `Tell the buyer what cannot arrive and why, and the options with their trade-offs. Pass their pick to order_menu as choices (planId ${r.planId}); a pick marked signOff.needed goes to a named person.`
            : `Everything can arrive. On the buyer's yes, order_menu with planId ${r.planId}.`,
      };
    },
  }),
  tool({
    name: "order_menu",
    title: "Order a planned menu",
    description: "One signed quote for the plan's lines, placed through the gate: committed, or pending_approval for a named person. Substitutes are declared. Only on the buyer's yes.",
    input: OrderMenuInput,
    output: z.looseObject({ sheet: z.looseObject({}), order: z.looseObject({ orderId: z.string(), status: z.string() }), nextStep }),
    run: async (ctx, a) => {
      const { scenarios, k } = await kitchenOf(ctx);
      const sheet = await scenarios.sheetOf(k, a.planId, a.choices ?? "best", { by: who(ctx, a.by), agentAlone: true });
      const placed = await scenarios.order(k, a.planId, sheet);
      return { sheet, quote: placed.quote, order: placed.order, nextStep: nextStepForOrder(placed.order) };
    },
  }),
];
