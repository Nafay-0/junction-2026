import { DockError } from "@/core/errors";
import type { Mandate } from "@/core/mandate";
import { currentDemoMandate, type ConsoleKitchenInfo, type DemoSlug } from "./console-kitchens";
import type { MandatePatch } from "./mandates";
import type { Runtime } from "./runtime";

export type MandateReissued = {
  at: string;
  by: string;
  mandateId: string;
  replaced: string;
  added: Required<MandatePatch>;
  before: Pick<Mandate, "forbiddenAllergens" | "requiredAttributes">;
  after: Pick<Mandate, "forbiddenAllergens" | "requiredAttributes">;
  signedWith: "the kitchen's configured key" | "a new key of the kitchen";
};

/**
 * "Add to signed mandate", done: the kitchen's mandate is signed again with the rule in it, and every mandate the
 * kitchen signed before stops working at the gate.
 *
 *   built-in demo kitchen   signed with the kitchen's key this server is configured with; the store's agent, the
 *                           menu agent and the hosted buyer carry the rule from their next call
 *   visitor's kitchen       signed with a new key of that kitchen (its first private key was discarded after one
 *                           signature, by design); its agent, console and connector address present the new mandate
 *
 * Who may do this is decided by the caller (the memory route: the kitchen's own signed-in person only,
 * server/authz.ts requireKitchenPerson). Written to the ledger with what the mandate said before and says now.
 */
export async function reissueKitchenMandate(rt: Runtime, kitchen: Pick<ConsoleKitchenInfo, "slug" | "kind" | "orgId" | "name">, patch: MandatePatch, by: string): Promise<MandateReissued> {
  const demo = kitchen.kind === "demo";
  const before = demo ? await currentDemoMandate(kitchen.slug as DemoSlug) : await rt.sandboxes.mandateOf(kitchen.slug);
  if (!before) throw new DockError(404, "kitchen_not_found", "This kitchen does not exist or its demo time is over.");
  const { mandate, record, added } = await rt.mandates.reissue(before, patch, by, new Date(), demo ? undefined : (m) => rt.sandboxes.reissue(kitchen.slug, m));
  // Mandates this server signed earlier for the kitchen are not presented again.
  const g = globalThis as { __dockConsoleTokens?: Map<string, unknown>; __dockMenuTokens?: Map<string, unknown> };
  g.__dockConsoleTokens?.clear();
  g.__dockMenuTokens?.clear();
  const pick = (m: Mandate) => ({ forbiddenAllergens: m.forbiddenAllergens, requiredAttributes: m.requiredAttributes });
  const out: MandateReissued = { at: record.at, by, mandateId: mandate.mandateId, replaced: before.mandateId, added, before: pick(before), after: pick(mandate), signedWith: demo ? "the kitchen's configured key" : "a new key of the kitchen" };
  const words = [...added.forbiddenAllergens.map((a) => `no ${a.replaceAll("_", " ")}`), ...added.requiredAttributes.map((c) => `every product ${c.replaceAll("_", "-")}`)].join(", ");
  rt.dock.ledger.append({
    type: "intake",
    actor: `buyer:${by}`,
    summary: `${by} reissued ${kitchen.name}'s mandate with one more rule: ${words}. It was signed with ${out.signedWith} as ${mandate.mandateId} and replaces ${before.mandateId}; mandates the kitchen signed before ${record.at.slice(0, 19).replace("T", " ")} UTC are refused from now on. Nothing else in the mandate changed.`,
    data: { step: "mandate_reissued", orgId: kitchen.orgId, by, at: record.at, mandateId: mandate.mandateId, replaced: before.mandateId, added, before: out.before, after: out.after, signedWith: out.signedWith },
  });
  return out;
}
