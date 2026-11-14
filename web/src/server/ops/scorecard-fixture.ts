import { InMemoryLedgerStore, Ledger, type LedgerInput } from "@/core/ledger";
import { LedgerToActions, actionEvent, type ActionEvent } from "@/server/aiven/actions";

/** A small day at the gate, as ledger entries: one agent orders alone, one escalates over its limit, one is refused. */
export function sampleDay(t0: number): ActionEvent[] {
  const at = (s: number) => new Date(t0 + s * 1000).toISOString();
  const store = new InMemoryLedgerStore();
  const ledger = new Ledger(store);
  const add = (e: LedgerInput) => ledger.append(e);
  const turn = (agent: string, turnId: string, words: string, door = "typed") => add({ type: "agent", actor: `agent:${agent}`, summary: `The buyer said (${door}): "${words}"`, data: { event: "turn", thread: { threadId: "th1", turnId, door }, words } });
  const done = (agent: string, turnId: string, requests: string[], status = "done", orders: string[] = []) => add({ type: "agent", actor: `agent:${agent}`, summary: "done", data: { event: "turn_done", thread: { threadId: "th1", turnId, door: "typed" }, status, marks: { line: 900, done: 2400 }, cards: ["options", "gate"], requests, orders } });
  // agent_alone: two orders placed alone, one corrected by the buyer
  for (const i of [1, 2]) {
    turn("agent_alone", `t${i}`, "tarvitaan 20 litraa maitoa huomenna");
    add({ type: "request", actor: "agent:agent_alone", requestId: `ra${i}`, summary: "opened", data: {} });
    add({ type: "lookup", actor: "agent:agent_alone", requestId: `ra${i}`, summary: "live", data: { source: "live", productIds: ["p1", "p2"] } });
    add({ type: "quote", actor: "dock", requestId: `ra${i}`, summary: "quoted", data: { quoteId: `q${i}`, totalCents: 4000 } });
    add({ type: "decision", actor: "dock", requestId: `ra${i}`, orderId: `oa${i}`, summary: "alone", data: { outcome: "auto_approve", totalCents: 4000, rules: [{ rule: "per_order_limit", outcome: "pass" }] } });
    add({ type: "order", actor: "dock", requestId: `ra${i}`, orderId: `oa${i}`, summary: "committed", data: {} });
    done("agent_alone", `t${i}`, [`ra${i}`], "done", [`oa${i}`]);
  }
  add({ type: "agent", actor: "agent:agent_alone", summary: "edit", data: { event: "sheet_edit", thread: { threadId: "th1", turnId: "t2", door: "typed" }, edit: { kind: "packs", lineId: "l1", packs: 3 }, verified: true } });
  add({ type: "agent", actor: "agent:agent_alone", summary: "model", data: { event: "model_call", thread: { threadId: "th1", turnId: "t1", door: "typed" }, costUsd: 0.002 } });
  // agent_big: two orders over its limit, both approved
  for (const i of [1, 2]) {
    add({ type: "request", actor: "agent:agent_big", requestId: `rb${i}`, summary: "opened", data: {} });
    add({ type: "quote", actor: "dock", requestId: `rb${i}`, summary: "quoted", data: { quoteId: `qb${i}`, totalCents: 140000 } });
    add({ type: "decision", actor: "dock", requestId: `rb${i}`, orderId: `ob${i}`, summary: "needs sign-off", data: { outcome: "needs_human_approval", totalCents: 140000, rules: [{ rule: "per_order_limit", outcome: "escalate" }] } });
    add({ type: "approval_requested", actor: "dock", requestId: `rb${i}`, orderId: `ob${i}`, summary: "asked", data: { role: "head_chef" } });
    add({ type: "approval", actor: "approver:head_chef", requestId: `rb${i}`, orderId: `ob${i}`, summary: "approved", data: { decision: "approved" } });
    add({ type: "order", actor: "dock", requestId: `rb${i}`, orderId: `ob${i}`, summary: "committed", data: {} });
  }
  // agent_bad: three refusals by the quote rule, one turn that never ended
  for (const i of [1, 2, 3]) {
    add({ type: "request", actor: "agent:agent_bad", requestId: `rc${i}`, summary: "opened", data: {} });
    add({ type: "decision", actor: "dock", requestId: `rc${i}`, orderId: `oc${i}`, summary: "refused", data: { outcome: "reject", totalCents: 100, rules: [{ rule: "order_matches_quote", outcome: "fail" }] } });
  }
  turn("agent_bad", "tb1", "buy everything");
  const mapper = new LedgerToActions();
  // Spread the entries over the morning so times are measurable: one second apart.
  const events = store.all().map((e, i) => ({ ...mapper.toEvent({ ...e, at: at(i) })!, at: at(i) }));
  // The same model call as the stream carries it (thread/telemetry.ts emits agent.model besides the ledger's copy).
  events.push(actionEvent({ kind: "agent.model", at: at(5), agentId: "agent_alone", value: 800, ok: true, attrs: { costUsd: 0.002, turnId: "t1", model: "test:model" } }));
  return events;
}

