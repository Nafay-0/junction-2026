import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MailTransport, OutgoingMail } from "@/server/notify/transport";
import { getRuntime, resetRuntime, type Runtime } from "@/server/runtime";
import { viewAs } from "./clock";
import { isSampleOrder, markRows, sampleSets, setOfEntry } from "./marks";
import { refreshSample, sampleStatus, startSampleActivity } from "./start";
import { playStory, type SeedReport } from "./story";

// What can be ordered depends on the clock (order cut-offs, delivery days, what the kitchen's history says is left):
// a fixed weekday morning (Friday 13 Nov, 11.00 in Helsinki), so a run on a Sunday, a Thursday or late in the evening
// tests the same thing (on those, the seed's two-day lead and passed cut-offs change what the menu can buy).
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-13T09:00:00Z"));
});
afterAll(() => vi.useRealTimers());


/**
 * The sample week, played once on a fresh in-process runtime (seed catalogue, no network, no model), then read back
 * through the same view functions the pages use. Under tests the seed never starts by itself (start.ts); this test
 * asks for it.
 */
let rt: Runtime;
let report: SeedReport;
let firstSeq: number;
const sent: OutgoingMail[] = [];

beforeAll(async () => {
  resetRuntime();
  Object.assign(process.env, { DOCK_MEMORY_LLM: "off", DOCK_RATE_LIMITS: "off", DOCK_RELIABILITY_WARN: "0.95" });
  delete process.env.DOCK_SAMPLE_ACTIVITY;
  rt = await getRuntime();
  // A transport that would send: the sample must never reach it.
  const spy: MailTransport = { name: "spy", send: async (m) => (sent.push(m), { ok: true, id: `spy-${sent.length}`, attempts: 1 }) };
  (await import("@/server/notify/service")).setMailTransport(rt, spy);
  firstSeq = rt.dock.ledger.length;
  report = await playStory(rt, { slowTurnMs: 0 });
}, 120_000);

const views = async () => {
  const [{ ordersPage }, { agentScorecard }, { mailView }, { offersView }, { watchView }, { conversationList }, { wallSnapshot }] = await Promise.all([
    import("@/server/ops/orders-view"),
    import("@/server/ops/agent-watch"),
    import("@/server/notify/service"),
    import("@/server/offers/service"),
    import("@/server/watch/service"),
    import("@/server/ops/conversation"),
    import("@/server/wall-snapshot"),
  ]);
  return {
    orders: await ordersPage(rt, { size: 200 }),
    score: await agentScorecard(rt, "today", { source: "ledger" }),
    mail: await mailView(rt),
    offers: await offersView(rt),
    watch: await watchView(rt),
    convs: conversationList(rt, 100),
    // The wall (/) is a public page: it always shows the sample (it has no viewer switch).
    wall: await wallSnapshot(rt),
  };
};

describe("the sample activity", () => {
  it("plays every beat, quickly, without the network", () => {
    const failed = report.beats.filter((b) => !b.ok).map((b) => `${b.name}: ${b.detail}`);
    expect(failed).toEqual([]);
    expect(report.beats.length).toBeGreaterThan(35);
    expect(report.ms).toBeLessThan(20_000);
  });

  it("flags every entry it wrote as sample", () => {
    const written = rt.dock.ledger.unfiltered().slice(firstSeq);
    const unflagged = written.filter((e) => !setOfEntry(rt.dock.ledger, e)).map((e) => `${e.type}: ${e.summary.slice(0, 100)}`);
    expect(unflagged).toEqual([]);
    expect(sampleSets(rt.dock.ledger).map((s) => s.set)).toEqual([report.setId]);
    expect(rt.dock.ledger.verifyFull().ok).toBe(true);
  });

  it("puts orders from every source, decided and ended every way, on the Orders page", async () => {
    const { orders } = await views();
    const sources = new Set(orders.facets.sources.map((s) => s.id));
    for (const s of ["conversation", "voice", "mcp", "rest", "aiven_agent", "watch_renewal", "watch_substitute", "offer", "backup"]) expect(sources, s).toContain(s);
    const statuses = new Map(orders.facets.statuses.map((s) => [s.id, s.n]));
    for (const s of ["committed", "pending_approval", "declined", "expired", "rejected", "withdrawn", "replaced"]) expect(statuses.get(s as never) ?? 0, s).toBeGreaterThan(0);
    expect(statuses.get("pending_approval")).toBeGreaterThanOrEqual(2);
    const decided = new Set(orders.rows.map((r) => r.decided.kind));
    for (const k of ["alone", "person", "refused"]) expect(decided).toContain(k);
    const refusedBy = new Set(orders.rows.filter((r) => r.decided.kind === "refused").map((r) => r.decided.words));
    for (const rule of ["forbidden_allergens", "nutrition_rules", "weekly_budget", "quote_replay"]) expect([...refusedBy].some((w) => w.includes(rule)), rule).toBe(true);
    // Refused before the policy: a forged mandate.
    const refusals = rt.dock.ledger.unfiltered().filter((e) => e.type === "refusal").map((e) => JSON.stringify(e.data));
    expect(refusals.some((d) => d.includes("mandate_signature_invalid")), JSON.stringify(rt.dock.ledger.unfiltered().filter((e) => (e.data.sample as { beat?: string } | undefined)?.beat?.includes("forged")).map((e) => [e.type, e.summary, e.data]))).toBe(true);
    // Every row the page lists is a sample row (the store had nothing else).
    expect(orders.rows.every((r) => isSampleOrder(rt.dock.ledger, r))).toBe(true);
    // Waiting right now, of different ages.
    const waiting = orders.rows.filter((r) => r.status === "pending_approval" && r.waitingSinceAt).map((r) => Math.round((Date.now() - Date.parse(r.waitingSinceAt!)) / 60_000));
    expect(new Set(waiting).size).toBeGreaterThanOrEqual(2);
  });

  it("answers the mistake check both ways and changes rules over the week", () => {
    const all = rt.dock.ledger.unfiltered();
    const tenfold = (id: string) => all.some((e) => e.requestId && all.some((o) => o.orderId === id && o.requestId === e.requestId) && JSON.stringify(e.data).includes("quantity_tenfold"));
    expect(tenfold(report.ids.mistakeFixed)).toBe(true);
    expect(tenfold(report.ids.mistakeConfirmed)).toBe(true);
    expect(all.some((e) => e.data.step === "mandate_reissued")).toBe(true);
    const control = all.filter((e) => e.type === "control" && /partner_02/.test(e.summary));
    expect(control.some((e) => /suspended/.test(e.summary))).toBe(true);
    expect(control.some((e) => /resumed/.test(e.summary))).toBe(true);
    // Spread over the week, the latest minutes old.
    const ats = all.slice(firstSeq).map((e) => Date.parse(e.at));
    expect(Date.now() - Math.min(...ats)).toBeGreaterThan(5 * 86_400_000);
    expect(Date.now() - Math.max(...ats)).toBeLessThan(10 * 60_000);
  });

  it("gives the watch, the selling agent, mail, conversations, the scorecard and the wall something to show", async () => {
    const v = await views();
    expect(v.watch.findings.some((f) => f.substitutes.length > 0)).toBe(true);
    expect(v.watch.renewals.some((r) => r.state === "held")).toBe(true);
    expect(v.watch.renewals.some((r) => r.state === "placed")).toBe(true);
    expect(v.watch.stats.staged).toBeGreaterThan(0);
    expect(v.offers.stats.accepted).toBeGreaterThan(0);
    expect(v.offers.stats.declined).toBeGreaterThan(0);
    expect(v.offers.stats.muted).toBeGreaterThan(0);
    expect(v.offers.stats.withheld).toBeGreaterThan(0);
    expect(v.offers.campaigns.length).toBeGreaterThan(0);
    expect(v.mail.mails.some((m) => m.kind === "receipt")).toBe(true);
    expect(v.convs.length).toBeGreaterThanOrEqual(9);
    expect(v.convs.some((c) => /Tarvitsemme/.test(c.lastWords ?? ""))).toBe(true);
    const status = new Set(v.score.rows.map((r) => r.status));
    for (const s of ["performing", "escalating", "failing", "quiet"]) expect(status, s).toContain(s);
    expect(v.score.rows.find((r) => r.agentId === "agent_laakso_partner_02")?.status).toBe("failing");
    expect(v.wall.feed.length).toBeGreaterThan(0);
  });

  it("marks sample rows in what the operations pages read", async () => {
    const { offers, watch, mail } = await views();
    const marked = markRows(rt.dock.ledger, { offers: offers.offers, findings: watch.findings, mails: mail.mails }, false) as Record<string, { sample?: boolean }[]>;
    for (const k of ["offers", "findings", "mails"]) expect(marked[k].length > 0 && marked[k].every((r) => r.sample === true), k).toBe(true);
    expect(sampleStatus(rt).ids.approved).toBe(report.ids.approved);
  });

  it("touches a test kitchen only with what changes nothing for the next person: a refusal, marked", async () => {
    const { resolveKitchen } = await import("@/server/console-kitchens");
    const { overview } = await import("@/server/kitchen-portal");
    for (const slug of ["hotel-lumo", "koulu-metsola", "kahvila-sointu"]) {
      const o = await overview((await resolveKitchen(slug)) as never);
      // No order of the sample was placed there: no spend against the week, nothing in the kitchen's memory.
      expect(o.orders.filter((x) => x.sample && x.status !== "rejected" && x.status !== "withdrawn"), slug).toEqual([]);
    }
    const m = await overview((await resolveKitchen("koulu-metsola")) as never);
    expect(m.orders.filter((x) => x.sample).map((x) => x.status)).toEqual(["rejected"]);
    // Nor in the demo kitchens: Kaari's and Laakso's books and memory are their own.
    for (const orgId of ["org_ravintola_kaari", "org_laakso_catering"]) expect((await rt.dock.listOrders({ orgId })).filter((o) => isSampleOrder(rt.dock.ledger, o) && (o.status === "committed" || o.status === "pending_approval")), orgId).toEqual([]);
  });

  it("hides all of it for a viewer who hides the sample", async () => {
    const hidden = await viewAs({ hideSample: true }, views);
    expect(hidden.orders.total).toBe(0);
    expect(hidden.convs).toEqual([]);
    expect(hidden.score.rows.every((r) => r.status === "quiet")).toBe(true);
    const rows = markRows(rt.dock.ledger, { offers: hidden.offers.offers, findings: hidden.watch.findings, mails: hidden.mail.mails }, true) as Record<string, unknown[]>;
    expect(rows.offers).toEqual([]);
    expect(rows.findings).toEqual([]);
    expect(rows.mails).toEqual([]);
  });

  it("sends no mail and calls no model", () => {
    expect(sent).toEqual([]);
    const sample = rt.dock.ledger.unfiltered().slice(firstSeq);
    expect(sample.filter((e) => e.type === "agent" && e.data.event === "model_call")).toEqual([]);
    // Conversations are records: their turns are in the ledger, under threads of their own.
    expect(sample.filter((e) => e.type === "agent" && e.data.event === "turn").length).toBeGreaterThanOrEqual(9);
  });

  it("leaves nothing open in a kitchen a person can sign into", async () => {
    const { threadStore, submitTurn } = await import("@/server/thread/engine");
    const { setAgentModelForTests } = await import("@/server/thread/agent");
    const { watchView } = await import("@/server/watch/service");
    const store = await threadStore();
    const stages = (await watchView(rt)).stages.filter((g) => !g.liftedAt);
    for (const slug of ["hotel-lumo", "koulu-metsola", "kahvila-sointu", "kaari"]) {
      const orgId = slug === "kaari" ? "org_ravintola_kaari" : (await rt.accounts.kitchenOf(slug))!.kitchen!.orgId;
      // No live conversation was written to: no turn, card, question or draft for a person's words to be read against.
      expect(store.peek(slug)?.turns.length ?? 0, slug).toBe(0);
      // Nothing of the sample waits there for a sign-off, and nothing is staged there.
      expect((await rt.dock.pendingOrders(orgId)).filter((o) => isSampleOrder(rt.dock.ledger, o)), slug).toEqual([]);
      expect(stages.filter((g) => g.orgId === orgId), slug).toEqual([]);
    }
    // A person signs in to each test kitchen and says "Monday is fine": a new message, with nothing pending.
    for (const slug of ["hotel-lumo", "koulu-metsola", "kahvila-sointu"]) {
      const prompts: string[] = [];
      const model = {
        specificationVersion: "v4", provider: "test", modelId: "capture", supportedUrls: {},
        async doGenerate() { throw new Error("streamed only"); },
        async doStream(o: { prompt: { role: string; content: unknown }[] }) {
          prompts.push(o.prompt.filter((m) => m.role === "system").map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n"));
          const parts = [{ type: "stream-start", warnings: [] }, { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "What would you like for Monday?" }, { type: "text-end", id: "t" }, { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: { inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 0, text: 0, reasoning: undefined } } }];
          return { stream: new ReadableStream({ start: (c) => (parts.forEach((p) => c.enqueue(p)), c.close()) }) };
        },
      };
      setAgentModelForTests({ model: model as never, id: "test:capture" });
      const before = rt.dock.ledger.length;
      const orders = (await rt.dock.listOrders()).length;
      let id = "";
      const done = new Promise<void>((resolve) => {
        const off = store.subscribe(slug, (e) => {
          if (e.type === "status" && e.turnId === id && e.status !== "working") {
            off();
            resolve();
          }
        });
      });
      id = (await submitTurn(slug, { door: "typed", via: "typed", text: "Monday is fine" })).agentTurnId;
      await done;
      setAgentModelForTests(undefined);
      expect(prompts.length, slug).toBeGreaterThan(0);
      expect(prompts[0], slug).toContain("OPEN DECISIONS: none.");
      // Nothing of the sample was touched or placed by it.
      const after = rt.dock.ledger.unfiltered().slice(before);
      expect(after.filter((e) => (e.requestId && isSampleOrder(rt.dock.ledger, { orderId: e.orderId ?? "", requestId: e.requestId })) || (e.orderId && isSampleOrder(rt.dock.ledger, { orderId: e.orderId }))), slug).toEqual([]);
      expect((await rt.dock.listOrders()).length, slug).toBe(orders);
      store.reset(slug, (await rt.accounts.kitchenOf(slug))!.kitchen!.orgId);
    }
  }, 60_000);

  it("is idempotent at start, and a refresh supersedes the older set without removing anything", async () => {
    process.env.DOCK_SAMPLE_ACTIVITY = "once";
    startSampleActivity(rt);
    process.env.DOCK_SAMPLE_ACTIVITY = "on"; // the ledger has activity in the last day: nothing either
    startSampleActivity(rt);
    await new Promise((r) => setTimeout(r, 600));
    expect(sampleSets(rt.dock.ledger).length).toBe(1);
    const length = rt.dock.ledger.length;
    const before = (await views()).orders.total;
    const fresh = await refreshSample(rt, "Test staff");
    expect(rt.dock.ledger.length).toBeGreaterThan(length);
    const sets = sampleSets(rt.dock.ledger);
    expect(sets.map((s) => !!s.superseded), JSON.stringify(sets)).toEqual([true, false]);
    expect(sets[1].set).toBe(fresh!.setId);
    const after = await views();
    // Only the new set shows: every order on the page is the new set's.
    expect(after.orders.rows.every((r) => setOfEntry(rt.dock.ledger, { data: {}, orderId: r.orderId, requestId: r.requestId }) === fresh!.setId)).toBe(true);
    expect(after.orders.total).toBeGreaterThan(before / 2);
    delete process.env.DOCK_SAMPLE_ACTIVITY;
  }, 60_000);
});
