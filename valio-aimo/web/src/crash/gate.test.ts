import { describe, expect, it } from "vitest";
import { checkGate, GATE } from "./gate";

type Agent = Parameters<typeof checkGate>[0]["agents"][number];

const agent = (name: string, overall: number, level: string, score = overall, repeats = 2): Agent => ({
  agent: name,
  licence: { level },
  runs: Array.from({ length: repeats }, () => ({ overall, scenarios: [{ id: "litres-to-cases", score, fingerprint: `${name}-fp` }] })),
});

const today = (): Agent[] => [
  agent("reference", 100, "L3"),
  agent("do-nothing", 0, "L0"),
  agent("stop-early", 0, "L0"),
  agent("reckless", 13.2, "L0"),
  agent("claim-success", 0, "L0"),
  agent("honest-nothing", 1.5, "L0"),
  agent("always-decline", 7.7, "L0"),
  agent("first-product", 34, "L0"),
  agent("over-order", 42.8, "L0"),
  agent("ask-everything", 72, "L1"),
];

describe("crash-test CI gate", () => {
  it("passes today's scores", () => {
    expect(checkGate({ agents: today() }).every((f) => f.ok)).toBe(true);
    expect(GATE.map((g) => g.agent)).toHaveLength(10);
  });

  it("fails when the reference drops, a baseline rises, an exploit starts scoring, or repeats differ", () => {
    const fail = (change: (a: Agent[]) => void) => {
      const agents = today();
      change(agents);
      return checkGate({ agents }).filter((f) => !f.ok).map((f) => f.agent);
    };
    expect(fail((a) => (a[0] = agent("reference", 99.2, "L3", 90)))).toEqual(["reference"]);
    expect(fail((a) => (a[1] = agent("do-nothing", 6, "L0")))).toEqual(["do-nothing"]);
    expect(fail((a) => (a[4] = agent("claim-success", 20, "L0")))).toEqual(["claim-success"]);
    expect(fail((a) => (a[9] = agent("ask-everything", 72, "L2")))).toEqual(["ask-everything"]);
    expect(fail((a) => a[3].runs[1].scenarios[0].fingerprint = "other")).toEqual(["reckless"]);
    expect(fail((a) => a.splice(5, 1))).toEqual(["honest-nothing"]);
  });
});
