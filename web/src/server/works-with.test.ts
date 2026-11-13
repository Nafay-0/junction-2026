import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKS_WITH } from "./works-with";

describe("works-with data", () => {
  it("lists each runtime once, with an example folder that exists", () => {
    const slugs = WORKS_WITH.runtimes.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const r of WORKS_WITH.runtimes) expect(existsSync(join(__dirname, "../../..", r.examplePath))).toBe(true);
  });

  it("marks a runtime verified only when its run reached an order", () => {
    for (const r of WORKS_WITH.runtimes) expect(r.verified).toBe(r.outcome === "committed" || r.outcome === "pending_approval");
  });
});
