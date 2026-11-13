 
/**
 * Global invariants checked on every HTTP response the harness sees, plus helpers probes use for their own.
 *
 *   no_5xx            a server error is never the answer to anything a client sends (except where a probe
 *                     simulates a dependency failure and allows it)
 *   no_stack_trace    no stack frames, source paths or internal exception text in a response
 *   no_secret         no value of a secret environment variable, and nothing shaped like a private key
 *   error_shape       every 4xx/5xx JSON body is { error: { code, message } }
 *
 * Secret values are loaded into memory only to compare against; they are never printed or written.
 */
import type { Recorder } from "./http";

export type Violation = { invariant: string; probe: string; detail: string };
export type Warning = { kind: string; probe: string; detail: string };

const SECRET_NAMES = [
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "VALIO_API_KEY", "VERDA_API_KEY", "DATABASE_URL", "AIVEN_API_TOKEN",
  "OPENSEARCH_URL", "VALKEY_URL", "KAFKA_ACCESS_KEY", "KAFKA_ACCESS_CERT", "AIVEN_READONLY_TOKEN", "FEATHERLESS_API_KEY",
  "CONTEXT_DEV_API_KEY", "EXA_API_KEY", "CLOUDINARY_URL", "IRONSHARD_ACCESS_KEY_ID", "IRONSHARD_SECRET_ACCESS_KEY",
];

let secretValues: { name: string; value: string }[] | undefined;
function secrets(): { name: string; value: string }[] {
  if (secretValues) return secretValues;
  secretValues = [];
  for (const name of SECRET_NAMES) {
    const v = process.env[name]?.trim();
    if (v && v.length >= 12) secretValues.push({ name, value: v });
  }
  // the private part ("d") of the signing JWKs
  for (const name of ["DOCK_WHOLESALER_JWK", "DOCK_DEMO_ORG_JWK", "DOCK_DEMO_KITCHEN_JWK"]) {
    const v = process.env[name]?.trim();
    if (!v) continue;
    try {
      const d = (JSON.parse(v) as { d?: string }).d;
      if (d && d.length >= 20) secretValues.push({ name: `${name}.d`, value: d });
    } catch {
      // not JSON: ignore
    }
  }
  return secretValues;
}

const STACK = [/\n\s+at [\w.<>$]+ \(/, /\bat (?:async )?[\w.]+ \((?:\/|file:|node:)/, /\/(?:src|node_modules|\.next)\/[\w./-]+\.(?:ts|js|tsx):\d+/, /\b(?:TypeError|ReferenceError|SyntaxError|RangeError): /];
const KEY_SHAPES = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /"d"\s*:\s*"[A-Za-z0-9_-]{40,}"/, /\bsk-ant-[A-Za-z0-9_-]{10,}/, /\bsk-[A-Za-z0-9]{32,}/, /\bAIza[0-9A-Za-z_-]{30,}/];

export function scanResponse(
  r: { method: string; path: string; status: number; text: string; body: unknown; contentType: string },
  rec: Recorder,
): Violation[] {
  const out: Violation[] = [];
  const probe = rec.current;
  const where = `${r.method} ${r.path.slice(0, 120)}`;
  if (r.status >= 500 && !rec.allow5xx.has(r.path.split("?")[0])) out.push({ invariant: "no_5xx", probe, detail: `${where} -> ${r.status} ${r.text.slice(0, 200)}` });
  for (const re of STACK) if (re.test(r.text)) out.push({ invariant: "no_stack_trace", probe, detail: `${where}: matches ${re}` });
  for (const s of secrets()) if (r.text.includes(s.value)) out.push({ invariant: "no_secret", probe, detail: `${where}: contains the value of ${s.name}` });
  for (const re of KEY_SHAPES) if (re.test(r.text)) out.push({ invariant: "no_secret", probe, detail: `${where}: matches key shape ${re}` });
  if (r.status >= 400 && r.contentType.includes("json")) {
    const e = (r.body as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
    if (!e || typeof e.code !== "string" || typeof e.message !== "string") out.push({ invariant: "error_shape", probe, detail: `${where} -> ${r.status} body is not { error: { code, message } }: ${r.text.slice(0, 160)}` });
  }
  return out;
}

/** The probe's own checks: collect, never throw. */
export class Checks {
  readonly failures: string[] = [];
  readonly notes: string[] = [];
  expect(cond: unknown, message: string): boolean {
    if (!cond) this.failures.push(message);
    return !!cond;
  }
  note(message: string) {
    this.notes.push(message);
  }
}
