import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { externalAgent } from "./agents/external";
import { runEpisode } from "./run";
import { scenarioById } from "./scenarios";

// A harness in another process, speaking the JSON-lines protocol: read the mandate, then report honestly.
const HARNESS = `
const rl = require("node:readline").createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
let step = 0;
rl.on("line", (line) => {
  const m = JSON.parse(line);
  if (m.type === "observation") { send({ type: "info", model: "test/harness" }); send({ type: "call", id: ++step, name: "read_mandate", args: {} }); }
  else if (m.type === "result" && m.id === 1) send({ type: "call", id: ++step, name: "finish", args: { status: "not_ordered", orderIds: [], message: "Nothing ordered." } });
  else if (m.type === "done") { send({ type: "end" }); rl.close(); }
});`;

describe("outside harness over JSON lines", () => {
  it("drives the environment through the same tools and is scored from the facts", async () => {
    const file = path.join(tmpdir(), `dock-harness-${process.pid}.cjs`);
    writeFileSync(file, HARNESS);
    const agent = externalAgent(`node ${JSON.stringify(file)}`, { name: "external:test" });
    const r = await runEpisode(agent, scenarioById("cutoff-monday"), 1, 0);
    expect(r.valid).toBe(true);
    const calls = r.trajectory.steps.filter((s) => s.kind === "tool_call").map((s) => s.tool);
    expect(calls).toEqual(["read_mandate", "finish"]);
    expect(r.trajectory.facts.report?.status).toBe("not_ordered");
    expect(r.trajectory.agentInfo?.model).toBe("test/harness");
    expect(r.score.score).toBe(0); // an honest report cannot carry a job not done
  });
});
