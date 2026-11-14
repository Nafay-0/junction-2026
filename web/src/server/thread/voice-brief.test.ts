import { describe, expect, it } from "vitest";
import { liveSetup } from "@/server/channels/voice/live";
import { realtimeSession } from "@/server/channels/voice/realtime";
import { LIVE_TOOLS, voiceBrief } from "./voice-brief";
import { TOOLS_INDEX } from "./instructions";

const brief = voiceBrief({ kitchenName: "Ravintola Kaari", agentName: "Kaari's buyer", lang: "en", maxMinutes: 5 });

describe("the live voice model's brief", () => {
  it("names no tool the live session does not have: relay is its only one", () => {
    const declared = new Set<string>(LIVE_TOOLS.map((t) => t.name));
    expect([...declared]).toEqual(["relay"]);
    // Every tool name the kitchen agent has, and every name the old voice door had, is absent from the brief.
    const agentTools = [...TOOLS_INDEX.matchAll(/^- ([a-z_]+)[,:]/gm)].map((m) => m[1]);
    const old = ["submit_request", "confirm_read_back", "respond_to_check", "answer_question", "choose_option", "place_order", "check_order"];
    // (A one-word tool name such as "order" or "rules" is an ordinary word; the snake_case check below covers tools.)
    for (const name of [...agentTools, ...old].filter((n) => n.includes("_"))) if (!declared.has(name)) expect(brief, name).not.toMatch(new RegExp(`\\b${name}\\b`));
    // Each snake_case word in the brief that looks like a tool is a declared one.
    for (const w of brief.match(/\b[a-z]+_[a-z_]+\b/g) ?? []) expect(declared.has(w), w).toBe(true);
    expect(brief).toMatch(/\brelay\b/);
  });

  it("is the session's instructions, with the same one tool, on both providers", () => {
    const g = liveSetup({ model: "gemini-3.8-live", system: brief, mode: "hands_free" });
    expect(g.tools[0].functionDeclarations.map((t) => t.name)).toEqual(["relay"]);
    expect(g.realtimeInputConfig.automaticActivityDetection.disabled).toBe(false);
    const o = realtimeSession({ model: "gpt-realtime-2.1", system: brief, mode: "hands_free" });
    expect(o.tools.map((t) => t.name)).toEqual(["relay"]);
    expect(o.instructions).toBe(brief);
    expect(o.audio.input.turn_detection).toMatchObject({ interrupt_response: true });
  });

  it("says it relays and decides nothing, reads only what it is given, and asks one thing at a time", () => {
    expect(brief).toMatch(/only the ears and the mouth/);
    expect(brief).toMatch(/never answer the buyer yourself/i);
    expect(brief).toMatch(/Never invent or change a product, a price, an amount, a day/);
    expect(brief).toMatch(/one thing at a time/);
    expect(brief).toMatch(/Say exactly that/);
  });
});
