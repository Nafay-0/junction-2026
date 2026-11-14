import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateEd25519KeyPair } from "@/core/keys";
import { signMandate } from "@/core/mandate";
import { resolveKitchen } from "./console-kitchens";
import { KITCHEN_ORG, KITCHEN_PUBLIC_DEV_SEED, demoKitchenMandate } from "./demo-kitchen";
import { DEMO_ORG, demoKeySource, demoMandate, demoOrgKeyPair, publicDevKeyPair, servesPublicSite } from "./dev-fixtures";
import { getRuntime, resetRuntime } from "./runtime";

/**
 * The demo organisations' keys. Without a configured JWK they come from a string in this repository, so anyone can
 * sign a mandate for Laakso or Kaari. That is how a fresh clone runs with no secrets, and it must never be worth
 * anything on a public site: there, with no JWK configured, the organisation gets a key that exists only in the
 * server process.
 */
const ENV = ["DOCK_PUBLIC_URL", "DOCK_DEMO_ORG_JWK", "DOCK_DEMO_KITCHEN_JWK"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  (globalThis as { __dockProcessKeys?: unknown }).__dockProcessKeys = undefined;
  (globalThis as { __dockConsoleTokens?: unknown }).__dockConsoleTokens = undefined;
  resetRuntime();
});

afterEach(() => {
  for (const k of ENV) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  (globalThis as { __dockProcessKeys?: unknown }).__dockProcessKeys = undefined;
  (globalThis as { __dockConsoleTokens?: unknown }).__dockConsoleTokens = undefined;
  resetRuntime();
});

const fromTheRepository = async () => ({
  laakso: await signMandate(demoMandate(new Date()), await publicDevKeyPair(DEMO_ORG.kid)),
  kaari: await signMandate(demoKitchenMandate(new Date()), await publicDevKeyPair(KITCHEN_ORG.kid, KITCHEN_PUBLIC_DEV_SEED)),
});

describe("the public dev key", () => {
  it("signs for the demo organisations on a local run, and health says so", async () => {
    expect(servesPublicSite()).toBe(false);
    expect(demoKeySource("DOCK_DEMO_ORG_JWK")).toBe("public dev key");
    const { dock } = await getRuntime();
    const minted = await fromTheRepository();
    await expect(dock.authenticate(minted.laakso, DEMO_ORG.agentId)).resolves.toMatchObject({ agentId: DEMO_ORG.agentId });
    await expect(dock.authenticate(minted.kaari, KITCHEN_ORG.agentId)).resolves.toMatchObject({ agentId: KITCHEN_ORG.agentId });
    for (const local of ["http://localhost:3000", "http://127.0.0.1:4312"]) {
      process.env.DOCK_PUBLIC_URL = local;
      expect(servesPublicSite()).toBe(false);
    }
  });

  it("is worth nothing on a public site: a mandate signed with it is refused, while the site's own store still works", async () => {
    process.env.DOCK_PUBLIC_URL = "https://dock.example.org";
    expect(servesPublicSite()).toBe(true);
    expect(demoKeySource("DOCK_DEMO_ORG_JWK")).toBe("process key");
    const { dock } = await getRuntime();
    const minted = await fromTheRepository();
    await expect(dock.authenticate(minted.laakso, DEMO_ORG.agentId)).rejects.toMatchObject({ status: 401, code: "mandate_signature_invalid" });
    await expect(dock.authenticate(minted.kaari, KITCHEN_ORG.agentId)).rejects.toMatchObject({ status: 401, code: "mandate_signature_invalid" });
    // The store's own agents carry mandates the server signed with the process key.
    for (const slug of ["laakso", "kaari"]) {
      const k = (await resolveKitchen(slug))!;
      await expect(dock.authenticate(k.mandateToken, k.agentId)).resolves.toMatchObject({ agentId: k.agentId });
    }
    // The key is stable within the process, and not the repository's.
    expect((await demoOrgKeyPair()).publicJwk.x).toBe((await demoOrgKeyPair()).publicJwk.x);
    expect((await demoOrgKeyPair()).publicJwk.x).not.toBe((await publicDevKeyPair(DEMO_ORG.kid)).publicJwk.x);
  });

  it("a configured key is the organisation's key, on a public site as anywhere", async () => {
    const { exportJWK } = await import("jose");
    const fresh = await generateEd25519KeyPair(DEMO_ORG.kid); // a deployment's own secret, for this test
    process.env.DOCK_DEMO_ORG_JWK = JSON.stringify(await exportJWK(fresh.privateKey));
    const own = await demoOrgKeyPair();
    process.env.DOCK_PUBLIC_URL = "https://dock.example.org";
    expect(demoKeySource("DOCK_DEMO_ORG_JWK")).toBe("fixed");
    const { dock } = await getRuntime();
    await expect(dock.authenticate(await signMandate(demoMandate(new Date()), own), DEMO_ORG.agentId)).resolves.toBeDefined();
    await expect(dock.authenticate((await fromTheRepository()).laakso, DEMO_ORG.agentId)).rejects.toMatchObject({ code: "mandate_signature_invalid" });
  });
});
