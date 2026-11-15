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

describe("which of a list the words pick", () => {
  it("reads the later ordinals before 'one', so 'the second one' is the second", async () => {
    const { ordinalIn, menuPickIn } = await import("./dish");
    expect(ordinalIn("The first one.")).toBe(0);
    expect(ordinalIn("the second one")).toBe(1);
    expect(ordinalIn("the third one please")).toBe(2);
    expect(ordinalIn("toinen")).toBe(1);
    expect(ordinalIn("den tredje")).toBe(2);
    expect(ordinalIn("that one")).toBe(0);
    expect(ordinalIn("can I ask one more question")).toBeUndefined();
    const menus = [["Creamy salmon soup with rye bread", "salmon soup"], ["Oven-baked pike-perch with dill sauce"], ["Tomato fish stew with white fish"]];
    expect(menuPickIn(menus, "The first one.")).toBe(0);
    expect(menuPickIn(menus, "the second one")).toBe(1);
    expect(menuPickIn(menus, "the pike-perch")).toBe(1);
    expect(menuPickIn(menus, "the stew")).toBeUndefined();
    expect(menuPickIn(menus, "tomato stew please")).toBe(2);
    expect(menuPickIn(menus, "something lighter")).toBeUndefined();
    expect(menuPickIn(menus.slice(0, 2), "the third one")).toBeUndefined();
  });
});

describe("'the first one' after the menus just offered", () => {
  it("picks among those menus, not an earlier order or its backup question in the conversation", async () => {
    const { menuPickAfter } = await import("./dish");
    const turns = [
      { role: "buyer", turnId: "b1", text: "1 box of rye rice pies for Tuesday" },
      { role: "agent", turnId: "a1", replyTo: "b1", line: "I've ordered 1 box … Want a backup lined up?", cards: [{ type: "options", cardId: "options:r1", requestId: "r1", options: [{ optionId: "o1" }], chosen: "o1" }, { type: "order", cardId: "order:o", orderId: "ord_1", status: "committed" }, { type: "backup", cardId: "backup:m", momentId: "m", state: "set", answers: [] }] },
      { role: "buyer", turnId: "b2", text: "Something warming with fish" },
      { role: "agent", turnId: "a2", replyTo: "b2", line: "I have three ideas …", cards: [{ type: "menu", cardId: "menu:p", planId: "plan_1", stage: "choose", proposals: [{ proposalId: "p1", title: "Creamy salmon soup", dishes: ["salmon soup"] }, { proposalId: "p2", title: "Pike-perch with dill sauce", dishes: [] }, { proposalId: "p3", title: "Tomato fish stew", dishes: [] }] }] },
      { role: "buyer", turnId: "b3", text: "The first one." },
      { role: "agent", turnId: "a3", replyTo: "b3", cards: [] },
    ] as never;
    expect(menuPickAfter(turns, "a3", "The first one.")).toEqual({ type: "menu_choose", planId: "plan_1", proposalId: "p1" });
    expect(menuPickAfter(turns, "a3", "the second one")).toEqual({ type: "menu_choose", planId: "plan_1", proposalId: "p2" });
    // The menus were offered further back: the newest reply is the order, so nothing is picked by code.
    const older = [turns[2], turns[3], turns[0], turns[1], turns[4], turns[5]];
    expect(menuPickAfter(older as never, "a3", "The first one.")).toBeUndefined();
  });
});
