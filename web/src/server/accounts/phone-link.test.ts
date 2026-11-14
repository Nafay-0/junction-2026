import { beforeEach, describe, expect, it } from "vitest";
import * as deviceLink from "@/app/ui-api/account/device/link/route";
import * as device from "@/app/ui-api/account/device/route";
import * as mandate from "@/app/ui-api/account/mandate/route";
import * as account from "@/app/ui-api/account/route";
import * as connect from "@/app/ui-api/connect/[kitchen]/route";
import * as kitchenMemory from "@/app/ui-api/memory/kitchens/[kitchen]/route";
import * as call from "@/app/ui-api/voice/[kitchen]/call/route";
import { consoleKitchen } from "../authz";
import { getRuntime, resetRuntime } from "../runtime";
import { ACCOUNT_COOKIE } from "./http";
import { DEFAULT_TERMS } from "./terms";

/**
 * "Call your agent" shows a QR code: a one-time link (10 minutes) that signs a phone in and opens the call. Whoever
 * scans it first gets the session, and the code is on a screen. It used to be a full account session for 14 days:
 * the phone could add its own passkey as the kitchen's signer, sign the mandate again with other terms, read the
 * connector address and mint more links. A hand-off session is now for the call: it speaks to the kitchen's agent
 * as the kitchen for an hour, and nothing else.
 */
const BASE = "http://dock.test";
const params = (kitchen: string) => ({ params: Promise.resolve({ kitchen }) }) as never;
const req = (path: string, cookie: string, body?: unknown) =>
  new Request(`${BASE}${path}`, { method: body === undefined ? "GET" : "POST", headers: { cookie: `${ACCOUNT_COOKIE}=${cookie}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => resetRuntime());

async function accountWithKitchen() {
  const rt = await getRuntime();
  const owner = await rt.accounts.signUp({ restaurant: "Ravintola Testi", username: "testi", password: "a long enough passphrase 1" }, "198.51.100.7");
  await rt.accounts.signKitchen("testi", DEFAULT_TERMS);
  const { token } = await rt.accounts.oneTimeLink("testi", "session");
  const phone = (await rt.accounts.handOff(token))!;
  return { rt, owner, phone, link: token };
}

describe("a phone signed in by the call code", () => {
  it("is signed in for the call only, for an hour, and the code works once", async () => {
    const { rt, phone, link } = await accountWithKitchen();
    expect(Date.parse(phone.expiresAt) - Date.now()).toBeLessThanOrEqual(61 * 60_000);
    expect((await rt.accounts.session(phone.token))?.session).toMatchObject({ username: "testi", scope: "call" });
    expect(await rt.accounts.handOff(link)).toBeUndefined();
    // It is the kitchen's person on the call: the console resolves the kitchen for it, marked as a call session.
    const k = await consoleKitchen(req("/ui-api/voice/testi/tool", phone.token, {}), rt, "testi");
    expect(k?.console.person).toMatchObject({ account: "testi", callOnly: true });
  });

  it("cannot add a signing device, sign the mandate, read the connector address, change memory or mint another code", async () => {
    const { phone, owner } = await accountWithKitchen();
    const limited = { status: 403, code: "phone_session_limited" };
    const tries: [string, () => Promise<Response>][] = [
      ["add a signing device", () => device.POST(req("/ui-api/account/device", phone.token, { step: "begin" }))],
      ["list signing devices", () => device.GET(req("/ui-api/account/device", phone.token))],
      ["a code for another signing device", () => deviceLink.POST(req("/ui-api/account/device/link", phone.token, {}))],
      ["sign the mandate again", () => mandate.POST(req("/ui-api/account/mandate", phone.token, { terms: { ...DEFAULT_TERMS, perOrderLimitEur: 5000 } }))],
      ["read the mandate form", () => mandate.GET(req("/ui-api/account/mandate", phone.token))],
      ["the connector address", () => connect.GET(req("/ui-api/connect/testi", phone.token), params("testi"))],
      ["a new connector address", () => connect.POST(req("/ui-api/connect/testi", phone.token, { action: "reissue" }), params("testi"))],
      ["another call code", () => call.GET(req("/ui-api/voice/testi/call", phone.token), params("testi"))],
      ["a rule in the kitchen's memory", () => kitchenMemory.POST(req("/ui-api/memory/kitchens/testi", phone.token, { action: "state", fact: { kind: "allergen", allergen: "nuts" } }), params("testi"))],
    ];
    for (const [what, go] of tries) {
      const res = await go();
      const body = (await res.json()) as { error?: { code?: string } };
      expect({ what, status: res.status, code: body.error?.code }).toMatchObject({ what, ...(what === "a rule in the kitchen's memory" ? { status: 401, code: "kitchen_person_required" } : limited) });
    }
    // The account's own browser still can.
    expect((await deviceLink.POST(req("/ui-api/account/device/link", owner.token, {}))).status).toBe(200);
    expect((await call.GET(req("/ui-api/voice/testi/call", owner.token), params("testi"))).status).toBe(200);
    // And the phone can see which account it is on.
    expect((await account.GET(req("/ui-api/account", phone.token))).status).toBe(200);
  });
});
