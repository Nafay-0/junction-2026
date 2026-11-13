import { describe, expect, it } from "vitest";
import { CallRegistry, voiceLimits } from "./calls";

const limits = voiceLimits({ DOCK_VOICE_CALLS_PER_KITCHEN_HOUR: "3", DOCK_VOICE_CALLS_PER_HOUR: "4", DOCK_VOICE_CALLS_PER_KITCHEN_DAY: "5", DOCK_VOICE_CALLS_PER_DAY: "6" });

describe("CallRegistry", () => {
  it("holds one live call per kitchen, and frees the line on hang-up or when the page goes quiet", () => {
    let t = 1_000_000;
    const r = new CallRegistry(() => t);
    const a = r.open("kaari", "push_to_talk", limits);
    expect(() => r.open("kaari", "hands_free", limits)).toThrow(/already on a call/);
    r.open("laakso", "push_to_talk", limits);
    r.end(a.callId, "kaari", "hung up");
    const b = r.open("kaari", "push_to_talk", limits);
    t += 31_000; // no heartbeat for 31 s
    r.open("kaari", "push_to_talk", limits);
    expect(() => r.use(b.callId, "kaari", "speech")).toThrow(/ended/);
  });

  it("caps calls per kitchen and in total per hour, and per day", () => {
    let t = 0;
    const r = new CallRegistry(() => t);
    for (let i = 0; i < 3; i++) {
      r.end(r.open("kaari", "push_to_talk", limits).callId, "kaari", "x");
    }
    expect(() => r.open("kaari", "push_to_talk", limits)).toThrow(/3 calls for this hour/);
    r.end(r.open("laakso", "push_to_talk", limits).callId, "laakso", "x");
    expect(() => r.open("laakso", "push_to_talk", limits)).toThrow(/4 calls this hour/);
    t += 3_700_000;
    r.end(r.open("kaari", "push_to_talk", limits).callId, "kaari", "x");
    r.end(r.open("kaari", "push_to_talk", limits).callId, "kaari", "x");
    expect(() => r.open("kaari", "push_to_talk", limits)).toThrow(/5 calls for today/);
  });

  it("a typed call holds no line and is not counted, and carries the desk of the call it replaces", () => {
    const r = new CallRegistry(() => 0);
    const live = r.open("kaari", "push_to_talk", limits);
    live.desk.requestId = "req_1";
    const typed = r.open("kaari", "typed", limits, live.callId);
    expect(typed.desk.requestId).toBe("req_1");
    expect(() => r.use(typed.callId, "laakso", "typed")).toThrow(/No such call/);
  });

  it("bounds the tool calls of one call", () => {
    const r = new CallRegistry(() => 0);
    const c = r.open("kaari", "typed", limits);
    for (let i = 0; i < 40; i++) r.use(c.callId, "kaari", "typed");
    expect(() => r.use(c.callId, "kaari", "typed")).toThrow(/limit/);
  });

  it("can be switched off", () => {
    expect(() => new CallRegistry().open("kaari", "push_to_talk", voiceLimits({ DOCK_VOICE: "off" }))).toThrow(/switched off/);
  });
});
