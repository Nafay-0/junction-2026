import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_INSTRUCTIONS, EXAMPLES, PLAYBOOK_SECTIONS, REFS_INDEX, TOOLS_INDEX } from "./instructions";

/**
 * The playbook against the code it describes. The lists of tools and of open-decision refs are read from agent.ts's
 * own source, so adding a tool or a kind of decision without a procedure for it fails here.
 */
const agentSource = readFileSync(path.join(__dirname, "agent.ts"), "utf8");

const listOf = (re: RegExp): string[] => {
  const m = re.exec(agentSource);
  if (!m) throw new Error(`not found in agent.ts: ${re}`);
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
};

const words = (s: string) => s.replace(/\*\*|\{\{|\}\}/g, "").split(/\s+/).filter(Boolean).length;

describe("the agent's playbook", () => {
  it("has a line in the tools index for every tool the model may call", () => {
    const published = listOf(/const PUBLISHED_FOR_MODEL = \[([^\]]+)\]/);
    const active = listOf(/activeTools: \[\.\.\.PUBLISHED_FOR_MODEL,([^\]]+)\]/);
    const tools = [...new Set([...published, ...active])];
    expect(tools.length).toBeGreaterThanOrEqual(15);
    const indexed = new Set(
      TOOLS_INDEX.split("\n")
        .filter((l) => l.startsWith("- "))
        .flatMap((l) => l.slice(2, l.indexOf(":")).split(",").map((x) => x.trim())),
    );
    expect(tools.filter((t) => !indexed.has(t))).toEqual([]);
  });

  it("names every kind of open decision the code can list", () => {
    // Every `ref:` the code builds in openRefs: its family is what comes before a number, a colon or the end.
    const start = agentSource.indexOf("export async function openRefs");
    const end = agentSource.indexOf("async function placedAlready");
    const body = agentSource.slice(start, end);
    const families = [...new Set([...body.matchAll(/ref: [`"]([a-z_]+)/g)].map((m) => m[1]))];
    expect(families.length).toBeGreaterThanOrEqual(12);
    const missing = families.filter((f) => !new RegExp(`(?<![a-z_])${f}(?=[0-9:<,. ])`).test(REFS_INDEX));
    expect(missing).toEqual([]);
  });

  it("has every procedure, in order, and the sections in reading order", () => {
    const numbers = [...AGENT_INSTRUCTIONS.matchAll(/^P(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
    expect(numbers.length).toBeGreaterThanOrEqual(23);
    const heads = ["WHAT IS TRUE", "THE ONE RULE ABOVE ALL", "HOW A TURN WORKS", "YOUR TOOLS", "PROCEDURES: BUYING", "PROCEDURES: DISHES AND MENUS", "HOW TO SPEAK", "THE SMALL DETAILS", "NEVER", "EXAMPLES OF FORM"];
    const at = heads.map((h) => AGENT_INSTRUCTIONS.indexOf(h));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(PLAYBOOK_SECTIONS.join("\n\n")).toBe(AGENT_INSTRUCTIONS);
  });

  it("is static: no date, no kitchen's name, nothing that changes per turn", () => {
    expect(AGENT_INSTRUCTIONS).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    expect(AGENT_INSTRUCTIONS).not.toMatch(/Hotel Lumo|Metsola|Sointu|Kaari|Laakso/);
    expect(AGENT_INSTRUCTIONS).not.toMatch(/\$\{/);
  });

  it("says its own role: it guides, code decides", () => {
    expect(AGENT_INSTRUCTIONS).toContain("It enforces nothing");
    expect(AGENT_INSTRUCTIONS).toContain("NOTHING CHANGES SILENTLY");
  });

  it("keeps to its own rules in the examples: two to four sentences, under 50 words, no codes", () => {
    const replies = EXAMPLES.split("\n").filter((l) => l.startsWith("You: ")).map((l) => l.slice(5));
    expect(replies.length).toBeGreaterThanOrEqual(11);
    for (const r of replies) {
      expect(words(r), r).toBeLessThan(50);
      const sentences = r.split(/(?<=[.!?])\s+(?=[\p{Lu}*{])/u).length;
      expect(sentences, r).toBeGreaterThanOrEqual(2);
      expect(sentences, r).toBeLessThanOrEqual(4);
      expect(r).not.toMatch(/\b[a-z]+_[a-z_]+\b|\bcat \d|\bord_|\breq_/);
    }
  });

  it("stays within the length a cached prompt should have", () => {
    const n = words(AGENT_INSTRUCTIONS);
    expect(n).toBeGreaterThan(3500);
    // About 6,000 words today. The ceiling leaves room for a rule or two; past it, merge or cut before adding.
    expect(n).toBeLessThan(6500);
  });
});
