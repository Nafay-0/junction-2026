import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as approvalRoute from "@/app/api/v1/approvals/[approvalId]/route";
import * as approverHome from "@/app/api/v1/approver/route";
import * as approverDemoOrder from "@/app/api/v1/approver/demo-order/route";
import * as mine from "@/app/k/mine/route";
import * as challengeRoute from "@/app/api/v1/approvals/[approvalId]/challenge/route";
import * as consoleApproval from "@/app/ui-api/kitchens/[kitchen]/approval/[approvalId]/route";
import * as enrolRoute from "@/app/ui-api/presenter/enrol/route";
import * as enrolVerifyRoute from "@/app/ui-api/presenter/enrol/verify/route";
import { signMandate } from "@/core/mandate";
import { SoftwareAuthenticator } from "@/core/test-webauthn";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "./dev-fixtures";
import { resetPresenterFailures } from "./presenter";
import { getRuntime, resetRuntime } from "./runtime";
import { sessionCookieFor } from "./accounts/test-session";

/**
 * F-DEMO-KITCHEN-UNSIGNABLE: on a production build nobody could sign a built-in demo kitchen's orders. A presenter
 * who knows the operations passcode enrols a passkey on their own phone and signs like any visitor; no tap shortcut.
 */
const BASE = "https://dock.test";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(BASE + path, { method, headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (r: Response | Promise<Response>) => {
  const res = await r;
  return { status: res.status, body: (await res.json()) as Json, headers: res.headers };
};
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function laaksoBigOrder() {
  const rt = await getRuntime();
  const session = await rt.dock.authenticate(await signMandate(demoMandate(new Date()), await demoOrgKeyPair()), DEMO_ORG.agentId);
  const r = await rt.dock.openRequest(session, { text: "1,000 L lactose-free milk" });
  const q = await rt.dock.requestQuote(session, { requestId: r.requestId, lines: [{ productId: "VA-1001", quantity: 700 }] });
  return rt.dock.placeOrder(session, { requestId: r.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) });
}

const env = { ...process.env };
beforeEach(() => {
  resetRuntime();
  resetPresenterFailures();
  process.env.DOCK_OPS_PASSCODE = "harbour-7";
  process.env.DOCK_CATALOG = "seed";
});
afterEach(() => {
  process.env = { ...env };
});

describe("presenter enrolment for the built-in demo kitchens", () => {
  it("passcode, passkey, then sign-off with that passkey; the one-time link stops working", async () => {
    const order = await laaksoBigOrder();
    expect(order.status).toBe("pending_approval");
    const approvalId = order.approval!.approvalId;
    // The store's QR code is shown on the stage kitchen's own signed-in screen (its account); a stranger gets none.
    const own = { cookie: await sessionCookieFor(await getRuntime(), "laakso") };
    expect((await json(consoleApproval.GET(req("GET", `/ui-api/kitchens/laakso/approval/${approvalId}`), params({ kitchen: "laakso", approvalId }) as never))).status).toBe(401);
    const before = await json(consoleApproval.GET(req("GET", `/ui-api/kitchens/laakso/approval/${approvalId}`, undefined, own), params({ kitchen: "laakso", approvalId }) as never));
    expect(before.body.mode).not.toBe("view_only");
    if (process.env.NODE_ENV === "production") expect(before.body.mode).toBe("enrol");

    expect((await json(enrolRoute.POST(req("POST", "/ui-api/presenter/enrol", { kitchen: "laakso", role: "kitchen_manager", passcode: "nope" })))).status).toBe(401);
    expect((await json(enrolRoute.POST(req("POST", "/ui-api/presenter/enrol", { kitchen: "sbx_x", passcode: "harbour-7" })))).status).toBe(404);
    const begin = await json(enrolRoute.POST(req("POST", "/ui-api/presenter/enrol", { kitchen: "laakso", role: "kitchen_manager", passcode: "harbour-7", presenter: "Nafay" })));
    expect(begin.status).toBe(200);
    expect(begin.body.approver).toMatchObject({ name: "Aino Virtanen", role: "kitchen_manager" });
    const phone = new SoftwareAuthenticator(BASE);
    const done = await json(enrolVerifyRoute.POST(req("POST", "/ui-api/presenter/enrol/verify", { response: phone.register(begin.body.options) })));
    expect(done.status).toBe(201);
    const cookie = done.headers.get("set-cookie")!.split(";")[0];

    const after = await json(consoleApproval.GET(req("GET", `/ui-api/kitchens/laakso/approval/${approvalId}`, undefined, own), params({ kitchen: "laakso", approvalId }) as never));
    expect(after.body.mode).toBe("passkey");

    // The link token Dock "sent to Aino's phone" no longer signs: this role has a passkey now.
    const rt = await getRuntime();
    const msg = rt.outbox.messages().find((m) => m.approvalId === approvalId)!;
    const token = new URL(msg.link, BASE).searchParams.get("token");
    expect((await json(approvalRoute.POST(req("POST", `/api/v1/approvals/${approvalId}`, { decision: "approve", token }), params({ approvalId })))).status).toBe(403);
    // No tap-to-approve: the phone's session alone cannot approve.
    expect((await json(approvalRoute.POST(req("POST", `/api/v1/approvals/${approvalId}`, { decision: "approve", proof: { kind: "demo_tap" } }, { cookie }), params({ approvalId })))).status).toBe(403);

    const ch = await json(challengeRoute.POST(req("POST", `/api/v1/approvals/${approvalId}/challenge`, { decision: "approve" }, { cookie }), params({ approvalId })));
    const signed = await json(approvalRoute.POST(req("POST", `/api/v1/approvals/${approvalId}`, { decision: "approve", proof: { kind: "webauthn", response: phone.assert(ch.body.options) } }, { cookie }), params({ approvalId })));
    expect(signed.status).toBe(200);
    expect(signed.body.order.status).toBe("committed");
    expect(signed.body.order.approval.signOff ?? signed.body.view.outcome).toBeTruthy();
    expect(rt.dock.ledger.entries().some((e) => e.data.step === "presenter_enrolled" && /Nafay enrolled a passkey to sign for Aino Virtanen/.test(e.summary))).toBe(true);
  });

  it("an enrolled presenter has an approver home screen for the demo kitchen, can ask its agent, and opens its shop", async () => {
    const begin = await json(enrolRoute.POST(req("POST", "/ui-api/presenter/enrol", { kitchen: "kaari", passcode: "harbour-7", presenter: "Nafay" })));
    const phone = new SoftwareAuthenticator(BASE);
    const done = await json(enrolVerifyRoute.POST(req("POST", "/ui-api/presenter/enrol/verify", { response: phone.register(begin.body.options) })));
    const cookie = done.headers.get("set-cookie")!.split(";")[0];
    expect((await json(approverHome.GET(req("GET", "/api/v1/approver")))).status).toBe(401);
    const home = await json(approverHome.GET(req("GET", "/api/v1/approver", undefined, { cookie })));
    expect(home.status).toBe(200);
    expect(home.body).toMatchObject({ approver: { name: begin.body.approver.name, passkey: true }, kitchen: { name: "Ravintola Kaari" }, agent: { name: "Kaari's buyer agent" }, pending: [] });
    const asked = await json(approverDemoOrder.POST(req("POST", "/api/v1/approver/demo-order", undefined, { cookie })));
    expect(asked.status).toBe(201);
    expect(asked.body.order.status).toBe("pending_approval");
    const again = await json(approverHome.GET(req("GET", "/api/v1/approver", undefined, { cookie })));
    expect(again.body.pending.map((p: Json) => p.approvalId)).toEqual([asked.body.order.approvalId]);
    const shop = await mine.GET(req("GET", "/k/mine", undefined, { cookie }));
    expect(shop.headers.get("location")).toMatch(/\/k\/kaari$/);
  });

  it("limits wrong passcodes per address and refuses enrolment in production without a passcode", async () => {
    for (let i = 0; i < 5; i++) expect((await json(enrolRoute.POST(req("POST", "/ui-api/presenter/enrol", { kitchen: "kaari", passcode: `guess-${i}` })))).status).toBe(401);
    expect((await json(enrolRoute.POST(req("POST", "/ui-api/presenter/enrol", { kitchen: "kaari", passcode: "harbour-7" })))).status).toBe(429);
    resetPresenterFailures();
    delete process.env.DOCK_OPS_PASSCODE;
    (process.env as Record<string, string>).NODE_ENV = "production";
    const r = await json(enrolRoute.POST(req("POST", "/ui-api/presenter/enrol", { kitchen: "kaari" })));
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("presenter_enrolment_off");
  });
});
