import { describe, expect, it } from "vitest";
import { stepFor } from "./sheet-steps";

describe("the order sheet's stepper steps", () => {
  it("moves big packs one at a time and small cartons ten at a time once the line is large", () => {
    expect(stepFor(10, "L", 10)).toBe(1); // 10 L bag-in-box
    expect(stepFor(1, "L", 5)).toBe(1); // a few 1 L cartons
    expect(stepFor(1, "L", 100)).toBe(10); // 100 L of 1 L cartons
    expect(stepFor(2, "kg", 40)).toBe(5);
    expect(stepFor(1, "pcs", 200)).toBe(1);
  });
});
