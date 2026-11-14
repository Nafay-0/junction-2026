import { describe, expect, it } from "vitest";
import { languageOf } from "@/server/aiven/actions";
import { sampleDay } from "./scorecard-fixture";
import { auditSearchBody, auditSql, eventDoc, parseAuditQuery } from "@/server/aiven/search/event-index";
import { ALERT_RULES, AlertBook, evaluateAlerts, type AlertInputs } from "./alerts";
import { figuresFromEvents, figuresFromRow, judgeAgent, percentileCont, scorecardSql, type AgentFigures } from "./scorecard";

const T0 = Date.parse("2026-11-14T10:00:00Z");
const day = () => sampleDay(T0);

const NOW = new Date(T0 + 3_600_000);
const SINCE = new Date(T0 - 1);

describe("conversation turns become telemetry events without the buyer's words", () => {
  it("maps turn, turn_done, sheet_edit to their kinds with codes and times only", () => {
    const ev = day();
    const started = ev.find((e) => e.kind === "turn.started")!;
    expect(started.attrs).toMatchObject({ turnId: "t1", facts: { door: "typed", input: "typed", lang: "fi" } });
    expect(JSON.stringify(started)).not.toMatch(/maitoa|litraa/);
    const done = ev.find((e) => e.kind === "turn.done")!;
    expect(done.attrs?.facts).toMatchObject({ outcome: "ordered", first_ms: 900, end_ms: 2400, requests: 1, orders: 1 });
    expect(ev.find((e) => e.kind === "turn.correction")?.attrs?.facts).toEqual({ edit: "packs", verified: true });
  });

  it("reads the language by plain signs", () => {
    expect(languageOf("tarvitaan maitoa huomenna")).toBe("fi");
    expect(languageOf("vi behöver mjölk till imorgon")).toBe("sv");
    expect(languageOf("we need 1000 litres of milk by Monday")).toBe("en");
  });
});

describe("the scorecard: figures by plain code, one status per agent with its reason", () => {
  const figures = figuresFromEvents(day(), SINCE, NOW);
  const of = (id: string) => figures.find((f) => f.agentId === id)!;

  it("counts the same things the SQL counts", () => {
    expect(of("agent_alone")).toMatchObject({ requests: 2, alone: 2, escalated: 0, committed: 2, proposals: 2, corrections: 1, turns: 2, failedTurns: 0, liveLookups: 2, productsPriced: 4, spendUsd: 0.002 });
    expect(of("agent_big")).toMatchObject({ escalated: 2, overLimit: 2, granted: 2, committed: 2 });
    expect(of("agent_bad")).toMatchObject({ refused: 3, refusedRules: [{ rule: "order_matches_quote", n: 3 }], lastRefusedRequest: "rc3", turns: 1, failedTurns: 1 });
    expect(of("agent_alone").decideP50S).toBe(3); // request at +0 s, decision at +3 s
  });

  it("performing, escalating (with the tight-mandate suggestion) and failing (with the rule and a suspend proposal)", () => {
    const info = { label: "x", orgName: "o", kind: "demo" };
    expect(judgeAgent(of("agent_alone"), info).status).toBe("performing");
    const big = judgeAgent(of("agent_big"), info);
    expect(big.status).toBe("escalating");
    expect(big.reason).toMatch(/mandate looks too tight.*not a fault/);
    expect(big.proposal?.action).toBe("raise_mandate");
    const bad = judgeAgent(of("agent_bad"), { ...info, kind: "outside" });
    expect(bad.status).toBe("failing");
    expect(bad.reason).toMatch(/refused 3 of 3 decisions.*order_matches_quote/);
    expect(bad.proposal).toMatchObject({ action: "suspend", requestId: "rc3" });
    const quiet = judgeAgent({ ...of("agent_alone"), requests: 0, turns: 0, alone: 0 } as AgentFigures, info);
    expect(quiet.status).toBe("quiet");
  });

  it("reads the SQL's row shape back into the same figures", () => {
    const f = figuresFromRow({ agent_id: "a", requests: "3", refused: 2, refused_rules: "order_matches_quote:2,allergens:1", decide_p50_s: "1.5", decide_p90_s: null, spend_usd: "0.0012" });
    expect(f).toMatchObject({ requests: 3, refused: 2, decideP50S: 1.5, decideP90S: null, spendUsd: 0.0012, refusedRules: [{ rule: "order_matches_quote", n: 2 }, { rule: "allergens", n: 1 }] });
    expect(scorecardSql("1h")).toMatch(/from telemetry\.ops_events where ts > now\(\) - interval '1 hour'/);
    expect(percentileCont([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
});

describe("alerts as data", () => {
  const quiet: AlertInputs = { turnSeconds: [2, 3, 4], failedTurns: 0, searches: 10, searchFallbacks: 0, spendUsd: 1, capUsd: 5, oldestWaitMin: 3, waiting: 1, kafkaLag: 0 };
  it("is quiet within every threshold, and names each breach", () => {
    expect(evaluateAlerts(quiet)).toEqual([]);
    const ids = evaluateAlerts({ ...quiet, turnSeconds: [25, 30], failedTurns: 1, searchFallbacks: 1, spendUsd: 4.2, oldestWaitMin: 45, kafkaLag: 900 }).map((b) => b.id);
    expect(ids).toEqual(ALERT_RULES.map((r) => r.id));
  });
  it("keeps when a breach started until it clears", () => {
    const book = new AlertBook();
    const a = book.update({ ...quiet, failedTurns: 1 }, new Date(T0), 30);
    const b = book.update({ ...quiet, failedTurns: 2 }, new Date(T0 + 30_000), 30);
    expect(b.breaches[0].since).toBe(a.breaches[0].since);
    expect(book.update(quiet, new Date(T0 + 60_000), 30).quiet).toBe(true);
    expect(book.update({ ...quiet, failedTurns: 1 }, new Date(T0 + 90_000), 30).breaches[0].since).toBe(new Date(T0 + 90_000).toISOString());
  });
});

describe("the audit trail in words", () => {
  it("reads kind, rule, who and when; the OpenSearch query and the SQL say the same", () => {
    const p = parseAuditQuery("refusals for allergens by outside agents today", NOW);
    expect(p).toMatchObject({ kinds: ["gate.refused"], ruleWords: ["allergen"], who: "outside", rest: "" });
    expect(p.since.iso).toBe("2026-11-14T00:00:00.000Z");
    const body = JSON.stringify(auditSearchBody(p, ["agent_x"]));
    expect(body).toContain('"kind":["gate.refused"]');
    expect(body).toContain('"rule":"*allergen*"');
    expect(body).toContain('"agent_id":["agent_x"]');
    const sql = auditSql(p, true);
    expect(sql).toMatch(/kind in \('gate.refused'\)/);
    expect(sql).toMatch(/rule like '%allergen%'/);
    expect(sql).toMatch(/agent_id = any\(\$1\)/);
  });
  it("indexes codes and numbers only", () => {
    const ev = day();
    const docs = ev.map(eventDoc).filter(Boolean);
    expect(docs.length).toBeGreaterThan(10);
    expect(JSON.stringify(docs)).not.toMatch(/maitoa|everything|buyer said/i);
    expect(docs.find((d) => d!.kind === "gate.refused")).toMatchObject({ rule: "order_matches_quote", agent_id: "agent_bad", ok: false });
  });
});
