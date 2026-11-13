import { decidingRule } from "@/core/policy";
import { authenticate, errorBody, handle, readJson } from "@/server/http";

/** 201 committed, 202 waiting for a human sign-off, 422 refused by the gate (error names the rule). */
export async function POST(req: Request) {
  return handle(async ({ dock }) => {
    const session = await authenticate(req, dock);
    const order = await dock.placeOrder(session, (await readJson(req)) as never);
    if (order.status === "rejected") {
      const rule = decidingRule(order.decision);
      return Response.json({ ...errorBody("policy_rejected", order.decision.reasons.join(" "), rule?.rule), order }, { status: 422 });
    }
    return Response.json({ order }, { status: order.status === "committed" ? 201 : 202 });
  });
}
