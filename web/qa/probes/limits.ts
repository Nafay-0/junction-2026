/* eslint-disable @typescript-eslint/no-explicit-any -- QA harness: probes read untyped JSON replies. */
/**
 * The public-demo limits (src/proxy.ts, src/server/limits.ts), against a server started with its limits on and a
 * tiny daily model cap, so exhausting it costs a few model calls instead of a day's budget:
 *
 *   LIMITS=on DOCK_LLM_DAILY_CALLS=3 qa/bin/fresh-server.sh 4314
 *   pnpm qa --limits-url http://localhost:4314 --only limits
 */
import { consoleCall, Http } from "../lib/http";
import type { Probe } from "../lib/probe";

const limitsHttp = (ctx: { rec: any }): Http | undefined => {
  const url = process.argv.includes("--limits-url") ? process.argv[process.argv.indexOf("--limits-url") + 1] : process.env.QA_LIMITS_URL;
  return url ? new Http(url, ctx.rec) : undefined;
};

export const limitsProbes: Probe[] = [
  {
    id: "limits.assistant_bypasses_model_cap",
    area: "interpreter",
    kind: "exhaustion",
    title: "The kitchen assistant's model calls count against the daily model cap like the interpreter's",
    findings: ["F-MODEL-SPEND"],
    async run(ctx) {
      const http = limitsHttp(ctx);
      if (!http) return { skip: "needs --limits-url (a server with LIMITS=on DOCK_LLM_DAILY_CALLS=3)" };
      ctx.rec.expectRateLimit = true;
      const call = consoleCall(http, "kaari");
      const interp: number[] = [];
      for (let i = 0; i < 4; i++) interp.push((await call("POST", "/api/v1/agent/interpret", { text: `${20 + i} L milk for Tuesday` })).status);
      const capped = interp.includes(429);
      ctx.check.note(`interpret x4 with a daily cap of 3: ${interp.join(",")}`);
      ctx.check.expect(capped, "the daily model cap did not stop the interpreter");
      const asst: number[] = [];
      for (let i = 0; i < 3; i++) asst.push((await http.post("/ui-api/kitchens/kaari/assistant", { question: `Which milk is cheapest per litre? (${i})` })).status);
      ctx.check.expect(!asst.includes(200), `after the day's model cap was spent, the assistant still made paid model calls: ${asst.join(",")}`);
      ctx.rec.expectRateLimit = false;
    },
  },
  {
    id: "limits.chunked_body_skips_size_cap",
    area: "rest",
    kind: "hostile",
    title: "A body sent without Content-Length (chunked) is held to the same 64 KB cap",
    async run(ctx) {
      const http = limitsHttp(ctx);
      if (!http) return { skip: "needs --limits-url" };
      const big = JSON.stringify({ need: { item: { text: "milk" }, pad: "x".repeat(3_000_000) } });
      const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
      const t0 = Date.now();
      const res = await fetch(new URL("/ui-api/kitchens/kaari/call", http.base), { method: "POST", body: stream, headers: { "content-type": "application/json" }, duplex: "half" } as RequestInit);
      const text = await res.text();
      ctx.check.note(`3 MB chunked body: ${res.status} in ${Date.now() - t0} ms: ${text.slice(0, 120)}`);
      ctx.check.expect((res.status === 413 || res.status === 400) && Date.now() - t0 < 3000, `3 MB chunked body: status ${res.status}`);
    },
  },
];
