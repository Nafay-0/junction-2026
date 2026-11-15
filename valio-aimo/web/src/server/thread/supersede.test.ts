import { describe, expect, it } from "vitest";
import { supersedeCheck } from "./pipeline";
import { ThreadStore } from "./store";
import type { AnomalyCard, QuestionCard } from "./types";

describe("a later request made from an earlier one", () => {
  it("closes the earlier request's open check, so the next answer goes to the request as it is now", () => {
    const store = new ThreadStore();
    const thread = store.get("kahvila-sointu", "org_1");
    store.addTurn(thread, { role: "buyer", turnId: "trn_b", at: "", door: "typed", via: "typed", text: "10 litres of cream for Thursday" } as never);
    store.addTurn(thread, { role: "agent", turnId: "trn_a", replyTo: "trn_b", at: "", status: "waiting_buyer", steps: [], cards: [] } as never);
    const agent = store.agentTurn(thread, "trn_a")!;
    const check: AnomalyCard = { type: "anomaly", cardId: "anomaly:req_old", requestId: "req_old", concerns: [{ key: "delivery_not_delivery_day:2026-11-19", code: "delivery_not_delivery_day", message: "x", confirmable: false, corrections: [{ id: "deliver_2026-11-20", label: "Fri" }] }] };
    const q: QuestionCard = { type: "question", cardId: "question:req_q", requestId: "req_q", questions: [{ id: "which", text: "Which?", options: [{ id: "a", label: "A" }] }] };
    store.card(thread, agent.turnId, check);
    store.card(thread, agent.turnId, q);
    const entries: unknown[] = [];
    const run = { store, thread, turnId: agent.turnId, door: "typed", buyer: { via: "typed" }, k: { info: { by: "Kahvila Sointu" } }, session: { agentId: "agt_1" }, rt: { dock: { ledger: { append: (e: unknown) => entries.push(e) } } } } as never;
    supersedeCheck(run, "req_old");
    supersedeCheck(run, "req_q");
    const cards = store.cards(thread).map((x) => x.card);
    expect(cards.find((c) => c.cardId === "anomaly:req_old")).toMatchObject({ answered: { choice: "replaced" } });
    expect(cards.find((c) => c.cardId === "question:req_q")).toMatchObject({ answered: { which: "replaced" } });
    expect(entries.length).toBe(2);
  });
});
