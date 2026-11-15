import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmMenuDraft } from "@/server/agent/menu/draft";
import { setMenuModelForTests } from "@/server/agent/menu/runtime";
import { MENU_SAY_TEXT } from "@/server/agent/menu/say.text";
import { scriptedPlanner } from "@/server/agent/menu/testing";
import { spoken } from "@/server/agent/menu/thread";
import { resetRuntime } from "@/server/runtime";
import { submitTurn, threadStore } from "./engine";
import { withCovers } from "./scenario";
import type { Card } from "./types";

async function turn(kitchen: string, text: string): Promise<{ cards: Card[]; line: string }> {
  const store = await threadStore();
  let id = "";
  const done = new Promise<void>((resolve) => {
    const off = store.subscribe(kitchen, (e) => {
      if (e.type === "status" && e.turnId === id && e.status !== "working") {
        off();
        resolve();
      }
    });
  });
  id = (await submitTurn(kitchen, { door: "typed", via: "typed", text, lang: "en" })).agentTurnId;
  await done;
  const a = store.agentTurn(store.peek(kitchen)!, id)!;
  return { cards: a.cards, line: a.line ?? "" };
}

const dish = (name: string, key: string, ing: string): LlmMenuDraft["dishes"][number] => ({
  name,
  nameFi: null,
  course: "main",
  serviceDate: null,
  portion: "1 plate",
  method: "Cooked.",
  ingredients: [{ key, name: ing, searchTerms: [ing.toLowerCase()], role: "the main", perCover: { amount: 250, unit: "ml" }, yieldPct: 100, amountBasis: "a portion", pantry: false, form: "any", avoid: [] }],
});
const THREE: LlmMenuDraft = {
  isFoodOrderRequest: true,
  declineReason: null,
  covers: 40,
  serviceDate: null,
  occasion: "lunch",
  requiredClaims: [],
  forbiddenAllergens: [],
  assumptions: ["Milk soup: mild and warming.", "Milk pudding: simple and quick.", "Milk porridge: cheap and filling."],
  conflicts: [],
  dishes: [dish("Milk soup", "milk", "Lactose-free milk"), dish("Milk pudding", "milk", "Lactose-free milk"), dish("Milk porridge", "milk", "Lactose-free milk")],
};

describe("a dish in the conversation, on a Sunday morning (the order times of the day passed for some products)", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T08:30:00Z")); // Sunday 15 Nov, 10:30 in Helsinki
  });
  afterAll(() => vi.useRealTimers());
  beforeEach(() => {
    resetRuntime();
    process.env.DOCK_MEMORY = "off";
  });
  afterEach(() => {
    setMenuModelForTests(undefined);
    delete process.env.DOCK_MEMORY;
  });

  it("asks once, offers three dishes in a list (not one), and a pick shows the dish", async () => {
    setMenuModelForTests(scriptedPlanner(THREE));
    const q = await turn("kaari", "Plan a dish for 40 covers for Friday.");
    expect(q.line).toMatch(/What are you in the mood for/);
    expect(q.line).not.toMatch(/say '|say "/i);
    const ideas = await turn("kaari", "Surprise me.");
    expect(ideas.line.split("\n").filter((x) => /^\d\. /.test(x))).toHaveLength(3);
    expect(ideas.line).toMatch(/Which one shall I plan\?$/);
    const picked = await turn("kaari", "The first one.");
    expect(picked.cards.some((c) => c.type === "dishes")).toBe(true);
    expect(picked.line).toMatch(/Milk soup/);
  }, 60_000);

  it("says plainly when only one dish fits, and a yes plans it", async () => {
    setMenuModelForTests(scriptedPlanner({ ...THREE, dishes: THREE.dishes.slice(0, 1), assumptions: THREE.assumptions.slice(0, 1) }));
    await turn("kaari", "Plan a dish for 40 covers for Friday.");
    const one = await turn("kaari", "Surprise me.");
    expect(one.line).toMatch(/^Only one dish came out that fits: Milk soup/);
    expect(one.line).toMatch(/Shall I plan it, or look for other ideas\?$/);
    const picked = await turn("kaari", "yes");
    expect(picked.cards.some((c) => c.type === "dishes")).toBe(true);
  }, 60_000);
});

describe("a plan asked for after the covers were given", () => {
  it("carries the covers and the day from the buyer's earlier words, never over a number they give now", () => {
    const run = (texts: string[]) => ({ thread: { turns: texts.map((text, i) => ({ role: "buyer", turnId: `b${i}`, text })) }, buyer: { turnId: `b${texts.length - 1}` } }) as never;
    expect(withCovers(run(["Plan a dish for 40 covers for Friday.", "Something warming with fish."]), "Something warming with fish.")).toBe("Something warming with fish, for 40 covers, for Friday");
    expect(withCovers(run(["Plan a dish for 40 covers for Friday.", "fish soup for 25 people"]), "fish soup for 25 people")).toBe("fish soup for 25 people");
    expect(withCovers(run(["what did we order?", "Something warming with fish."]), "Something warming with fish.")).toBe("Something warming with fish");
  });
  it("says the dishes without an empty place for the covers, and without a recipe's parentheses", () => {
    expect(MENU_SAY_TEXT.en.dishes(3, "", "Mon 16 Nov", "a, b and c")).toBe("On Mon 16 Nov, 3 dishes: a, b and c.");
    expect(MENU_SAY_TEXT.en.dishes(3, "40 covers", "Mon 16 Nov", "a, b and c")).toBe("For 40 covers on Mon 16 Nov, 3 dishes: a, b and c.");
    expect(MENU_SAY_TEXT.sv.dishes(1, "", "", "a")).toBe("en rätt, a.");
    expect(spoken("White fish fillet (pollock or saithe), skinless")).toBe("White fish fillet");
    expect(spoken("pollock or saithe), skinless")).toBe("pollock or saithe");
  });
});
