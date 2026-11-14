import { scrubSecrets } from "../env";

/**
 * The last line of defence for anything the showcase sends to a browser: copilot answers, rows, API errors,
 * agent transcripts. Removes every configured secret value, connection strings with credentials, signed tokens
 * (mandates, quotes and receipts are compact JWS), PEM blocks, Aiven tokens, and values under secret-looking keys.
 */
const SECRET_VARS = ["AIVEN_API_TOKEN", "AIVEN_READONLY_TOKEN", "DOCK_AIVEN_LAUNCH_TOKEN", "DOCK_COPILOT_PG_URL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "VALIO_API_KEY", "DOCK_DEMO_ORG_JWK", "DOCK_WHOLESALER_JWK", "DOCK_DEMO_KITCHEN_JWK", "KAFKA_CA_CERT"];

function configuredSecrets(): string[] {
  const out: string[] = [];
  for (const k of SECRET_VARS) {
    const v = process.env[k]?.trim();
    if (!v || v.length < 8) continue;
    out.push(v);
    if (k === "DOCK_COPILOT_PG_URL") {
      try {
        const u = new URL(v);
        if (u.password) out.push(u.password, decodeURIComponent(u.password));
      } catch {
        /* not a URL */
      }
    }
    if (k.endsWith("_JWK")) {
      try {
        const d = (JSON.parse(v) as { d?: string }).d;
        if (d) out.push(d);
      } catch {
        /* not JSON */
      }
    }
  }
  return out.filter((s) => s.length >= 8).sort((a, b) => b.length - a.length);
}

const PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, "[pem withheld]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[signed token withheld]"],
  [/\b(postgres(?:ql)?|rediss?|valkeys?|https?|kafka):\/\/[^\s/:@]+:[^\s/@]+@[^\s"']+/gi, "[connection string withheld]"],
  [/\baivenv1\s+\S+/gi, "aivenv1 [token withheld]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g, "Bearer [token withheld]"],
  [/"(password|passwd|secret|token|access_key|access_cert|private_key|full_token|service_uri|connection_string)"\s*:\s*"[^"]*"/gi, '"$1":"[withheld]"'],
];

export function redact(text: string): string {
  let t = scrubSecrets(text);
  for (const s of configuredSecrets()) t = t.split(s).join("[withheld]");
  for (const [re, by] of PATTERNS) t = t.replace(re, by);
  return t;
}

/** Redact every string inside a JSON-able value (keys kept). */
export function redactDeep<T>(value: T): T {
  return JSON.parse(redact(JSON.stringify(value ?? null))) as T;
}
