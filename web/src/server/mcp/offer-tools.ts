import { z } from "zod";
import { REASON_KINDS } from "@/core/offers";
import { getRuntime } from "../runtime";
import { acceptOffer, acceptedInto, declineOffer, muteOffers, offersForOrg, prefsOf, unmuteOffers } from "../offers/service";
import { intakeOut, intakeResult, tool, type ToolContext } from "./tools";

/**
 * The buyer's side of the wholesaler's offers, as MCP tools (the same operations as REST /api/v1/offers). An outside
 * buyer's agent lists the offers addressed to its organisation, verifies each offline against the published keys,
 * and answers: accept (which only starts an ordinary order through the intake, the gate and the sign-off), decline,
 * or mute. None of them buys anything.
 *
 * Kept apart from the ordering table (tools.ts TOOLS) on purpose: that table is part of the harness the crash-test
 * licences are bound to (src/crash/harness.ts), and the kitchen's own agent answers offers in plain code, not with
 * these tools. The MCP door publishes both tables.
 */

const nextStep = z.string().describe("What to do next, in one or two sentences.");
const offerId = z.string().min(1).describe("An offerId from list_offers.");
const by = z.string().min(1).max(120).optional().describe("The name of the person whose answer this is, if they told you. Do not invent one.");

const who = (ctx: ToolContext, given?: string) => given ?? ctx.defaultBy ?? `${ctx.session.mandate.issuer.name}'s buying agent (relayed)`;
const via = (ctx: ToolContext) => ctx.session.door ?? "mcp";

const OfferOut = z.looseObject({
  offerId: z.string(),
  status: z.enum(["offered", "accepted", "declined", "muted", "expired", "withheld"]),
  verified: z.boolean().describe("The token verified against the wholesaler's key and is addressed to this organisation."),
  token: z.string().describe("The signed offer: a W3C Verifiable Credential as a compact JWS (typ vc+jwt, type DockProductOffer), verifiable offline against /.well-known/jwks.json."),
  offer: z.looseObject({}).describe("What the token says: product, reasons with figures, line, price per pack and per litre or kilo, suggestedPacks, validUntil, isOrder: false."),
});

export const OFFER_TOOLS = [
  tool({
    name: "list_offers",
    title: "List the wholesaler's offers to this kitchen",
    description:
      "Offers the wholesaler's selling agent made to this kitchen: a new, seasonal or cheaper like-for-like product, each with its reason and figures, the price per pack and how long it holds. Each offer is signed (vc+jwt, Ed25519): verify `token` against /.well-known/jwks.json before relying on it. An offer is never an order and buys nothing. Show the buyer at most one or two, in plain words, and only those their rules allow; then pass on their answer with accept_offer, decline_offer or mute_offers. Never accept for them.",
    input: z.object({ all: z.boolean().optional().describe("true: also offers already answered or expired. Default: open offers only.") }),
    output: z.object({ offers: z.array(OfferOut), prefs: z.looseObject({}).describe("What this kitchen muted, and whether it turned offers off."), keysUrl: z.string(), nextStep }),
    readOnly: true,
    run: async (ctx, { all }) => {
      const rt = await getRuntime();
      const orgId = ctx.session.mandate.issuer.orgId;
      const offers = await offersForOrg(rt, orgId, { open: !all });
      return {
        offers,
        prefs: await prefsOf(rt, orgId),
        keysUrl: "/.well-known/jwks.json",
        nextStep: offers.length ? "Tell the buyer about an offer in one sentence (product, why, price per pack). If they want it, call accept_offer; if not, decline_offer; if they never want that kind of suggestion, mute_offers." : "No open offers. Nothing to tell the buyer.",
      };
    },
  }),
  tool({
    name: "accept_offer",
    title: "Accept an offer: start an ordinary order",
    description:
      "The buyer wants the offered product. This does not buy anything: it starts an ordinary order for it through AimoPilot's intake (the same mistake check, option cards, signed fixed-price quote, mandate gate and sign-off as submit_need). Returns the intake step; follow its nextStep exactly as after submit_need. Only on the buyer's own yes.",
    input: z.object({
      offerId,
      packs: z.number().int().positive().max(10_000).optional().describe("How many packs the buyer wants; default the offer's suggestedPacks."),
      deliverBy: z.iso.date().optional().describe("Latest delivery day, YYYY-MM-DD, if the buyer said one."),
      by,
    }),
    output: intakeOut.extend({ offerId: z.string() }),
    run: async (ctx, { offerId: id, packs, deliverBy, by: given }) => {
      const rt = await getRuntime();
      const a = { by: who(ctx, given), via: via(ctx), name: ctx.session.mandate.issuer.name };
      const { offer, record } = await acceptOffer(rt, ctx.session, id, a);
      const amount = packs ?? offer.suggestedPacks;
      const step = await ctx.dock.intake.open(ctx.session, {
        need: { text: `Accepted the wholesaler's offer ${id}: ${amount} × ${offer.product.name}`.slice(0, 2000), item: { text: offer.product.name.slice(0, 200), category: offer.product.category, productId: offer.product.productId }, quantity: { amount, unit: "pack" }, ...(deliverBy ? { deliverBy } : {}) },
        by: a.by,
      });
      acceptedInto(rt, record, a, step.requestId);
      return { offerId: id, ...intakeResult(step) };
    },
  }),
  tool({
    name: "decline_offer",
    title: "Decline an offer",
    description: "The buyer does not want this offer. The product is not offered to this kitchen again for 30 days. Only on the buyer's own answer.",
    input: z.object({ offerId, by }),
    output: z.object({ offer: z.looseObject({}), nextStep }),
    run: async (ctx, { offerId: id, by: given }) => {
      const rt = await getRuntime();
      const r = await declineOffer(rt, ctx.session, id, { by: who(ctx, given), via: via(ctx) });
      return { offer: { offerId: r.offerId, status: r.status, productId: r.productId }, nextStep: "Done. Tell the buyer in a few words, if at all." };
    },
  }),
  tool({
    name: "mute_offers",
    title: "Stop a kind of offer, or every offer",
    description: `The buyer does not want this kind of suggestion again. scope: product (this product), family (its product family, e.g. all cream), reason (this kind of reason: ${REASON_KINDS.join(", ")}) or all (no offers at all). With offerId the value is taken from that offer. undo: true lifts the mute (with all: turns offers on again). The wholesaler's selling agent reads this before it picks anything. Only on the buyer's own answer.`,
    input: z.object({
      scope: z.enum(["product", "family", "reason", "all"]),
      offerId: offerId.optional(),
      value: z.string().min(1).max(60).optional().describe("Without offerId: the productId, family or reason to mute."),
      undo: z.boolean().optional(),
      by,
    }),
    output: z.object({ prefs: z.looseObject({}), nextStep }),
    run: async (ctx, { scope, offerId: id, value, undo, by: given }) => {
      const rt = await getRuntime();
      const a = { by: who(ctx, given), via: via(ctx) };
      const prefs = undo ? await unmuteOffers(rt, ctx.session, { scope, value }, a) : await muteOffers(rt, ctx.session, { scope, ...(id ? { offerId: id } : {}), ...(value ? { value } : {}) }, a);
      return { prefs, nextStep: scope === "all" && !undo ? "Offers are off for this kitchen until it turns them on again." : "Done." };
    },
  }),
];
