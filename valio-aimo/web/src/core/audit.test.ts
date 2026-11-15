import { describe, expect, it } from "vitest";

describe("the wholesaler's view never shows an email address whole", () => {
  // (A step the wholesaler's view shows with its own summary; most mail steps stay with the buyer and are not shown at all.)
  it("masks an address quoted inside a summary", async () => {
    const { auditFor } = await import("./audit");
    const entry = { seq: 1, at: "2026-11-15T01:20:52.708Z", type: "intake", actor: "dock", summary: "A mail failed: validation_error (403): You can only send testing emails to your own email address (first.last@gmail.com). The order is not affected.", data: { step: "cannot_arrive" }, prevHash: "0", hash: "1" };
    const shown = JSON.stringify(auditFor("wholesaler", [entry as never]));
    expect(shown).not.toContain("first.last@gmail.com");
    expect(shown).toContain("f•••@gmail.com");
  });
});
