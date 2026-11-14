import { describe, expect, it } from "vitest";
import type { OptionView, OptionsCard } from "@/server/thread/types";
import { roleLabelL } from "../../_i18n/format";
import { THREAD_WORDS } from "./thread-words.text";
import { approverFor, concernText, correctionLabel, fmtFor, gateReasons, leadOption, leadReasons, leftOutGroups, memoryText, oneThing, otherNotes, packsText, perUnitPrice, sharedQuiet, sharedSignoff, stepLabel, tradeOffs, usualNote } from "./thread-words";

/** Money and amounts keep their non-breaking spaces on screen; the tests read them as plain spaces. */
const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x).replace(/[\u00a0\u202f]/g, " "));

const en = { w: THREAD_WORDS.en, f: fmtFor("en") };
const fi = { w: THREAD_WORDS.fi, f: fmtFor("fi") };
const sv = { w: THREAD_WORDS.sv, f: fmtFor("sv") };

const USUAL = "Valio Eila® semi skimmed milk drink 10 l novobox lactose free";
const shared: OptionView["reasons"] = [
  { code: "over_limit", tone: "signoff" as const, params: { limitCents: 50000 } },
  { code: "stock_unconfirmed", tone: "quiet" as const, params: {} },
  { code: "instead_of_usual", tone: "quiet" as const, params: { product: USUAL } },
];
const option = (id: string, rank: string, title: string, totalCents: number, reasons: OptionView["reasons"], extra: Partial<OptionView> = {}): OptionView => ({
  optionId: id,
  rank,
  title,
  match: "full",
  givesUp: [],
  totalCents,
  deliveryDate: "2026-11-16",
  orderBy: "2026-11-15T17:00:00+0200",
  stockConfirmed: false,
  lines: [{ productId: id, name: title, quantity: 1000, packSize: 1, unit: "L", unitPriceCents: totalCents / 1000 }],
  delivered: { amount: 1000, unit: "L" },
  co2Kg: 1,
  reliability: null,
  signOff: ["Over the €500.00 the agent may spend alone: a person must sign off."],
  pros: [],
  cons: [],
  reasons: [...reasons, ...shared],
  category: "milk",
  ...extra,
});

// The coordinator's walk-through: 1,000 L of lactose-free milk at a kitchen whose usual 10 L box cannot make Monday.
const best = option("opt_1", "best", "Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free", 101000, [
  { code: "cheapest", tone: "pro", params: { lessCents: 55000 } },
  { code: "exact_amount", tone: "pro", params: { packs: "1000", packSize: 1, unit: "L" } },
  { code: "more_co2", tone: "con", params: { moreKg: 0.77 } },
]);
const better = option("opt_2", "better", "Valio semi skimmed milk 1 l lactose free UHT", 156000, [
  { code: "exact_amount", tone: "pro", params: { packs: "1000", packSize: 1, unit: "L" } },
  { code: "more_expensive", tone: "con", params: { moreCents: 55000, pct: 54.5 } },
]);
const good = option("opt_3", "good", "Arla Semi skimmed milkdrink 1 L UHT lactose free Suomesta + Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free (substitute)", 157448, [
  { code: "lowest_co2", tone: "pro", params: { lessKg: 0.77 } },
  { code: "more_expensive", tone: "con", params: { moreCents: 56448, pct: 55.9 } },
  { code: "partial_stock", tone: "con", params: { have: 384, rest: 616, unit: "L", product: "Arla Semi skimmed milkdrink 1 L UHT", substitute: "Valio Hyvä suomalainen Arki® Eila®" } },
]);
const why = "order cut-off Thu 12 Nov 15:00 has passed, so it cannot arrive Mon 16 Nov; the wholesaler's service names no later date yet";
const card: OptionsCard = {
  type: "options",
  cardId: "options:req_1",
  requestId: "req_1",
  options: [best, better, good],
  excluded: [
    { reason: "a different kind of product (coffee) than asked", count: 4, code: "compromise" },
    { reason: "a different kind of product (sour or fermented milk) than asked", count: 4, code: "compromise" },
    { reason: why, count: 6, code: "cutoff_passed" },
  ],
  notes: [`Your usual (${USUAL}) cannot do it: ${why}.`, `Same as last time (${USUAL}) is not possible: ${why}.`],
};

describe("the options as one decision", () => {
  it("leads with the agent's pick, else the first, and keeps the full name", () => {
    expect(leadOption(card).optionId).toBe("opt_1");
    expect(leadOption({ ...card, preselected: { optionId: "opt_2", reason: "" } }).optionId).toBe("opt_2");
    expect(leadOption(card).title).not.toContain("…");
  });

  it("says a sign-off every option shares once, and the stock and the usual as quiet facts, not drawbacks", () => {
    expect(sharedSignoff(card.options).map((r) => r.code)).toEqual(["over_limit"]);
    expect(sharedQuiet(card.options).map((r) => r.code)).toEqual(["stock_unconfirmed", "instead_of_usual"]);
    const t = tradeOffs(good, sharedSignoff(card.options), en.w, en.f);
    expect(t.signoff).toEqual([]);
    expect(plain(t.cons.join(" "))).not.toMatch(/Stock not|Over the|Instead of/);
    expect(plain(t.cons.join(" "))).toMatch(/Only 384 L of Arla/);
    expect(plain(t.cons.join(" "))).not.toMatch(/\b\d{6}\b/); // no product ids
  });

  it("gives the lead two short reasons, pros first", () => {
    expect(plain(leadReasons(best, en.w, en.f))).toEqual(["Cheapest: 550,00 € less than the next option", "Exactly the amount asked"]);
  });

  it("says the one thing another option differs in", () => {
    expect(plain(oneThing(better, best, en.w, en.f))).toBe("550,00 € more");
    expect(plain(oneThing(good, best, en.w, en.f))).toBe("Lowest carbon, 564,48 € more");
    expect(plain(oneThing(good, best, fi.w, fi.f))).toBe("Pienin hiilijalanjälki, 564,48 € kalliimpi");
  });

  it("says a split's substitute in the buyer's language", async () => {
    const { titleOf } = await import("./thread-words");
    expect(titleOf(good, fi.w)).toMatch(/\(korvaava\)$/);
    expect(titleOf(best, fi.w)).toBe(best.title);
  });

  it("shows packs and the price per litre", () => {
    expect(plain(packsText(best, en.w, en.f))).toBe("1 000 × 1 L");
    expect(plain(perUnitPrice(best, en.w, en.f))).toBe("1,01 €/l");
  });

  it("says the usual is not offered once, with why, in the buyer's language", () => {
    expect(plain(usualNote(card, en.w, "en"))).toBe(`Instead of your usual ${USUAL}: the order cut-off for that day has passed.`);
    expect(plain(usualNote(card, fi.w, "fi"))).toBe(`Tavallisen tuotteesi ${USUAL} sijaan: sen päivän tilausaika on mennyt.`);
    expect(plain(otherNotes(card, en.w, "en"))).toEqual([]);
  });

  it("collapses the left-out reasons into a few groups", () => {
    expect(plain(leftOutGroups(card, en.w, "en"))).toEqual([
      { label: "a different kind of product than asked", count: 8 },
      { label: "the order cut-off for that day has passed", count: 6 },
    ]);
  });

  it("sends an order over the limit to the first approver whose limit covers it", () => {
    const approvers = [
      { name: "Sanna Koskinen", role: "head_chef", maxApprovalCents: 100000 },
      { name: "Jari Mäkelä", role: "owner", maxApprovalCents: 500000 },
    ];
    expect(plain(approverFor(101000, approvers)?.name)).toBe("Jari Mäkelä");
    expect(plain(en.w.sendToSign("Jari Mäkelä", en.f.money(101000)))).toBe("Send to Jari Mäkelä to sign, 1 010,00 €");
  });
});

describe("no codes, and the buyer's language", () => {
  it("says roles in words", () => {
    for (const lang of ["en", "fi", "sv"] as const) expect(roleLabelL("kitchen_signer", lang)).not.toMatch(/_/);
    expect(roleLabelL("some_new_role", "en")).toBe("some new role");
  });

  it("translates the gate's reasons from its rules", () => {
    const rules = [
      { rule: "per_order_limit", outcome: "escalate", details: { limitCents: 50000, totalCents: 101000 } },
      { rule: "human_confirmation", outcome: "escalate", details: { flagged: ["quantity_tenfold"] } },
      { rule: "weekly_budget", outcome: "pass", details: { budgetCents: 200000 } },
    ];
    expect(plain(gateReasons(rules, [], en.w, en.f, "en"))).toEqual(["1 010,00 € is over the 500,00 € the agent may spend alone.", "The mistake check found something that a named person must confirm."]);
    expect(plain(gateReasons(rules, [], fi.w, fi.f, "fi")[0])).toBe("1 010,00 € on yli 500,00 €, jonka agentti saa käyttää yksin.");
    expect(plain(gateReasons(undefined, ["Total €1,010.00 is over the limit (kitchen_signer)."], fi.w, fi.f, "fi"))).toEqual([]);
  });

  it("translates the mistake check and its buttons", () => {
    const c = { key: "quantity_tenfold:1000:L", code: "quantity_tenfold", message: "1,000 L where you usually order about 100 L: did you mean 100 L?", confirmable: true, corrections: [{ id: "use_100_L", label: "Make it 100 L" }], evidence: { usualAmount: 100, unit: "L", basedOnOrders: 6, asked: { amount: 1000, unit: "L" } } };
    expect(plain(concernText(c, fi.w, fi.f, "fi"))).toBe("1 000 L, kun tilaat yleensä noin 100 L: tarkoititko 100 L?");
    expect(plain(concernText(c, sv.w, sv.f, "sv"))).toBe("1 000 L när du brukar beställa cirka 100 L: menade du 100 L?");
    expect(plain(correctionLabel(c.corrections[0], fi.w, fi.f, "fi"))).toBe("Muuta: 100 L");
    expect(plain(correctionLabel({ id: "deliver_2026-11-16", label: "Earliest possible delivery: Mon 16 Nov" }, sv.w, sv.f, "sv"))).toBe("Leverans mån 16.11.");
  });

  it("says what memory used in one line, in the buyer's language", () => {
    const applied = { itemId: "mem_1", text: "Lactose-free applied: stated by Kitchen manager on 27 Oct", code: "applied", params: { kind: "diet", claim: "lactose_free", label: "Lactose-free", how: "stated", by: "Kitchen manager", at: "2026-10-27" } };
    expect(plain(memoryText(applied, en.w, en.f, "en"))).toBe("Lactose-free, as always (Kitchen manager, Tue 27.10.)");
    expect(plain(memoryText(applied, fi.w, fi.f, "fi"))).toBe("Laktoositon, kuten aina (Kitchen manager, ti 27.10.)");
    const learned = { text: "Semi-skimmed (1.5 %) pre-selected: Semi-skimmed (1.5 %): 10 of your last 10 milk orders", code: "preselected", params: { kind: "learned", label: "Semi-skimmed (1.5 %)", dimension: "fat", choice: "fat_1_5" } };
    expect(plain(memoryText(learned, sv.w, sv.f, "sv"))).toBe("Lätt 1,5 %, som vanligt");
    // A line with no data is shown only in English, never as English inside a Finnish thread.
    expect(memoryText("Something remembered", fi.w, fi.f, "fi")).toBeUndefined();
  });

  it("labels live steps in the buyer's language", () => {
    expect(plain(stepLabel({ kind: "intake", label: "Checking against your history and the assortment" }, fi.w, "fi"))).toBe("Tarkistan historiaasi ja valikoimaa vasten");
    expect(plain(stepLabel({ kind: "tool:read_mandate", label: "Reading your mandate" }, sv.w, "sv"))).toBe("Tänker efter");
  });

  it("has every reason code in every language", () => {
    for (const k of Object.keys(THREAD_WORDS.en.reason)) {
      expect(THREAD_WORDS.fi.reason[k], k).toBeTypeOf("function");
      expect(THREAD_WORDS.sv.reason[k], k).toBeTypeOf("function");
    }
    for (const k of Object.keys(THREAD_WORDS.en.concern)) expect(THREAD_WORDS.fi.concern[k], k).toBeTypeOf("function");
  });
});
