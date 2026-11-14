import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { CrashAgent } from "./types";

/**
 * Any agent harness, in any language, as a crash-test agent: `external:<command>`. The command is started once per
 * episode and talks JSON lines on stdin/stdout (stderr is passed through):
 *
 *   to the harness    {"type":"observation","briefing":"...","task":"...","tools":[{"name","description","inputSchema"}]}
 *                     {"type":"result","id":1,"result":{...}}           the tool's result, exactly as a model would see it
 *                     {"type":"done"}                                    the episode is over (finish was called, or a cap)
 *   from the harness  {"type":"call","id":1,"name":"submit_need","args":{...}}
 *                     {"type":"info","model":"vendor/model","costUsd":0.12,"tokens":{"input":1,"output":2,"total":3}}  optional
 *                     {"type":"end"}                                     the harness stops (if it never called finish, the
 *                                                                        episode ends unreported, as with any agent)
 *
 * The tool table is the one every agent gets (Dock's MCP tools plus ask_human and finish); scoring reads only what
 * happened in the environment. Example: `pnpm crash --agent "external:python3 my_harness.py" --scenario cutoff-monday`.
 */
export function externalAgent(command: string, opts: { name?: string } = {}): CrashAgent {
  return {
    name: opts.name ?? `external:${command}`,
    kind: "model",
    description: `An outside harness over JSON lines: ${command}`,
    async run(env) {
      const child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "inherit"] });
      const send = (msg: unknown) => child.stdin.write(JSON.stringify(msg) + "\n");
      let info: { model?: string; costUsd?: number | null; tokens?: { input: number; output: number; total: number } } = {};
      const lines = createInterface({ input: child.stdout });
      const exited = new Promise<void>((resolve) => child.on("close", () => resolve()));
      send({ type: "observation", briefing: env.briefing, task: env.task.text, tools: env.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
      try {
        for await (const line of lines) {
          if (!line.trim()) continue;
          let msg: { type?: string; id?: unknown; name?: unknown; args?: unknown; model?: string; costUsd?: number; tokens?: { input: number; output: number; total: number } };
          try {
            msg = JSON.parse(line);
          } catch {
            continue; // a harness may print other lines; only JSON objects are protocol
          }
          if (msg.type === "call" && typeof msg.name === "string") {
            const result = await env.call(msg.name, msg.args ?? {});
            send({ type: "result", id: msg.id ?? null, result });
            if (env.done) {
              send({ type: "done" });
              break;
            }
          } else if (msg.type === "info") info = { ...info, ...msg };
          else if (msg.type === "end") break;
        }
      } finally {
        child.stdin.end();
        const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
        await exited;
        clearTimeout(timer);
      }
      return { model: info.model, costUsd: info.costUsd ?? null, tokens: info.tokens, outcome: env.done ? "finished" : "ended" };
    },
  };
}
