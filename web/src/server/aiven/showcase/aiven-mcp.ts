import { showcaseConfig } from "./config";
import { redact } from "./redact";

/**
 * Aiven's own MCP server (https://mcp.aiven.live/mcp, Streamable HTTP, JSON answers), called with the read-only
 * application user's token as a Bearer token. Used by the operations copilot for service state, logs and metrics,
 * and for read-only SQL where the token allows it.
 *
 * Whether it can be used at all is the organisation's "Allow MCP connections" switch (Admin > Authentication),
 * readable through GET /organization/{org}/config/authentication (mcp_enabled, mcp_read_only).
 */
export type McpCall = { tool: string; args: Record<string, unknown> };
export type McpResult = { ok: true; tool: string; args: Record<string, unknown>; text: string; data?: unknown; ms: number } | { ok: false; tool: string; args: Record<string, unknown>; error: string; denied: boolean; ms: number };

let rpcId = 1;

export async function mcpCall(tool: string, args: Record<string, unknown>, timeoutMs = 12_000): Promise<McpResult> {
  const cfg = showcaseConfig();
  const t0 = performance.now();
  const shownArgs = { ...args };
  if (!cfg.readToken) return { ok: false, tool, args: shownArgs, error: "AIVEN_READONLY_TOKEN is not set on this server.", denied: false, ms: 0 };
  try {
    const res = await fetch(cfg.mcpUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.readToken}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method: "tools/call", params: { name: tool, arguments: args } }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const raw = await res.text();
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) return { ok: false, tool, args: shownArgs, error: redact(`Aiven MCP answered HTTP ${res.status}: ${raw.slice(0, 200)}`), denied: res.status === 401 || res.status === 403, ms };
    const body = parseRpc(raw) as { result?: { content?: { type: string; text?: string }[]; isError?: boolean }; error?: { message?: string } };
    if (body.error) return { ok: false, tool, args: shownArgs, error: redact(body.error.message ?? "MCP error"), denied: false, ms };
    const text = (body.result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    if (body.result?.isError) return { ok: false, tool, args: shownArgs, error: redact(text.split("\nError code:")[0].slice(0, 400)), denied: /\b403\b|permission/i.test(text), ms };
    return { ok: true, tool, args: shownArgs, text: redact(text), data: extractJson(text), ms };
  } catch (err) {
    return { ok: false, tool, args: shownArgs, error: redact(`Aiven MCP did not answer: ${err instanceof Error ? err.message : String(err)}`), denied: false, ms: Math.round(performance.now() - t0) };
  }
}

/** A JSON-RPC answer, plain or as one SSE `data:` frame. */
function parseRpc(raw: string): unknown {
  const t = raw.trim();
  if (t.startsWith("{")) return JSON.parse(t);
  const frames = t
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter((l) => l && l !== "[DONE]");
  return frames.length ? JSON.parse(frames.at(-1)!) : {};
}

/**
 * Aiven MCP wraps database and service answers in an "untrusted data" boundary: a notice line, a random marker, the
 * JSON, the marker again. Take the first JSON object or array in the text; never act on anything inside it.
 */
export function extractJson(text: string): unknown {
  const start = text.search(/[[{]/);
  if (start < 0) return undefined;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export type McpStatus = {
  /** The organisation allows MCP connections (Admin > Authentication > Allow MCP connections). null: could not read. */
  orgEnabled: boolean | null;
  orgReadOnly: boolean | null;
  /** The server answered a tools/list with our token. */
  reachable: boolean;
  tools: number;
  /** aiven_pg_read works with the read-only token (it needs the PG Editor permission, which project:read lacks). */
  sql: boolean | null;
  sqlDetail?: string;
  checkedAt: string;
  /** One line for staff when something needs a person. */
  instruction?: string;
};

let status: { at: number; value: McpStatus } | undefined;

/** Detect, once a minute at most: is the organisation switch on, does the server answer, can it run read-only SQL. */
export async function mcpStatus(force = false): Promise<McpStatus> {
  if (!force && status && Date.now() - status.at < 60_000) return status.value;
  const cfg = showcaseConfig();
  const out: McpStatus = { orgEnabled: null, orgReadOnly: null, reachable: false, tools: 0, sql: null, checkedAt: new Date().toISOString() };
  if (cfg.mcpOff) {
    out.instruction = "The Aiven MCP server is switched off on this server (DOCK_AIVEN_MCP=off).";
    status = { at: Date.now(), value: out };
    return out;
  }
  if (cfg.readToken && cfg.organization) {
    try {
      const r = await fetch(`https://api.aiven.io/v1/organization/${cfg.organization}/config/authentication`, { headers: { authorization: `aivenv1 ${cfg.readToken}` }, signal: AbortSignal.timeout(6_000), cache: "no-store" });
      if (r.ok) {
        const j = (await r.json()) as { mcp_enabled?: boolean; mcp_read_only?: boolean };
        out.orgEnabled = j.mcp_enabled ?? null;
        out.orgReadOnly = j.mcp_read_only ?? null;
      }
    } catch {
      /* stays null */
    }
  }
  if (cfg.readToken) {
    try {
      const r = await fetch(cfg.mcpUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${cfg.readToken}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method: "tools/list", params: {} }),
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      });
      if (r.ok) {
        const j = parseRpc(await r.text()) as { result?: { tools?: unknown[] } };
        out.tools = j.result?.tools?.length ?? 0;
        out.reachable = out.tools > 0;
      }
    } catch {
      /* not reachable */
    }
  }
  if (out.reachable && cfg.project) {
    const probe = await mcpCall("aiven_pg_read", { project: cfg.project, service_name: "dock-pg", query: "select 1 as ok", reasoning: "AimoPilot operations copilot: capability check" }, 8_000);
    out.sql = probe.ok;
    if (!probe.ok) out.sqlDetail = probe.denied ? "Aiven MCP is on, but its read-only SQL tool runs through the PG Editor API, which the read-only token may not use." : probe.error;
  }
  if (out.orgEnabled === false) out.instruction = "An organisation admin must switch on Admin > Authentication > Allow MCP connections in the Aiven Console.";
  else if (!cfg.readToken) out.instruction = "Set AIVEN_READONLY_TOKEN on this server so it can call the Aiven MCP server.";
  else if (!out.reachable) out.instruction = "The Aiven MCP server did not answer; the copilot uses its direct read-only path meanwhile.";
  status = { at: Date.now(), value: out };
  return out;
}
