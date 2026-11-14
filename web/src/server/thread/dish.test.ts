import { describe, expect, it } from "vitest";
import { coversIn, dishRequestOf, shortReason } from "./dish";

describe("a request for a dish", () => {
  it("open: one question first; with preferences: straight to ideas; a named dish or an item: neither", () => {
    expect(dishRequestOf("i Have a big lunch coming up next week need to plan a dish for 20 people")).toBe("open");
    expect(dishRequestOf("ensi viikolla on iso lounas, pitää suunnitella ruoka 20 hengelle")).toBe("open");
    expect(dishRequestOf("plan a vegetarian lunch for 30")).toBe("preferences");
    expect(dishRequestOf("meatballs and mash for 20 on Tuesday")).toBeUndefined();
    expect(dishRequestOf("chocolate cake")).toBeUndefined();
    expect(dishRequestOf("20 litres of milk for Tuesday")).toBeUndefined();
  });
  it("reads the covers in three languages", () => {
    expect(coversIn("a dish for 20 people")).toBe(20);
    expect(coversIn("ruoka 40 hengelle")).toBe(40);
    expect(coversIn("middag för 12 personer")).toBe(12);
  });
});

describe("an idea's reason", () => {
  it("is at most about six words, cut at a clause, or left out; never cut mid-phrase", () => {
    expect(shortReason("Uses your usual cream and butter.")).toBe("Uses your usual cream and butter");
    expect(shortReason("Seasonal: root vegetables are cheap now, and they keep well.")).toBe("root vegetables are cheap now");
    expect(shortReason("Root vegetables are at their best in November, and cheap.")).toBe("");
    expect(shortReason("A warming dish that the whole school eats without complaint every single week.")).toBe("");
  });
});
