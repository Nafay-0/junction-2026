import { DockError } from "@/core/errors";
import { reissueKitchenMandate } from "@/server/mandate-reissue";
import { getRuntime } from "@/server/runtime";
import { body, kitchenMemoryRoute, MemoryAction } from "@/server/memory/http";

/**
 * GET  /ui-api/memory/kitchens/{kitchen}
 *   Everything this kitchen's agent remembers: items (with strength, provenance, audience), questions waiting
 *   for an answer, superseded items, staff proposals, when the wholesaler's staff read it, and what was forgotten.
 *
 * POST /ui-api/memory/kitchens/{kitchen}   one change, only by the kitchen's own signed-in person (a visitor's phone;
 * for a built-in demo kitchen the presenter enrolled as its approver), else 401 kitchen_person_required:
 *   { action: "confirm", itemId, answer: "yes" | "no" }        answer "should I remember this?" / "keep this rule?"
 *   { action: "correct", itemId, text?, fact?, family?, strength?, site? }
 *   { action: "forget", itemId }                               removes it and what derives from it
 *   { action: "audience", itemId, audience: "shared" | "private" }
 *   { action: "state", fact, family?, text?, strength?, site? } say something to remember
 *   { action: "note", text }                                   a free-form note to keep (private by default)
 *   { action: "proposal", proposalId, accept }                 decide on a wholesaler staff proposal
 *   { action: "mandate", itemId, decision: "added" | "declined" }
 */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/memory/kitchens/[kitchen]">) {
  void req.url;
  return kitchenMemoryRoute(req, ctx.params, (k, memory) => memory.view(k.info.orgId, k.info.name));
}

export async function POST(req: Request, ctx: RouteContext<"/ui-api/memory/kitchens/[kitchen]">) {
  return kitchenMemoryRoute(req, ctx.params, async (k, memory) => {
    const a = await body(req, MemoryAction);
    const org = k.info.orgId;
    const by = k.info.by;
    switch (a.action) {
      case "confirm":
        return memory.confirm(org, a.itemId, a.answer === "yes", by);
      case "correct":
        return memory.correct(org, a.itemId, { text: a.text, fact: a.fact, family: a.family, strength: a.strength, site: a.site }, by);
      case "forget":
        return memory.forget(org, a.itemId, by);
      case "audience":
        return memory.setAudience(org, a.itemId, a.audience, by);
      case "state":
        return { report: await memory.state(org, { fact: a.fact, family: a.family, text: a.text, strength: a.strength, site: a.site, by }), memory: await memory.view(org, k.info.name) };
      case "note":
        return { report: await memory.state(org, { fact: { kind: "note", text: a.text }, by }), memory: await memory.view(org, k.info.name) };
      case "proposal":
        return memory.decideProposal(org, a.proposalId, a.accept, by);
      case "mandate": {
        if (a.decision === "declined") return memory.decideMandate(org, a.itemId, "declined", by);
        // "Add to signed mandate" is true or it is nothing: the kitchen's mandate is signed again with the rule, its
        // earlier mandates stop working at the gate, and only then is the rule recorded as added.
        const offer = (await memory.mandateOffers(org, k.info.mandate)).find((o) => o.itemId === a.itemId);
        if (!offer) throw new DockError(409, "rule_not_offered", "This rule is already in the kitchen's mandate, or the mandate cannot state it: it stays a preference the intake uses.");
        const reissued = await reissueKitchenMandate(await getRuntime(), k.info, offer.patch, by);
        return memory.decideMandate(org, a.itemId, "added", by, reissued);
      }
    }
  }, { change: "Changing what this kitchen remembers" });
}
