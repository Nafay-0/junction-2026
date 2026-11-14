/**
 * The copilot's SQL guard: what may be sent to PostgreSQL, checked before anything is sent. Plain code, no model.
 *
 * Accepted: ONE read-only SELECT (optionally WITH ... SELECT) that reads only the allow-listed relations.
 * Refused: anything that writes or changes state, more than one statement, comments, dollar quoting, escape
 * strings, locking clauses, SELECT INTO, system catalogues, file and session functions, and any table not on
 * the list. The accepted query is wrapped so it can never return more than `maxRows` (+1, to tell the caller
 * the answer was cut).
 *
 * This is the first of two walls: the database user dock_copilot can itself only SELECT one view, in read-only
 * sessions with a 3 s statement timeout (infra/copilot.sql). Either wall alone stops a write.
 */

export const ALLOWED_RELATIONS = ["telemetry.ops_events"] as const;
export const MAX_SQL_CHARS = 4_000;
export const DEFAULT_MAX_ROWS = 200;
export const DEFAULT_TIMEOUT_MS = 3_000;

export type GuardResult =
  | { ok: true; sql: string; wrapped: string; relations: string[]; maxRows: number }
  | { ok: false; code: GuardCode; reason: string };

export type GuardCode = "empty" | "too_long" | "not_select" | "write" | "multiple_statements" | "comment" | "quoting" | "function" | "relation" | "catalog" | "lock" | "syntax";

type Tok = { t: "word" | "qident" | "string" | "number" | "punct"; v: string; lower: string };

/** Statements and keywords that change something, open transactions or run code. */
const WRITE_WORDS = new Set([
  "insert", "update", "delete", "merge", "upsert", "truncate", "drop", "alter", "create", "grant", "revoke", "copy", "call", "do",
  "execute", "prepare", "deallocate", "vacuum", "analyze", "analyse", "cluster", "reindex", "refresh", "lock", "listen", "notify",
  "unlisten", "set", "reset", "begin", "start", "commit", "rollback", "savepoint", "release", "discard", "load", "import", "security",
  "comment", "checkpoint", "returning", "into", "table",
]);

/** Function names (or prefixes) that read files, sleep, touch sessions or sequences, or reach other databases. */
const FUNCTION_DENY = [/^pg_/, /^lo_/, /^dblink/, /^current_setting$/, /^set_config$/, /^query_to_/, /^table_to_/, /^xpath/, /^txid_/, /^nextval$/, /^setval$/, /^currval$/, /^lastval$/, /^version$/, /^inet_/, /^current_user$/, /^session_user$/, /^current_database$/, /^current_schema/, /^has_.*privilege$/];

/** Functions that may appear in FROM (they are not tables). */
const TABLE_FUNCTIONS = new Set(["generate_series", "unnest"]);

/** Inside these calls `FROM` is part of the syntax, not a table list: extract(epoch from ts), substring(x from 2). */
const FROM_IN_CALL = new Set(["extract", "substring", "trim", "overlay", "position"]);

/** Clause words that end a FROM list at the same depth. */
const END_FROM = new Set(["where", "group", "order", "limit", "having", "window", "union", "intersect", "except", "offset", "fetch", "on", "using", "returning", "for"]);

function tokenize(sql: string): Tok[] | { code: GuardCode; reason: string } {
  const out: Tok[] = [];
  let i = 0;
  const push = (t: Tok["t"], v: string) => out.push({ t, v, lower: v.toLowerCase() });
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if ((c === "-" && sql[i + 1] === "-") || (c === "/" && sql[i + 1] === "*")) return { code: "comment", reason: "Comments are not accepted: the query has to be readable as it runs." };
    if (c === "$") return { code: "quoting", reason: "Dollar quoting and positional parameters are not accepted." };
    if (c === "'") {
      const prev = out.at(-1);
      if (prev && prev.t === "word" && /^[eubx]$/i.test(prev.v) && sql[i - 1] === prev.v) return { code: "quoting", reason: "Escape, binary and Unicode strings are not accepted." };
      let j = i + 1;
      let s = "";
      for (;;) {
        if (j >= sql.length) return { code: "syntax", reason: "A quoted string is not closed." };
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            s += "'";
            j += 2;
            continue;
          }
          break;
        }
        s += sql[j++];
      }
      push("string", s);
      i = j + 1;
      continue;
    }
    if (c === '"') {
      const j = sql.indexOf('"', i + 1);
      if (j < 0) return { code: "syntax", reason: "A quoted name is not closed." };
      const name = sql.slice(i + 1, j);
      out.push({ t: "qident", v: name, lower: name.toLowerCase() });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
      push("word", sql.slice(i, j));
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(sql[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < sql.length && /[0-9.eE]/.test(sql[j])) j++;
      push("number", sql.slice(i, j));
      i = j;
      continue;
    }
    push("punct", c);
    i++;
  }
  return out;
}

/** A possibly qualified name starting at tokens[i]: returns the dotted lower-case name and the index after it. */
function qualifiedName(toks: Tok[], i: number): { name: string; next: number } | undefined {
  const part = (k: number) => (toks[k] && (toks[k].t === "word" || toks[k].t === "qident") ? toks[k].lower : undefined);
  const first = part(i);
  if (!first) return undefined;
  const parts = [first];
  let k = i + 1;
  while (toks[k]?.v === "." && part(k + 1)) {
    parts.push(part(k + 1)!);
    k += 2;
  }
  return { name: parts.join("."), next: k };
}

export function guardSql(input: string, opts: { maxRows?: number; allowed?: readonly string[] } = {}): GuardResult {
  const maxRows = Math.max(1, Math.min(opts.maxRows ?? DEFAULT_MAX_ROWS, 1_000));
  const allowed = new Set((opts.allowed ?? ALLOWED_RELATIONS).map((r) => r.toLowerCase()));
  const bare = new Map([...allowed].map((r) => [r.split(".").at(-1)!, r]));
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, code: "empty", reason: "There is no query." };
  if (raw.length > MAX_SQL_CHARS) return { ok: false, code: "too_long", reason: `Queries are limited to ${MAX_SQL_CHARS} characters.` };
  const sql = raw.replace(/;\s*$/, "");
  const toks = tokenize(sql);
  if (!Array.isArray(toks)) return { ok: false, ...toks };
  if (toks.some((t) => t.v === ";")) return { ok: false, code: "multiple_statements", reason: "Only one statement at a time." };
  const first = toks[0]?.lower;
  if (first !== "select" && first !== "with") return { ok: false, code: "not_select", reason: "Only SELECT (or WITH … SELECT) queries are answered. Nothing here can change data." };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== "word") continue;
    if (t.lower === "into") return { ok: false, code: "write", reason: "SELECT INTO creates a table; not allowed." };
    if (WRITE_WORDS.has(t.lower)) return { ok: false, code: "write", reason: `"${t.v.toUpperCase()}" is not allowed: the copilot only reads.` };
    if (t.lower === "for" && ["update", "share", "no", "key"].includes(toks[i + 1]?.lower ?? "")) return { ok: false, code: "lock", reason: "Locking clauses (FOR UPDATE/SHARE) are not allowed." };
    if (toks[i + 1]?.v === "(" && FUNCTION_DENY.some((re) => re.test(t.lower))) return { ok: false, code: "function", reason: `The function ${t.v}() is not allowed here.` };
    if (/^(pg_catalog|information_schema|pg_toast)$/.test(t.lower) || (/^pg_/.test(t.lower) && toks[i + 1]?.v !== "(")) return { ok: false, code: "catalog", reason: "System catalogues are not part of what the copilot may read." };
  }
  for (const t of toks) if (t.t === "qident" && /^(pg_|information_schema)/.test(t.lower)) return { ok: false, code: "catalog", reason: "System catalogues are not part of what the copilot may read." };

  // CTE names defined by WITH name AS ( ... ) are allowed as relations.
  const ctes = new Set<string>();
  for (let i = 0; i < toks.length - 2; i++) {
    const prev = toks[i - 1]?.lower;
    if ((prev === "with" || prev === "," || prev === "recursive") && (toks[i].t === "word" || toks[i].t === "qident") && toks[i + 1]?.lower === "as" && toks[i + 2]?.v === "(") ctes.add(toks[i].lower);
    if ((prev === "with" || prev === "," || prev === "recursive") && (toks[i].t === "word" || toks[i].t === "qident") && toks[i + 1]?.v === "(") {
      // WITH name (col, ...) AS (
      let k = i + 1;
      while (k < toks.length && toks[k].v !== ")") k++;
      if (toks[k + 1]?.lower === "as") ctes.add(toks[i].lower);
    }
  }

  // Walk the FROM lists.
  const relations = new Set<string>();
  const openers: string[] = []; // the word before each open parenthesis
  type Mode = { depth: number; expectTable: boolean };
  const modes: Mode[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const depth = openers.length;
    const mode = modes.at(-1);
    if (t.v === "(") {
      openers.push(toks[i - 1]?.lower ?? "");
      if (mode && mode.depth === depth) mode.expectTable = false; // a subquery or a table function's arguments
      continue;
    }
    if (t.v === ")") {
      openers.pop();
      while (modes.length && modes.at(-1)!.depth > openers.length) modes.pop();
      continue;
    }
    if (t.lower === "from" && t.t === "word") {
      if (FROM_IN_CALL.has(openers.at(-1) ?? "")) continue;
      while (modes.length && modes.at(-1)!.depth >= depth) modes.pop();
      modes.push({ depth, expectTable: true });
      continue;
    }
    if (!mode || mode.depth !== depth) continue;
    if (t.t === "word" && (t.lower === "join" || t.lower === "lateral")) {
      mode.expectTable = true;
      continue;
    }
    if (t.v === ",") {
      mode.expectTable = true;
      continue;
    }
    if (t.t === "word" && END_FROM.has(t.lower)) {
      if (t.lower === "on" || t.lower === "using") mode.expectTable = false;
      else modes.pop();
      continue;
    }
    if (mode.expectTable && (t.t === "word" || t.t === "qident")) {
      const q = qualifiedName(toks, i)!;
      mode.expectTable = false;
      if (toks[q.next]?.v === "(") {
        if (!TABLE_FUNCTIONS.has(q.name)) return { ok: false, code: "function", reason: `${q.name}() is not a table the copilot may read.` };
        continue;
      }
      const name = q.name;
      const resolved = allowed.has(name) ? name : !name.includes(".") && ctes.has(name) ? `cte:${name}` : !name.includes(".") && bare.has(name) ? bare.get(name)! : undefined;
      if (!resolved) return { ok: false, code: "relation", reason: `"${name}" is not on the copilot's list. It may read: ${[...allowed].join(", ")}.` };
      if (!resolved.startsWith("cte:")) relations.add(resolved);
      i = q.next - 1;
    }
  }
  const wrapped = `select * from (\n${sql}\n) as answer limit ${maxRows + 1}`;
  return { ok: true, sql, wrapped, relations: [...relations], maxRows };
}
