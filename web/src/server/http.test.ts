import { describe, expect, it, vi } from "vitest";
import { MAX_JSON_BYTES, handle, readJson } from "./http";
import { resetRuntime } from "./runtime";

/**
 * Next.js loads a module once per route/page bundle. The status page `/` used to build the shared runtime with its
 * own copy of DockError, after which every refusal a route caught failed `instanceof` and became a 500.
 * `vi.resetModules()` + a fresh import gives a second copy of the class, the same situation.
 */
async function foreignCopy() {
  vi.resetModules();
  const errors = await import("@/core/errors");
  const passkeys = await import("@/core/passkeys");
  return { errors, passkeys };
}

describe("handle", () => {
  it("keeps the status of a DockError thrown by another copy of the class", async () => {
    resetRuntime();
    const { errors } = await foreignCopy();
    const thrown = new errors.DockError(401, "mandate_missing", "No mandate.", "mandate_signature");
    const res = await handle(async () => {
      throw thrown;
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "mandate_missing", rule: "mandate_signature", message: "No mandate." } });
  });

  it("still turns unknown errors into a 500 without details", async () => {
    resetRuntime();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handle(async () => {
      throw Object.assign(new Error("boom"), { status: 401, code: "looks_like_one" });
    });
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("internal_error");
  });

  it("instanceof works across copies for DockError and PasskeyError", async () => {
    const { DockError } = await import("@/core/errors");
    const { PasskeyError } = await import("@/core/passkeys");
    const { errors, passkeys } = await foreignCopy();
    expect(errors.DockError).not.toBe(DockError);
    expect(new errors.DockError(400, "x", "y") instanceof DockError).toBe(true);
    expect(new passkeys.PasskeyError(400, "x", "y") instanceof PasskeyError).toBe(true);
    expect(new Error("plain") instanceof DockError).toBe(false);
    expect(new passkeys.PasskeyError(400, "x", "y") instanceof DockError).toBe(false);
  });
});

describe("readJson", () => {
  const post = (body: BodyInit, headers: Record<string, string> = {}) =>
    new Request("http://dock.test/x", { method: "POST", body, headers, duplex: "half" } as RequestInit);

  it("parses a small body", async () => {
    expect(await readJson(post('{"a":1}'))).toEqual({ a: 1 });
  });

  it("refuses a body over the limit with 413, by declared length", async () => {
    const req = post("{}", { "content-length": String(MAX_JSON_BYTES + 1) });
    await expect(readJson(req)).rejects.toMatchObject({ status: 413, code: "body_too_large" });
  });

  it("refuses a streamed body over the limit with 413 without reading it all", async () => {
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        sent += 16 * 1024;
        c.enqueue(new Uint8Array(16 * 1024).fill(32));
        if (sent > 10 * MAX_JSON_BYTES) c.close();
      },
    });
    await expect(readJson(post(stream))).rejects.toMatchObject({ status: 413 });
    expect(sent).toBeLessThan(10 * MAX_JSON_BYTES);
  });

  it("refuses non-JSON with 400", async () => {
    await expect(readJson(post("nope"))).rejects.toMatchObject({ status: 400, code: "invalid_json" });
  });
});
