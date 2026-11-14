/**
 * A tiny OpenAI-compatible model server for dependency tests. Never a real model, never a real key.
 *
 *   pnpm exec tsx tests-live/deps/fake-model.ts 4690
 *   OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:4690/v1 OPENAI_COMPATIBLE_API_KEY=fake DOCK_INTERPRET_MODEL=compat:fake ...
 *
 * POST {base}/chat/completions (non-streaming, and SSE when `stream: true`). Structured output: when the request
 * carries `response_format.json_schema`, the answer is a JSON value that fits the schema (every required field,
 * enums, nullables), with plausible values for the schemas Dock uses (structured_need, grounded_answer). It reads
 * a quantity in litres from the buyer's words, so "600 litres of lactose-free milk" becomes 600 L of milk.
 *
 * POST /__mode {"mode": "...", "delayMs"?: n, "retryAfter"?: "30"} switches behaviour; GET /__stats counts calls.
 *   ok        answers at once
 *   slow      answers after delayMs (default 20 000)
 *   hang      accepts and never answers (the client must time out)
 *   e500      HTTP 500 with an OpenAI-style error body
 *   r429      HTTP 429 with Retry-After (default 30) and an OpenAI-style rate-limit body
 *   garbage   HTTP 200 with a body that is not JSON
 *   badjson   HTTP 200, valid envelope, but the message content is not JSON (structured output fails)
 *   reset     destroys the socket without answering
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type ModelMode = "ok" | "slow" | "hang" | "e500" | "r429" | "garbage" | "badjson" | "reset";
export type ModelState = { mode: ModelMode; delayMs: number; retryAfter: string };
export type ModelStats = { calls: number; byMode: Record<string, number>; bySchema: Record<string, number>; streamed: number };

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Schema = { type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema; enum?: Json[]; anyOf?: Schema[]; oneOf?: Schema[]; const?: Json; default?: Json; minimum?: number; format?: string };

/** A value that fits the schema; `hint` overrides known property names. */
export function valueFor(schema: Schema | undefined, hint: Record<string, Json> = {}, path = ""): Json {
  if (!schema) return null;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum?.length) return schema.enum[0];
  const alts = schema.anyOf ?? schema.oneOf;
  if (alts?.length) {
    const nonNull = alts.find((a) => a.type !== "null");
    return valueFor(nonNull ?? alts[0], hint, path);
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const t = types.find((x) => x && x !== "null") ?? types[0];
  switch (t) {
    case "object": {
      const out: Record<string, Json> = {};
      for (const [k, s] of Object.entries(schema.properties ?? {})) {
        const p = path ? `${path}.${k}` : k;
        out[k] = p in hint ? hint[p] : valueFor(s, hint, p);
      }
      return out;
    }
    case "array":
      return [];
    case "string":
      return schema.format === "date" ? new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) : "fake";
    case "number":
    case "integer":
      return schema.minimum ?? 1;
    case "boolean":
      return false;
    case "null":
      return null;
    default:
      return null;
  }
}

function lastUserText(body: { messages?: { role: string; content: unknown }[] }): string {
  const users = (body.messages ?? []).filter((m) => m.role === "user");
  const c = users.at(-1)?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === "object" && p && "text" in p ? String((p as { text: unknown }).text) : "")).join("\n");
  return "";
}

/** Plausible answers for the schemas Dock uses; anything else gets a generic fit. */
function hintsFor(name: string, text: string): Record<string, Json> {
  if (name === "structured_need") {
    const m = /(\d[\d\s,.]*)\s*(l\b|litres?|liters?|litraa?)/i.exec(text);
    const amount = m ? Number(m[1].replace(/[\s,]/g, "")) : 100;
    return {
      isPurchaseRequest: true,
      notPurchaseReason: null,
      "item.text": "lactose-free milk",
      "item.category": "milk",
      "item.attributes": ["lactose_free"],
      "item.excludedAttributes": [],
      "item.productId": null,
      quantity: { amount, unit: "L" },
      deliverBy: null,
      requiredClaims: [],
      forbiddenAllergens: [],
      optimise: "unstated",
      sameAsLastTime: false,
      basedOnRequestId: null,
      takenFromEarlier: [],
    };
  }
  if (name === "grounded_answer") {
    const id = /"id"\s*:\s*"([^"]+)"/.exec(text)?.[1];
    return { kind: "answer", answer: "Fake model: the records say so.", citations: id ? [id] : [], dataMissing: !id };
  }
  return {};
}

export function startFakeModel(port: number, host = "127.0.0.1"): Promise<{ server: Server; state: ModelState; stats: ModelStats; close: () => Promise<void> }> {
  const state: ModelState = { mode: (process.env.FAKE_MODEL_MODE as ModelMode) ?? "ok", delayMs: 20_000, retryAfter: "30" };
  const stats: ModelStats = { calls: 0, byMode: {}, bySchema: {}, streamed: 0 };
  const hanging = new Set<ServerResponse>();

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = req.url ?? "";
      const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        if (res.destroyed) return;
        res.writeHead(status, { "content-type": "application/json", ...headers }).end(typeof body === "string" ? body : JSON.stringify(body));
      };
      if (url === "/__mode") {
        const b = JSON.parse(raw || "{}") as Partial<ModelState>;
        if (b.mode) state.mode = b.mode;
        if (typeof b.delayMs === "number") state.delayMs = b.delayMs;
        if (typeof b.retryAfter === "string") state.retryAfter = b.retryAfter;
        if (state.mode !== "hang") for (const r of hanging) r.destroy();
        return send(200, { ...state, stats });
      }
      if (url === "/__stats") return send(200, { ...state, stats });
      if (!/\/chat\/completions$/.test(url) || req.method !== "POST") return send(404, { error: { message: "not found", type: "invalid_request_error" } });

      stats.calls++;
      stats.byMode[state.mode] = (stats.byMode[state.mode] ?? 0) + 1;
      let body: { model?: string; stream?: boolean; messages?: { role: string; content: unknown }[]; response_format?: { type: string; json_schema?: { name?: string; schema?: Schema } } } = {};
      try {
        body = JSON.parse(raw);
      } catch {
        return send(400, { error: { message: "body is not JSON", type: "invalid_request_error" } });
      }
      const schemaName = body.response_format?.json_schema?.name ?? body.response_format?.type ?? "text";
      stats.bySchema[schemaName] = (stats.bySchema[schemaName] ?? 0) + 1;

      switch (state.mode) {
        case "e500":
          return send(500, { error: { message: "fake upstream failure", type: "server_error", code: null } });
        case "r429":
          return send(429, { error: { message: "Rate limit reached (fake)", type: "rate_limit_error", code: "rate_limit_exceeded" } }, { "retry-after": state.retryAfter });
        case "garbage":
          return send(200, "<html>upstream proxy error</html>", { "content-type": "text/html" });
        case "reset":
          req.socket.destroy();
          return;
        case "hang":
          hanging.add(res);
          res.on("close", () => hanging.delete(res));
          return;
      }

      const text = lastUserText(body);
      const schema = body.response_format?.json_schema?.schema;
      const content = state.mode === "badjson" ? "Sure! Here is the need: lactose-free milk, lots." : schema ? JSON.stringify(valueFor(schema, hintsFor(schemaName, text))) : "Fake model answer.";
      const reply = () => {
        const id = `chatcmpl-fake-${stats.calls}`;
        const created = Math.floor(Date.now() / 1000);
        const usage = { prompt_tokens: Math.ceil(raw.length / 4), completion_tokens: Math.ceil(content.length / 4), total_tokens: Math.ceil((raw.length + content.length) / 4) };
        if (body.stream) {
          stats.streamed++;
          if (res.destroyed) return;
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
          const chunk = (delta: unknown, finish: string | null, extra: object = {}) =>
            res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: body.model ?? "fake", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
          chunk({ role: "assistant", content: "" }, null);
          for (let i = 0; i < content.length; i += 40) chunk({ content: content.slice(i, i + 40) }, null);
          chunk({}, "stop", { usage });
          res.end("data: [DONE]\n\n");
          return;
        }
        send(200, { id, object: "chat.completion", created, model: body.model ?? "fake", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage });
      };
      if (state.mode === "slow") {
        const t = setTimeout(reply, state.delayMs);
        res.on("close", () => clearTimeout(t));
      } else reply();
    });
  };

  const server = createServer(handler);
  return new Promise((resolve) =>
    server.listen(port, host, () =>
      resolve({
        server,
        state,
        stats,
        close: () =>
          new Promise<void>((r) => {
            for (const h of hanging) h.destroy();
            server.closeAllConnections();
            server.close(() => r());
          }),
      }),
    ),
  );
}

if (process.argv[1] && /fake-model\.ts$/.test(process.argv[1])) {
  const port = Number(process.argv[2] ?? 4690);
  void startFakeModel(port).then(() => console.log(`fake model on 127.0.0.1:${port}/v1`));
}
