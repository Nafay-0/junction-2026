/* eslint-disable @typescript-eslint/no-explicit-any -- load harness: reads untyped JSON replies. */
/**
 * One purchase of each kind against a running server, printing the gate's reasons: for checking that the load mix
 * still gets the answers lib.ts EXPECTED says (a rule the gate added can turn "auto" orders into sign-offs).
 *   pnpm exec tsx tests-live/load/probe.ts --url http://localhost:4650
 */
import { EXPECTED, Recorder, arg, http, loadDemoKeys, makeBuyer, type FlowKind } from "./lib";

loadDemoKeys();
const url = arg("url", "http://localhost:4650")!;

async function main() {
  for (const org of ["laakso", "kaari"] as const) {
    const b = await makeBuyer(org, `agent_probe_${org}`, `probe${Date.now().toString(36)}`);
    const kinds: FlowKind[] = ["auto", "auto", "auto", "over", "auto", "refuse_rule", "refuse_budget", "auto", "auto"];
    for (const kind of kinds) {
      const rec = new Recorder();
      const h = { authorization: `Mandate ${b.mandates[kind]}`, "dock-agent-id": b.agentId };
      const { runFlow } = await import("./lib");
      const outcome = await runFlow(rec, url, b, kind);
      const o = rec.orders[0];
      const got = o ? await http(undefined, "order", url, "GET", `/api/v1/orders/${o.orderId}`, undefined, h) : undefined;
      const d = got?.body?.order?.decision;
      const off = d?.rules?.filter((r: any) => r.outcome !== "pass").map((r: any) => `${r.rule}:${r.outcome}: ${r.reason}`);
      console.log(`${org} ${kind}: ${outcome} (expected ${EXPECTED[kind].status})${off?.length ? `\n   ${off.join("\n   ")}` : ""}`);
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
