import { beforeEach, describe, expect, it } from "vitest";
import { SoftwareAuthenticator } from "@/core/test-webauthn";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { TEST_SIGNER_DEVICES, joinDecision, joinLink, phoneJoins, signerDevices } from "./phone-join";

/**
 * "Send to my phone" in a shared test kitchen or a fresh kitchen: every reviewer's phone joins as one more signing
 * device of the approver (a new one-time address each time), up to a cap; a restaurant's own account adds only its
 * first device from its screen, and after that only the approver's own phone signs.
 */

const RP = { id: "localhost", name: "AimoPilot", origins: ["http://localhost:3000"] };
const req = () => new Request("http://localhost:3000/ui-api/account/device/link", { method: "POST" });

beforeEach(() => {
  resetRuntime();
  process.env.DOCK_RATE_LIMITS = "off";
});

describe("the join decision", () => {
  it("a shared test kitchen and a fresh kitchen always join, however many devices there are", () => {
    for (const a of [{ kind: "test" as const }, { kind: "own" as const, free: { at: "", lastUsedAt: "" } }])
      for (const n of [0, 1, 5, 29]) expect(joinDecision(a, n, true)).toBe("join");
    expect(phoneJoins({ kind: "test" })).toBe(true);
    expect(phoneJoins({ kind: "own", free: { at: "", lastUsedAt: "" } })).toBe(true);
  });

  it("a restaurant's own account joins only its first device; after that the approver's own phone", () => {
    expect(joinDecision({ kind: "own" }, 0, true)).toBe("join");
    expect(joinDecision({ kind: "own" }, 1, true)).toBe("approver");
    expect(joinDecision({ kind: "demo" }, 2, true)).toBe("approver");
    expect(phoneJoins({ kind: "own" })).toBe(false);
    expect(phoneJoins(undefined)).toBe(false);
  });

  it("from another screen nothing joins", () => {
    expect(joinDecision({ kind: "test" }, 3, false)).toBe("approver");
    expect(joinDecision({ kind: "test" }, 0, false)).toBe("none");
  });
});

describe("join addresses in a shared test kitchen", () => {
  it("a new one-time address each time, after any number of devices, up to the cap", async () => {
    const rt = await getRuntime();
    const a = (await rt.accounts.get("koulu-metsola"))!;
    expect(a.kind).toBe("test");
    const first = await joinLink(rt, req(), a, "/approve/apr_abcdef123");
    // One phone joins with it.
    const p1 = new SoftwareAuthenticator("http://localhost:3000");
    const t1 = new URL(first.url).searchParams.get("t")!;
    await rt.accounts.completeDevice(p1.register(await rt.accounts.beginDevice(a, RP, "link", t1)), { link: t1 });
    expect(await signerDevices(rt, a)).toBe(1);
    // The next reviewer gets a fresh address, not the bare sign-off one.
    const second = await joinLink(rt, req(), a, "/approve/apr_abcdef123");
    expect(second.url).toMatch(/\/join\/device\?t=.+&next=%2Fapprove%2Fapr_abcdef123$/);
    expect(second.url).not.toBe(first.url);
    // Up to the cap.
    for (let i = (await signerDevices(rt, a)); i < TEST_SIGNER_DEVICES; i++) {
      const l = await joinLink(rt, req(), a);
      const t = new URL(l.url).searchParams.get("t")!;
      await rt.accounts.completeDevice(new SoftwareAuthenticator("http://localhost:3000").register(await rt.accounts.beginDevice(a, RP, "link", t)), { link: t });
    }
    await expect(joinLink(rt, req(), a)).rejects.toMatchObject({ code: "signer_devices_full" });
  }, 30_000);
});
