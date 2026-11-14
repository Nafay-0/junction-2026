import { beforeEach, describe, expect, it } from "vitest";
import { forbiddenBy } from "@/core/offers";
import { getMemoryService, resetMemoryService } from "@/server/memory/runtime";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { defaultsOf, nextQuestion, parseAnswers, termsFrom, knownFrom, SAFE_DEFAULTS, type InterviewAnswers } from "../accounts/interview";
import { finishInterview } from "../accounts/interview-run";
import { ACCOUNT_COOKIE } from "../accounts/http";
import { decide } from "../memory/decide";
import { fromEvents } from "../memory/signals";
import { emptyProfile } from "@/core/kitchen";
import { chooseStart, deleteAccount, guideFor, restartAccount, stageForAccount } from "./service";
import { SAMPLE_PREFIX } from "./sample";

/**
 * Demo accounts (server/demo): an interview that can be answered, said "none" to or left for later; the safe
 * defaults; a sample history that keeps the account's own rules; staging confined to the account's own kitchen; start
 * over; delete; and the agent proposing a rule from what the kitchen orders, never applying it alone.
 */

const ADDR = "198.51.100.77";

beforeEach(() => {
  resetRuntime();
  resetMemoryService();
  process.env.DOCK_CATALOG = "seed";
  process.env.DOCK_MEMORY_LLM = "off";
  delete process.env.DOCK_DEMO_ACCOUNTS;
});

async function account(username: string, answers: InterviewAnswers, restaurant = `Ravintola ${username}`) {
  const rt = await getRuntime();
  const s = await rt.accounts.signUp({ restaurant, username, password: `a long enough passphrase ${username}` }, ADDR);
  await finishInterview(rt, (await rt.accounts.get(username))!, answers);
  return { rt, cookie: `${ACCOUNT_COOKIE}=${s.token}`, a: async () => (await rt.accounts.get(username))! };
}

describe("the interview: an answer, none, or decide later", () => {
  const known = knownFrom("Ravintola Aalto");

  it("every question about rules offers none and decide later; none to the first offers skip the rest", () => {
    const q = nextQuestion({}, known)!;
    expect(q.id).toBe("diet");
    expect(q.alternatives).toEqual(["none", "later"]);
    expect(q.offerSkip).toBeUndefined();
    const next = nextQuestion({ diet: [] }, known)!;
    expect(next).toMatchObject({ id: "allergens", alternatives: ["none", "later"], offerSkip: true });
    // A real rule given: no skip offered any more.
    expect(nextQuestion({ diet: ["lactose_free"] }, known)!.offerSkip).toBeUndefined();
    expect(nextQuestion({ diet: [], allergens: [], days: [2, 5], usualEur: 300 }, known)).toMatchObject({ id: "limitEur", defaultAmount: SAFE_DEFAULTS.perOrderLimitEur });
  });

  it('"none" to the first rules question, then skip the rest: the safe defaults, said as defaults', () => {
    const a = parseAnswers({ diet: [], skipRest: true });
    expect(nextQuestion(a, known)).toBeUndefined();
    const t = termsFrom(a, known);
    expect(t.perOrderLimitEur).toBe(SAFE_DEFAULTS.perOrderLimitEur);
    expect(t.weeklyBudgetEur).toBe(SAFE_DEFAULTS.weeklyBudgetEur);
    expect(t.groups).toEqual(expect.arrayContaining([...SAFE_DEFAULTS.groups]));
    expect(t.groups).not.toContain("84"); // no alcohol
    expect(t.forbid).toEqual([]);
    expect(t.require).toEqual([]);
    expect(t.signer).toBe(SAFE_DEFAULTS.signer);
    const d = defaultsOf(a);
    expect(d.none).toBe(true);
    expect(d.defaults).toEqual(expect.arrayContaining(["groups", "limitEur", "budgetEur", "diet", "allergens", "days"]));
    expect(d.later).toEqual(["allergens", "days", "usualEur", "limitEur", "budgetEur"]);
  });

  it("decide later on amounts: the defaults now; real answers: exactly those", () => {
    const later = termsFrom(parseAnswers({ diet: "later", allergens: ["nuts"], days: "later", usualEur: "later", limitEur: "none", budgetEur: "later", signer: "Aino" }), known);
    expect(later).toMatchObject({ perOrderLimitEur: 250, weeklyBudgetEur: 6000, forbid: ["nuts"], require: [], signer: "Aino" });
    const real = termsFrom(parseAnswers({ diet: ["lactose_free"], allergens: ["sesame"], days: [1, 4], usualEur: 400, limitEur: 600, budgetEur: 2000, signer: "Aino" }), known);
    expect(real).toMatchObject({ perOrderLimitEur: 600, weeklyBudgetEur: 2000, require: ["lactose_free"], forbid: ["sesame"] });
    expect(defaultsOf(parseAnswers({ diet: ["lactose_free"], allergens: ["sesame"], days: [1, 4], usualEur: 400, limitEur: 600, budgetEur: 2000, signer: "Aino" }))).toMatchObject({ defaults: [], later: [], none: false });
  });

  it("the signed kitchen: a demo account, its onboarding terms and answers kept for start over, and the ledger says defaults", async () => {
    const { rt, a } = await account("aalto", { diet: [], skipRest: true });
    const acc = await a();
    expect(acc.demo).toBeTruthy();
    expect(acc.demo?.onboarded?.perOrderLimitEur).toBe(250);
    expect(rt.accounts.view(acc).demo).toBe(true);
    const e = rt.dock.ledger.entries().find((x) => x.data.step === "setup_interview")!;
    expect(e.summary).toMatch(/set no limits of its own: the safe defaults/);
    expect(e.data).toMatchObject({ skippedRest: true });
  });
});

describe("the starting point", () => {
  it("a sample history: weekly orders, one creeping up, one with a poor record, variety; all inside the account's rules, all labelled sample", async () => {
    const { rt, a } = await account("sointu", { diet: [], allergens: ["sesame"], days: [2, 5], usualEur: 300, limitEur: 400, budgetEur: 3000, signer: "Aino" });
    const r = await chooseStart(rt, await a(), "sample");
    expect(r.start).toBe("sample");
    const s = r.sample!;
    expect(s.weekly.length).toBeGreaterThanOrEqual(1);
    expect(s.orders).toBeGreaterThan(10);
    const k = (await a()).kitchen!;
    const profile = (await rt.kitchens.getProfile(k.orgId))!;
    expect(profile.history.length).toBe(s.orders);
    expect(profile.history.every((h) => h.sample && h.orderId.startsWith(SAMPLE_PREFIX))).toBe(true);
    const products = await rt.catalog.searchProducts({ ids: [...new Set(profile.history.flatMap((h) => h.lines.map((l) => l.productId)))], limit: 100 });
    for (const p of products) expect(forbiddenBy(p, { mandate: k.mandate, profile: undefined }, new Date())).toBeUndefined();
    // Not in the wholesaler's books: no gate order exists for it.
    expect(await rt.dock.listOrders({ orgId: k.orgId })).toEqual([]);
    // Chosen once: a second choice changes nothing.
    expect((await chooseStart(rt, await a(), "empty")).start).toBe("sample");
    expect(rt.dock.ledger.entries().some((e) => e.data.step === "demo_start" && e.data.sample === true)).toBe(true);
  });

  it("a kitchen that rules out milk gets no dairy in its sample", async () => {
    const { rt, a } = await account("maidoton", { diet: [], allergens: ["milk"], days: [1, 4], usualEur: 300, limitEur: 400, budgetEur: 3000, signer: "Aino" });
    await chooseStart(rt, await a(), "sample");
    const k = (await a()).kitchen!;
    const profile = (await rt.kitchens.getProfile(k.orgId))!;
    const products = await rt.catalog.searchProducts({ ids: [...new Set(profile.history.flatMap((h) => h.lines.map((l) => l.productId)))], limit: 100 });
    for (const p of products) expect(p.allergens ?? []).not.toContain("milk");
  });

  it("empty: no history", async () => {
    const { rt, a } = await account("tyhja", { diet: [], skipRest: true });
    await chooseStart(rt, await a(), "empty");
    expect((await rt.kitchens.getProfile((await a()).kitchen!.orgId))!.history).toEqual([]);
  });
});

describe("staging is for the account's own kitchen only", () => {
  it("a stock-out of one of its weekly products, its creeping portions, a poor-record product: marked staged, in the ledger, nobody else's", async () => {
    const one = await account("yksi", { diet: [], skipRest: true });
    const two = await account("kaksi", { diet: [], skipRest: true });
    await chooseStart(one.rt, await one.a(), "sample");
    await chooseStart(two.rt, await two.a(), "sample");
    const rt = one.rt;
    const s = await stageForAccount(rt, await one.a(), "stock_out");
    expect(s.summary).toMatch(/staged for the demo/);
    const { stagedFor } = await import("../watch/overlay");
    expect(stagedFor(rt.dock, (await one.a()).kitchen!.orgId).length).toBe(1);
    expect(stagedFor(rt.dock, (await two.a()).kitchen!.orgId).length).toBe(0);
    const entry = rt.dock.ledger.entries().find((e) => e.data.step === "staged" && e.actor === "account:yksi")!;
    expect(entry.summary).toMatch(/STAGED for the demo/);
    const p = await stageForAccount(rt, await one.a(), "poor_record");
    expect(p.productName).toBeTruthy();
    // A kitchen without the demo mark is never staged for.
    const own = await account("oma", { diet: [], skipRest: true });
    const acc = await own.a();
    await rt.accounts.store.put({ ...acc, demo: undefined });
    await expect(stageForAccount(rt, (await own.a())!, "stock_out")).rejects.toMatchObject({ status: 403 });
    const watch = await import("../watch/service");
    await expect(watch.stageStockOut(rt, { kitchen: "oma", productId: "VA-1001", by: "staff" })).rejects.toMatchObject({ status: 403 });
  });

  it("is capped per account per day", async () => {
    process.env.DOCK_DEMO_STAGINGS_PER_DAY = "30";
    const { rt, a } = await account("raja", { diet: [], skipRest: true });
    await chooseStart(rt, await a(), "sample");
    const acc = await a();
    await rt.accounts.store.put({ ...acc, demo: { ...acc.demo!, staged: Array.from({ length: 30 }, () => ({ at: new Date().toISOString(), kind: "poor_record" })) } });
    await expect(stageForAccount(rt, await a(), "poor_record")).rejects.toMatchObject({ status: 429, code: "demo_staging_limit" });
  });
});

describe("start over and delete", () => {
  it("start over: a fresh kitchen with the onboarding rules and a fresh sample, the stage lifted, the ledger kept and the reset in it", async () => {
    const { rt, a } = await account("alusta", { diet: [], skipRest: true });
    await chooseStart(rt, await a(), "sample");
    const before = (await a()).kitchen!;
    await stageForAccount(rt, await a(), "stock_out");
    const length = rt.dock.ledger.length;
    const r = await restartAccount(rt, await a());
    const after = (await a()).kitchen!;
    expect(after.orgId).not.toBe(before.orgId);
    expect(after.terms.perOrderLimitEur).toBe(250);
    expect(r.start).toBe("sample");
    const { stagedFor } = await import("../watch/overlay");
    expect(stagedFor(rt.dock, before.orgId)).toEqual([]);
    expect(rt.dock.ledger.length).toBeGreaterThan(length);
    expect(rt.dock.ledger.entries().some((e) => e.data.step === "demo_reset" && e.data.oldOrgId === before.orgId)).toBe(true);
    expect((await rt.kitchens.getProfile(after.orgId))!.history.every((h) => h.sample)).toBe(true);
    expect(rt.dock.ledger.verify().ok).toBe(true);
  });

  it("delete: the account and its sessions go, the ledger stays", async () => {
    const { rt, a, cookie } = await account("pois", { diet: [], skipRest: true });
    const n = rt.dock.ledger.length;
    await deleteAccount(rt, await a());
    expect(await rt.accounts.get("pois")).toBeUndefined();
    expect(await rt.accounts.session(cookie.split("=")[1])).toBeUndefined();
    expect(rt.dock.ledger.length).toBeGreaterThan(n);
    expect(rt.dock.ledger.entries().some((e) => e.data.step === "account_deleted")).toBe(true);
  });
});

describe("the guide", () => {
  it("every row, in order, nothing ticked on a fresh account; staging names its setup", async () => {
    const { rt, a } = await account("opas", { diet: [], skipRest: true });
    await chooseStart(rt, await a(), "sample");
    const g = await guideFor(rt, await a());
    expect(g.rows.map((r) => r.id)).toEqual(["flow", "signoff", "mistake", "refusal", "widen", "learn", "menu", "stockout", "drift", "offer", "backup", "email", "voice_photo", "receipt", "outside", "ops"]);
    expect(g.done).toBe(0);
    expect(g.next).toBe("flow");
    expect(g.rows.find((r) => r.id === "stockout")!.setup).toMatchObject({ action: "stock_out", ready: true });
    expect(g.facts.sample).toBe(true);
    expect(g.facts.usual?.tenTimes).toBeGreaterThan(0);
  });
});

describe("the agent proposes a rule from what the kitchen orders, and never applies it alone", () => {
  it("lactose-free asked for in three orders: one question, a rule only after yes", () => {
    let profile = emptyProfile("org_x", "X");
    const order = (n: number) => ({ id: `int_${n}`, at: new Date().toISOString(), door: "typed" as const, by: "Aino", segments: [], events: [{ type: "answer" as const, family: "milk", questionId: "dim:lactose", optionId: "lactose_free" }] });
    const outcomes = [];
    for (let i = 1; i <= 3; i++) {
      const r = decide(profile, fromEvents(order(i)), order(i), new Date());
      profile = r.profile;
      outcomes.push(...r.outcomes);
    }
    const confirm = outcomes.filter((o) => o.action === "confirm");
    expect(confirm).toHaveLength(1);
    expect(confirm[0].question).toMatch(/^You've asked for lactose-free.* 3 times\. Shall I treat that as a standing rule\?$/i);
    const pending = profile.memory!.items.find((m) => m.status === "pending_confirmation")!;
    expect(pending.strength).toBe("rule");
    // A fourth order does not ask again.
    const r4 = decide(profile, fromEvents(order(4)), order(4), new Date());
    expect(r4.outcomes.some((o) => o.action === "confirm")).toBe(false);
  });

  it("through the memory writer of a new account: the question comes back as one to confirm", async () => {
    const { rt, a } = await account("oppiva", { diet: [], skipRest: true });
    void rt;
    const memory = await getMemoryService();
    const orgId = (await a()).kitchen!.orgId;
    let questions: { question: string }[] = [];
    for (let i = 1; i <= 3; i++) {
      const r = await memory.write(orgId, { door: "typed", by: "Aino", segments: [], events: [{ type: "answer", family: "milk", questionId: "dim:lactose", optionId: "lactose_free" }] });
      questions = r.questions;
    }
    expect(questions).toHaveLength(1);
    expect(questions[0].question).toMatch(/standing rule/);
  });
});
