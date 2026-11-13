import { beforeEach, describe, expect, it } from "vitest";
import * as ledgerRoute from "@/app/api/v1/ledger/route";
import * as consoleCall from "@/app/ui-api/kitchens/[kitchen]/call/route";
import * as kitchenRoute from "@/app/ui-api/kitchens/[kitchen]/route";
import { signMandate } from "@/core/mandate";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "./dev-fixtures";
import { attachConsoleContext, humanViaOf } from "./console-context";
import { enterOps, sessionCookie as opsCookie } from "./ops/access";
import { getRuntime, resetRuntime } from "./runtime";

/** F-LEDGER-OPEN, F-CONSOLE-OPEN: who may read a kitchen's ledger and act through its console (server/authz.ts). */
const BASE = "https://dock.test";
const params = (kitchen: string) => ({ params: Promise.resolve({ kitchen }) }) as never;
const viaConsole = (kitchen: string, call: unknown, cookie?: string) =>
  consoleCall.POST(new Request(`${BASE}/ui-api/kitchens/${kitchen}/call`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(call) }), params(kitchen));

beforeEach(() => {
  resetRuntime();
  process.env.DOCK_CATALOG = "seed";
});

async function laaksoRequest(text: string) {
  const rt = await getRuntime();
  const s = await rt.dock.authenticate(await signMandate(demoMandate(new Date()), await demoOrgKeyPair()), DEMO_ORG.agentId);
  return rt.dock.openRequest(s, { text });
}

describe("authorisation", () => {
  it("the ledger: verification for anyone, entries only for their own kitchen, everything for operations", async () => {
    await laaksoRequest("private: milk for the chef's party");
    const anon = await (await ledgerRoute.GET(new Request(`${BASE}/api/v1/ledger`))).json();
    expect(anon.verification.ok).toBe(true);
    expect(anon.entries).toEqual([]);
    // Kaari's console reads Kaari's ledger only.
    const kaari = await (await viaConsole("kaari", { method: "GET", path: "/api/v1/ledger" })).json();
    expect(JSON.stringify(kaari)).not.toContain("chef's party");
    const laakso = await (await viaConsole("laakso", { method: "GET", path: "/api/v1/ledger" })).json();
    expect(JSON.stringify(laakso)).toContain("chef's party");
    const ops = enterOps({ name: "Riikka" });
    const cookie = opsCookie(new Request(BASE), ops).split(";")[0];
    const all = await (await ledgerRoute.GET(new Request(`${BASE}/api/v1/ledger`, { headers: { cookie } }))).json();
    expect(JSON.stringify(all)).toContain("chef's party");
  });

  it("a visitor's kitchen console acts only for the phone that joined it; others' kitchens are not listed", async () => {
    const rt = await getRuntime();
    const a = await rt.sandboxes.joinWithoutPasskey();
    const b = await rt.sandboxes.joinWithoutPasskey();
    const intake = { method: "POST", path: "/api/v1/intake", body: { need: { item: { text: "milk", category: "milk" }, quantity: { amount: 20, unit: "L" } } } };
    expect((await viaConsole(a.sandbox.sandboxId, intake)).status).toBe(401);
    expect((await viaConsole(a.sandbox.sandboxId, intake, `dock_approver=${encodeURIComponent(b.sessionToken)}`)).status).toBe(403);
    expect((await viaConsole(a.sandbox.sandboxId, intake, `dock_approver=${encodeURIComponent(a.sessionToken)}`)).status).toBe(201);
    const info = await (await kitchenRoute.GET(new Request(`${BASE}/ui-api/kitchens/kaari`, { headers: { cookie: `dock_approver=${encodeURIComponent(a.sessionToken)}` } }), params("kaari"))).json();
    expect(info.kitchens.map((k: { slug: string }) => k.slug)).toEqual(["kaari", "laakso", a.sandbox.sandboxId]);
    const stranger = await (await kitchenRoute.GET(new Request(`${BASE}/ui-api/kitchens/kaari`), params("kaari"))).json();
    expect(stranger.kitchens.map((k: { slug: string }) => k.slug)).toEqual(["kaari", "laakso"]);
  });

  it("only server code can mark an answer as a signed-in person's; no header or cookie name can fake it (F-HUMAN-INPUT-BY-AGENT)", () => {
    const forged = new Request(`${BASE}/api/v1/intake/req_x/concerns`, { method: "POST", headers: { "x-dock-human": "portal_session", "dock-channel": "voice", cookie: "dock_console=aaaaaaaaaaaaaaaaaaaa" } });
    expect(humanViaOf(forged)).toEqual({ channel: "relayed" });
    const real = attachConsoleContext(new Request(`${BASE}/api/v1/intake/req_x/concerns`, { method: "POST" }), { kitchen: "sbx_1", session: "s", person: { channel: "portal_session", name: "Helmi Salo", approverId: "apv_1" } });
    expect(humanViaOf(real)).toEqual({ channel: "portal_session", person: "Helmi Salo" });
  });
});
