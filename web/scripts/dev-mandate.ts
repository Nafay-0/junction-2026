/**
 * DEV ONLY. Print a signed mandate for the fictional demo buyer (Laakso Catering Oy), valid 7 days,
 * so you can point any MCP client or curl at a local Dock:
 *
 *   export DOCK_MANDATE=$(pnpm -s dev:mandate) DOCK_AGENT_ID=agent_laakso_buyer_01
 *
 * Its key is derived from a public string (see src/server/dev-fixtures.ts) unless DOCK_DEMO_ORG_JWK is set.
 * In production the buyer organisation signs its own mandates with its own key.
 */
import { signMandate } from "@/core/mandate";
import { demoMandate, demoOrgKeyPair } from "@/server/dev-fixtures";

demoOrgKeyPair()
  .then((key) => signMandate(demoMandate(new Date()), key))
  .then((token) => console.log(token));
