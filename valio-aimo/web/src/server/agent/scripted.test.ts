import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scriptedVoice } from "../channels/voice/live";
import { agentStep } from "./scripted";

describe("scripted store agent (agentStep)", () => {
  const saved = process.env.DOCK_SCRIPTED_RECORDINGS;
  beforeEach(() => {
    const f = path.join(mkdtempSync(path.join(tmpdir(), "scripted-")), "r.json");
    writeFileSync(f, JSON.stringify([{ match: "What did we order last week?", agent: { calls: [{ name: "order_history", args: { from: "{{today-7}}", to: "{{today}}" } }], line: "Below." } }]));
    process.env.DOCK_SCRIPTED_RECORDINGS = f;
  });
  afterEach(() => {
    process.env.DOCK_SCRIPTED_RECORDINGS = saved;
  });
  const sys = (open: string) => ({ role: "system", content: `Today is ...\n\n${open}` });

  it("sends words that look like a request to the order tool", () => {
    expect(agentStep([sys("OPEN DECISIONS: none."), { role: "user", content: "100 litres of milk for Thursday" }])).toEqual({ calls: [{ name: "order", args: { words: "100 litres of milk for Thursday" } }] });
  });
  it("answers a recorded question with its tool, then its line", () => {
    const first = agentStep([sys("OPEN DECISIONS: none."), { role: "user", content: "What did we order last week?" }]);
    expect(first.calls?.[0].name).toBe("order_history");
    expect(String(first.calls?.[0].args.from)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const after = agentStep([{ role: "user", content: "What did we order last week?" }, { role: "assistant", content: [{ type: "tool-call", toolName: "order_history" }] }, { role: "tool", content: [{ type: "tool-result", output: { type: "text", value: '{"orders":[]}' } }] }]);
    expect(after).toEqual({ line: "Below." });
  });
  it("maps a short yes onto the one open confirmation, and nothing else", () => {
    expect(agentStep([sys('OPEN DECISIONS (ref: what it does):\n- c1:confirm: confirm "1,000 L"\n- c1:use_100_L: Make it 100 L'), { role: "user", content: "yes" }])).toEqual({ calls: [{ name: "buyer_reply", args: { ref: "c1:confirm" } }] });
    expect(agentStep([sys("OPEN DECISIONS: none."), { role: "user", content: "hello" }])).toEqual({});
  });
  it("waits for a sign-off an order left open, once", () => {
    const tool = { role: "tool", content: [{ type: "tool-result", output: { type: "text", value: '[{"order":{"orderId":"ord_1","status":"pending_approval"}}]' } }] };
    expect(agentStep([{ role: "user", content: "1,000 L" }, { role: "assistant", content: [{ type: "tool-call", toolName: "order" }] }, tool])).toEqual({ calls: [{ name: "await_sign_off", args: { orderId: "ord_1" } }] });
    expect(agentStep([{ role: "user", content: "[The order ord_2 now waits for Mia's sign-off.]" }])).toEqual({ calls: [{ name: "await_sign_off", args: { orderId: "ord_2" } }] });
  });
});

describe("scripted voice tokens (test-only switch)", () => {
  it("is off unless both switches are set", () => {
    expect(scriptedVoice({})).toBe(false);
    expect(scriptedVoice({ DOCK_VOICE_SCRIPTED: "1" })).toBe(false);
    expect(scriptedVoice({ DOCK_VOICE_SCRIPTED: "1", DOCK_SCRIPTED_MODELS: "1" })).toBe(true);
  });
  it("is refused on a deployed server", () => {
    expect(() => scriptedVoice({ DOCK_VOICE_SCRIPTED: "1", DOCK_SCRIPTED_MODELS: "1", DOCK_PUBLIC_URL: "https://example.org" })).toThrow(/refused on a deployed server/);
    expect(() => scriptedVoice({ DOCK_VOICE_SCRIPTED: "1", DOCK_SCRIPTED_MODELS: "1", VERCEL: "1" })).toThrow(/refused/);
  });
});
