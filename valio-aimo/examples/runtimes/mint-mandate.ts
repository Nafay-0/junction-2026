/**
 * DEV ONLY. Prints a mandate for the demo kitchen (Ravintola Kaari) naming one agent per runtime, so that each
 * example presents its own agent id. Same terms as the demo kitchen's mandate (`demoKitchenMandate`), except the
 * weekly budget, raised to €20,000 so that several runs against one server fit in one week (a 1,000 L order is
 * about €1,322 and pending orders count against the budget). Signed with the demo kitchen's public dev key, or
 * DOCK_DEMO_KITCHEN_JWK if set: give the server the same value.
 *
 *   cd web && pnpm -s exec tsx ../examples/runtimes/mint-mandate.ts pydantic-ai
 *   -> {"token":"eyJ…","agentId":"agent_kaari_pydantic_ai"}
 */
import { signMandate } from "@/core/mandate";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "@/server/demo-kitchen";
import { loadLocalEnv } from "../../web/scripts/lib/env";

// The server reads web/.env.local (DOCK_DEMO_KITCHEN_JWK among it); so must this, or it signs with the public dev key
// the server no longer trusts and every runtime is refused at the door (mandate_unknown_issuer).
loadLocalEnv();

const runtime = (process.argv[2] ?? "generic").toLowerCase().replace(/[^a-z0-9]+/g, "_");
const now = new Date();
const agentId = `${KITCHEN_ORG.agentId.replace(/_01$/, "")}_${runtime}`;
const mandate = demoKitchenMandate(now, {
  agentId,
  mandateId: `mnd_kaari_${now.toISOString().slice(0, 10).replaceAll("-", "")}_${runtime}`,
  weeklyBudgetCents: 2_000_000,
});
demoKitchenKeyPair()
  .then((key) => signMandate(mandate, key))
  .then((token) => console.log(JSON.stringify({ token, agentId })));
