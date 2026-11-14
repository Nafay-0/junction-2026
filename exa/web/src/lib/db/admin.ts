import "server-only";
import { eq, sql } from "drizzle-orm";
import { LOWEST_MODE, MODE_IDS, cleanModes, getMode, isMode, type ModeId } from "@/lib/agent/modes";
import type { Spend } from "@/lib/agent/stats";
import { hashPassword } from "@/lib/auth/password";
import { endSessionsOf, permissionsOf } from "@/lib/auth/session";
import { database } from "./client";
import { users } from "./schema";

/*
 * What only the admin may see or do: every account with its figures, adding, blocking and
 * deleting accounts, what each account may use, and the totals for the overview. The API routes
 * check that the caller is the admin; these functions assume it.
 *
 * Nothing is hidden here: the admin sees which model stood behind each request, as well as the
 * mode the user had picked.
 */

export type Account = {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  status: "active" | "blocked";
  createdAt: number;
  lastLoginAt: number | null;
  lastSeenAt: number | null;
  conversations: number;
  requests: number;
  /** Everything the account has cost since it was made. This is what its limit is compared with. */
  costUsd: number;
  /** The modes the account may use, quickest first. The admin's own are all of them. */
  modes: ModeId[];
  /** Whether the account sees what its conversations and answers cost. The admin always does. */
  showUsage: boolean;
  /** The most the account may spend in all, in US dollars. Null is no limit. The admin has none. */
  usageCapUsd: number | null;
};

const ms = (value: unknown): number | null => (value ? new Date(value as string | Date).getTime() : null);
const num = (value: unknown): number => Number(value ?? 0) || 0;

/** Tokens in and out of a row, helpers included. */
const TOKENS = sql`(e.input_tokens + e.output_tokens + e.worker_input_tokens + e.worker_output_tokens)`;
/** Everything a row cost. */
const COST = sql`(e.llm_cost_usd + e.worker_cost_usd + e.exa_cost_usd + e.decision_cost_usd)`;
/**
 * The cost of a set of rows, by kind. The model's own cost is "LLMs" for a typed request and for
 * a run of a job, and "Voice" for a call; sub-agents and helpers are LLMs whoever asked for them.
 */
const SPEND = sql`
  coalesce(sum(case when e.kind in ('chat', 'job') then e.llm_cost_usd else 0 end + e.worker_cost_usd), 0) as llm_usd,
  coalesce(sum(e.exa_cost_usd), 0) as exa_usd,
  coalesce(sum(case when e.kind in ('chat', 'job') then 0 else e.llm_cost_usd end), 0) as voice_usd,
  coalesce(sum(e.decision_cost_usd), 0) as decisions_usd`;
/** The mode of a row, or what stands in for one: "voice" for a call and its tools, "before" for a typed request from before modes. */
const MODE_KEY = sql`coalesce(e.mode, case when e.kind in ('chat', 'job') then 'before' else 'voice' end)`;
/** How many of the rows are runs of scheduled jobs, and what those cost: a share of the figures above, not on top of them. */
const JOBS = sql`
  count(*) filter (where e.kind = 'job') as job_runs,
  coalesce(sum(e.llm_cost_usd + e.worker_cost_usd + e.exa_cost_usd + e.decision_cost_usd) filter (where e.kind = 'job'), 0) as job_usd`;

type Row = Record<string, unknown>;
const spendOf = (r: Row | undefined): Spend => ({ llm: num(r?.llm_usd), exa: num(r?.exa_usd), voice: num(r?.voice_usd), decisions: num(r?.decisions_usd) });

/** Every account, the admin first, then the newest. */
export async function listAccounts(): Promise<Account[]> {
  const rows = await database().execute(sql`
    select u.id, u.email, u.name, u.role, u.status, u.created_at, u.last_login_at, u.last_seen_at, u.modes, u.show_usage, u.usage_cap_usd,
      (select count(*) from conversations c where c.user_id = u.id) as conversations,
      (select count(*) from usage_events e where e.user_id = u.id) as requests,
      (select coalesce(sum(${COST}), 0) from usage_events e where e.user_id = u.id) as cost_usd
    from users u
    order by (u.role = 'admin') desc, u.created_at desc
  `);
  return rows.map((r) => {
    const role = r.role === "admin" ? "admin" : "user";
    return {
      id: String(r.id),
      email: String(r.email),
      name: String(r.name),
      role,
      status: r.status === "blocked" ? "blocked" : "active",
      createdAt: ms(r.created_at) ?? 0,
      lastLoginAt: ms(r.last_login_at),
      lastSeenAt: ms(r.last_seen_at),
      conversations: num(r.conversations),
      requests: num(r.requests),
      costUsd: num(r.cost_usd),
      ...permissionsOf({ role, modes: r.modes, showUsage: r.show_usage === true, usageCapUsd: r.usage_cap_usd === null || r.usage_cap_usd === undefined ? null : num(r.usage_cap_usd) }),
    };
  });
}

export type AccountResult = { ok: true; id: string } | { ok: false; status: number; error: string };

const isDuplicate = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
};

/**
 * Add an ordinary account. Accounts made here are never admin. Unless the admin says otherwise it
 * starts with the quickest mode only, does not see what it costs, and has no spending limit.
 */
export async function createAccount(input: { name: string; email: string; password: string; modes?: ModeId[]; showUsage?: boolean; usageCapUsd?: number | null }): Promise<AccountResult> {
  try {
    const [row] = await database()
      .insert(users)
      .values({
        name: input.name,
        email: input.email.toLowerCase(),
        passwordHash: await hashPassword(input.password),
        role: "user",
        status: "active",
        modes: cleanModes(input.modes ?? [LOWEST_MODE]),
        showUsage: input.showUsage === true,
        usageCapUsd: input.usageCapUsd ?? null,
      })
      .returning({ id: users.id });
    return { ok: true, id: row.id };
  } catch (err) {
    if (isDuplicate(err)) return { ok: false, status: 409, error: "An account with that email already exists." };
    throw err;
  }
}

export type AccountChanges = {
  name?: string;
  status?: "active" | "blocked";
  password?: string;
  /** The modes it may use: at least one. */
  modes?: ModeId[];
  showUsage?: boolean;
  /** A new spending limit, or null to remove it. */
  usageCapUsd?: number | null;
};

/**
 * Change an account: its name, whether it is blocked, its password, the modes it may use, whether
 * it sees usage, or its spending limit. Blocking it or changing its password signs it out
 * everywhere at once; the rest takes effect on its next request. The admin's own account cannot
 * be blocked here, its password belongs to the ADMIN_PASSWORD variable, and what it may use is
 * fixed: every mode, usage in view, no limit.
 */
export async function updateAccount(id: string, change: AccountChanges): Promise<AccountResult> {
  const db = database();
  const [target] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, id)).limit(1);
  if (!target) return { ok: false, status: 404, error: "There is no such account." };
  if (target.role === "admin" && change.status === "blocked") return { ok: false, status: 400, error: "The admin account cannot be blocked." };
  if (target.role === "admin" && change.password !== undefined) {
    return { ok: false, status: 400, error: "The admin's password is set by ADMIN_PASSWORD on the server. Change it there and restart." };
  }
  if (target.role === "admin" && (change.modes !== undefined || change.showUsage !== undefined || change.usageCapUsd !== undefined)) {
    return { ok: false, status: 400, error: "The admin account always has every mode, sees usage and has no limit. There is nothing to change." };
  }
  await db
    .update(users)
    .set({
      ...(change.name !== undefined ? { name: change.name } : {}),
      ...(change.status !== undefined ? { status: change.status } : {}),
      ...(change.password !== undefined ? { passwordHash: await hashPassword(change.password) } : {}),
      ...(change.modes !== undefined ? { modes: cleanModes(change.modes) } : {}),
      ...(change.showUsage !== undefined ? { showUsage: change.showUsage } : {}),
      ...(change.usageCapUsd !== undefined ? { usageCapUsd: change.usageCapUsd } : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, id));
  if (change.status === "blocked" || change.password !== undefined) await endSessionsOf(id);
  return { ok: true, id };
}

/** Delete an account with its sign-ins and conversations. What it cost stays in the totals. */
export async function deleteAccount(id: string): Promise<AccountResult> {
  const db = database();
  const [target] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, id)).limit(1);
  if (!target) return { ok: false, status: 404, error: "There is no such account." };
  if (target.role === "admin") return { ok: false, status: 400, error: "The admin account cannot be deleted." };
  await db.delete(users).where(eq(users.id, id));
  return { ok: true, id };
}

/* ───────────────────────── Usage, by mode and by model ───────────────────────── */

/** One line of a "by mode" table. `mode` is a mode's id, "voice" (a call and the tools it ran) or "before" (typed requests from before modes). */
export type ModeUsage = { mode: ModeId | "voice" | "before"; label: string; requests: number; tokens: number; costUsd: number };
/** One line of a "by model" table: the model that did the work, by the name it is recorded under. */
export type ModelUsage = { label: string; requests: number; tokens: number; costUsd: number };

/** In the order the modes are offered, then voice, then what came before modes. */
const MODE_ORDER: string[] = [...MODE_IDS, "voice", "before"];

function modeRows(rows: Row[]): ModeUsage[] {
  return rows
    .map((r) => {
      const key = String(r.mode);
      const mode: ModeUsage["mode"] = isMode(key) ? key : key === "voice" ? "voice" : "before";
      const label = isMode(key) ? getMode(key).label : mode === "voice" ? "Voice" : "Before modes";
      return { mode, label, requests: num(r.requests), tokens: num(r.tokens), costUsd: num(r.cost_usd) };
    })
    .sort((a, b) => MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode));
}

const modelRows = (rows: Row[]): ModelUsage[] => rows.map((r) => ({ label: String(r.label), requests: num(r.requests), tokens: num(r.tokens), costUsd: num(r.cost_usd) }));

/** The length of a period in days, kept within reason. */
const spanOf = (days: number) => Math.min(Math.max(Math.round(days) || 14, 1), 90);
/** The period starts at midnight UTC, `span - 1` days ago, so "14 days" is today and the 13 before it. */
const sinceOf = (span: number) => sql`(date_trunc('day', now() at time zone 'utc') - make_interval(days => ${span - 1})) at time zone 'utc'`;

/* ───────────────────────── The overview ───────────────────────── */

export type Overview = {
  days: number;
  accounts: { total: number; blocked: number; active7d: number };
  conversations: { total: number; web: number; desktop: number };
  /** Within the chosen period. */
  /** `jobRuns` and `jobsUsd` are the runs of scheduled jobs among the requests, and their share of the cost. */
  period: Spend & { requests: number; tokens: number; exaCalls: number; decisionCalls: number; jobRuns: number; jobsUsd: number; activeAccounts: number };
  allTime: Spend & { requests: number };
  /** One entry per day of the period, oldest first, days without use included. Days are UTC. */
  daily: Array<Spend & { day: string; requests: number; tokens: number }>;
  byMode: ModeUsage[];
  byModel: ModelUsage[];
  byClient: Array<{ client: "web" | "desktop"; requests: number; costUsd: number }>;
  topAccounts: Array<{ id: string | null; name: string; email: string; requests: number; tokens: number; costUsd: number }>;
};

/** The figures for the admin's overview, for the last `days` days (today included). */
export async function overview(days: number): Promise<Overview> {
  const db = database();
  const span = spanOf(days);
  const since = sinceOf(span);

  const [accountRows, conversationRows, periodRows, allTimeRows, dailyRows, modeRowsRaw, modelRowsRaw, clientRows, topRows] = await Promise.all([
    db.execute(sql`select count(*) as total, count(*) filter (where status = 'blocked') as blocked, count(*) filter (where last_seen_at > now() - interval '7 days') as active from users`),
    db.execute(sql`select count(*) as total, count(*) filter (where origin = 'desktop') as desktop from conversations`),
    db.execute(sql`
      select count(*) as requests, coalesce(sum(${TOKENS}), 0) as tokens, ${SPEND}, ${JOBS},
        coalesce(sum(e.exa_search_calls + e.exa_contents_calls + e.exa_agent_calls + e.exa_answer_calls), 0) as exa_calls,
        coalesce(sum(e.decision_calls), 0) as decision_calls,
        count(distinct e.user_id) as accounts
      from usage_events e where e.created_at >= ${since}`),
    db.execute(sql`select count(*) as requests, ${SPEND} from usage_events e`),
    db.execute(sql`
      select to_char(date_trunc('day', e.created_at at time zone 'utc'), 'YYYY-MM-DD') as day, count(*) as requests, coalesce(sum(${TOKENS}), 0) as tokens, ${SPEND}
      from usage_events e where e.created_at >= ${since} group by 1 order by 1`),
    db.execute(sql`
      select ${MODE_KEY} as mode, count(*) as requests, coalesce(sum(${TOKENS}), 0) as tokens, coalesce(sum(${COST}), 0) as cost_usd
      from usage_events e where e.created_at >= ${since} group by 1`),
    db.execute(sql`
      select e.model_label as label, count(*) as requests, coalesce(sum(${TOKENS}), 0) as tokens, coalesce(sum(${COST}), 0) as cost_usd
      from usage_events e where e.created_at >= ${since} group by 1 order by cost_usd desc, requests desc`),
    db.execute(sql`
      select e.client, count(*) as requests, coalesce(sum(${COST}), 0) as cost_usd
      from usage_events e where e.created_at >= ${since} group by 1`),
    db.execute(sql`
      select e.user_id as id, coalesce(u.name, 'Deleted account') as name, coalesce(u.email, '') as email, count(*) as requests,
        coalesce(sum(${TOKENS}), 0) as tokens, coalesce(sum(${COST}), 0) as cost_usd
      from usage_events e left join users u on u.id = e.user_id
      where e.created_at >= ${since} group by e.user_id, u.name, u.email order by cost_usd desc, requests desc limit 8`),
  ]);

  const used = new Map(dailyRows.map((r) => [String(r.day), r]));
  const today = new Date();
  const daily: Overview["daily"] = [];
  for (let i = span - 1; i >= 0; i--) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i)).toISOString().slice(0, 10);
    const r = used.get(day);
    daily.push({ day, requests: num(r?.requests), tokens: num(r?.tokens), ...spendOf(r) });
  }

  const totalConversations = num(conversationRows[0]?.total);
  const desktopConversations = num(conversationRows[0]?.desktop);
  const client = (kind: "web" | "desktop") => {
    const r = clientRows.find((row) => row.client === kind);
    return { client: kind, requests: num(r?.requests), costUsd: num(r?.cost_usd) };
  };

  return {
    days: span,
    accounts: { total: num(accountRows[0]?.total), blocked: num(accountRows[0]?.blocked), active7d: num(accountRows[0]?.active) },
    conversations: { total: totalConversations, web: totalConversations - desktopConversations, desktop: desktopConversations },
    period: {
      requests: num(periodRows[0]?.requests),
      tokens: num(periodRows[0]?.tokens),
      exaCalls: num(periodRows[0]?.exa_calls),
      decisionCalls: num(periodRows[0]?.decision_calls),
      jobRuns: num(periodRows[0]?.job_runs),
      jobsUsd: num(periodRows[0]?.job_usd),
      activeAccounts: num(periodRows[0]?.accounts),
      ...spendOf(periodRows[0]),
    },
    allTime: { requests: num(allTimeRows[0]?.requests), ...spendOf(allTimeRows[0]) },
    daily,
    byMode: modeRows(modeRowsRaw),
    byModel: modelRows(modelRowsRaw),
    byClient: [client("web"), client("desktop")],
    topAccounts: topRows.map((r) => ({ id: r.id ? String(r.id) : null, name: String(r.name), email: String(r.email), requests: num(r.requests), tokens: num(r.tokens), costUsd: num(r.cost_usd) })),
  };
}

/* ───────────────────────── One account's usage ───────────────────────── */

export type AccountUsage = {
  days: number;
  account: { id: string; name: string; email: string; role: "user" | "admin" };
  /** Within the chosen period. */
  period: Spend & { requests: number; tokens: number; exaCalls: number; decisionCalls: number; jobRuns: number; jobsUsd: number };
  /** Since the account was made: the total is what its limit is compared with. */
  allTime: Spend & { requests: number };
  usageCapUsd: number | null;
  byMode: ModeUsage[];
  byModel: ModelUsage[];
};

/** What one account used in the last `days` days, by kind of cost, by mode and by model. Null when there is no such account. */
export async function accountUsage(id: string, days: number): Promise<AccountUsage | null> {
  const db = database();
  const [account] = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, modes: users.modes, showUsage: users.showUsage, usageCapUsd: users.usageCapUsd }).from(users).where(eq(users.id, id)).limit(1);
  if (!account) return null;
  const span = spanOf(days);
  const since = sinceOf(span);

  const [periodRows, allTimeRows, modeRowsRaw, modelRowsRaw] = await Promise.all([
    db.execute(sql`
      select count(*) as requests, coalesce(sum(${TOKENS}), 0) as tokens, ${SPEND}, ${JOBS},
        coalesce(sum(e.exa_search_calls + e.exa_contents_calls + e.exa_agent_calls + e.exa_answer_calls), 0) as exa_calls,
        coalesce(sum(e.decision_calls), 0) as decision_calls
      from usage_events e where e.user_id = ${id} and e.created_at >= ${since}`),
    db.execute(sql`select count(*) as requests, ${SPEND} from usage_events e where e.user_id = ${id}`),
    db.execute(sql`
      select ${MODE_KEY} as mode, count(*) as requests, coalesce(sum(${TOKENS}), 0) as tokens, coalesce(sum(${COST}), 0) as cost_usd
      from usage_events e where e.user_id = ${id} and e.created_at >= ${since} group by 1`),
    db.execute(sql`
      select e.model_label as label, count(*) as requests, coalesce(sum(${TOKENS}), 0) as tokens, coalesce(sum(${COST}), 0) as cost_usd
      from usage_events e where e.user_id = ${id} and e.created_at >= ${since} group by 1 order by cost_usd desc, requests desc`),
  ]);

  return {
    days: span,
    account: { id: account.id, name: account.name, email: account.email, role: account.role },
    period: {
      requests: num(periodRows[0]?.requests),
      tokens: num(periodRows[0]?.tokens),
      exaCalls: num(periodRows[0]?.exa_calls),
      decisionCalls: num(periodRows[0]?.decision_calls),
      jobRuns: num(periodRows[0]?.job_runs),
      jobsUsd: num(periodRows[0]?.job_usd),
      ...spendOf(periodRows[0]),
    },
    allTime: { requests: num(allTimeRows[0]?.requests), ...spendOf(allTimeRows[0]) },
    usageCapUsd: permissionsOf(account).usageCapUsd,
    byMode: modeRows(modeRowsRaw),
    byModel: modelRows(modelRowsRaw),
  };
}
