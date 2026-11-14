import { describe, expect, it } from "vitest";
import type { AgentTurn, OptionView } from "./types";
import { ackOf, milestoneOf, readBackOf, sayDay, sayEuros, speakable, spokenOf, spokenReply } from "./voice-spoken";

const turn = (over: Partial<AgentTurn>): AgentTurn => ({ turnId: "trn_a", role: "agent", at: "2026-11-14T10:00:00Z", replyTo: "trn_b", status: "done", steps: [], cards: [], ...over });
const option = (over: Partial<OptionView> = {}): OptionView => ({
  optionId: "opt1",
  rank: "good",
  title: "Valio Eila lactose-free milk drink 1 l",
  match: "full",
  givesUp: [],
  totalCents: 1140,
  deliveryDate: "2026-11-16",
  stockConfirmed: true,
  lines: [{ productId: "p1", name: "Valio Eila® lactose-free milk drink 1 l", quantity: 12, packSize: 1, unit: "L" }],
  delivered: { amount: 12, unit: "L" },
  reliability: null,
  co2Kg: null,
  signOff: [],
  pros: [],
  cons: [],
  reasons: [],
  ...over,
});

describe("the spoken form", () => {
  it("says money, days and units as a person says them, with no marks, codes or addresses", () => {
    const t = speakable("**1 000 × Valio Eila 1 l** for {{1 010,00 €}} arrives Mon 16 Nov. See https://dock.example/o/ord_abc123XYZ for the order ord_abc123XYZ.", "en");
    expect(t).not.toMatch(/\*\*|\{\{|https?:|ord_/);
    expect(t).toContain("1000 Valio Eila 1 litre");
    expect(t).toContain("1010 euros");
    expect(t).toContain("Monday the sixteenth of November");
    expect(speakable("Hinta on 11,40 € ja toimitus 16.11.", "fi")).toBe("Hinta on 11 euroa 40 senttiä ja toimitus 16. marraskuuta.");
    expect(sayEuros(101000, "en")).toBe("1010 euros");
    expect(sayDay("2026-11-16", "fi")).toBe("maanantaina 16. marraskuuta");
    expect(sayDay("2026-11-16", "sv")).toBe("måndag den 16 november");
  });

  it("is shorter than the written reply: whole sentences up to the limit, and says what the rest is", () => {
    const long = Array.from({ length: 8 }, (_, i) => `Sentence number ${i + 1} has quite a few words in it to read.`).join(" ");
    const t = speakable(long, "en", 30);
    expect(t.split(/\s+/).length).toBeLessThan(long.split(/\s+/).length);
    expect(t).toMatch(/The rest is written on your screen\.$/);
    expect(speakable("Tap the button below to order. I have three options.", "en")).toBe("I have three options.");
  });

  it("reads a held order back: how many of what, how much in all, the day and the total, then asks", () => {
    const a = turn({ turnId: "t1", status: "waiting_buyer", cards: [{ type: "options", cardId: "options:r1", requestId: "r1", options: [option()], excluded: [], notes: [] }] });
    const said = readBackOf(a, { requestId: "r1", optionId: "opt1", turnId: "t1" }, "en");
    expect(said).toBe("12 Valio Eila lactose-free milk drink, that's 12 litres, for Monday the sixteenth of November: 11 euros 40. Shall I order it?");
    expect(spokenOf(a, "fi", { requestId: "r1", optionId: "opt1", turnId: "t1" })).toMatch(/^12 Valio Eila .*maanantaina 16\. marraskuuta: 11 euroa 40 senttiä\. Tilaanko sen\?$/);
  });

  it("says what needs eyes or a finger, and summarises options instead of listing them", () => {
    const waiting = turn({ status: "waiting_approver", line: "Sent for an OK.", cards: [{ type: "gate", cardId: "gate:o1", requestId: "r1", orderId: "o1", outcome: "waiting", reasons: [], approver: { name: "Sanna Koskinen", role: "head chef" } }] });
    expect(spokenOf(waiting, "en")).toMatch(/needs Sanna Koskinen's OK: it's on their phone now/);
    const opts = turn({ status: "waiting_buyer", line: "I found milk for Monday.", cards: [{ type: "options", cardId: "options:r1", requestId: "r1", options: [option(), option({ optionId: "o2", totalCents: 990, title: "Arla lactose-free milk 1 l" }), option({ optionId: "o3", totalCents: 1500 })], excluded: [], notes: [] }] });
    // One question a yes answers, about the first option; the cheapest named when it is another.
    expect(spokenOf(opts, "en")).toBe("I found milk for Monday. 3 options. The first: Valio Eila lactose-free milk drink, 11 euros 40, for Monday the sixteenth of November; the cheapest is Arla lactose-free milk 1 l at 9 euros 90. Shall I order the first one?");
    const asked = spokenReply({ ...opts, line: "Three options. Which one would you like?" }, "en");
    expect(asked.say.match(/\?/g)).toHaveLength(1);
    expect(asked.hold).toEqual({ requestId: "r1", optionId: "opt1", turnId: "trn_a" });
  });

  it("acknowledges what the engine is really doing, from its running step, and says a long plan's milestone once", () => {
    const working = turn({ status: "working", steps: [{ stepId: "s1", kind: "read", label: "Reading your request", status: "done", startedAt: "" }, { stepId: "s2", kind: "lookup", label: "Checking live prices and the day", status: "running", startedAt: "" }] });
    expect(ackOf(working, "en")).toBe("Checking live prices and the day.");
    expect(ackOf(turn({ status: "working" }), "fi")).toBe("Hetki.");
    const plan = turn({ status: "working", cards: [{ type: "menu", cardId: "menu:p1", planId: "p1", stage: "proposing", proposals: [], covers: 40, days: [], dishes: [{ dishId: "d1", name: "Beetroot soup", lines: [] }, { dishId: "d2", name: "Salmon", lines: [] }] } as never] });
    const m = milestoneOf(plan, new Set(), "en");
    expect(m?.say).toBe("The dishes are in: Beetroot soup and Salmon. Pricing them now.");
    expect(milestoneOf(plan, new Set([m!.key]), "en")).toBeUndefined();
  });
});
