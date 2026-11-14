import "server-only";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { endSessionsOf } from "@/lib/auth/session";
import { database } from "./client";
import { users } from "./schema";

/*
 * What only the admin may see or do: every account with its figures, adding, blocking and
 * deleting accounts, and the totals for the overview. The API routes check that the caller is
 * the admin; these functions assume it.
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
  costUsd: number;
};

const ms = (value: unknown): number | null => (value ? new Date(value as string | Date).getTime() : null);
const num = (value: unknown): number => Number(value ?? 0) || 0;

/** Every account, the admin first, then the newest. */
export async function listAccounts(): Promise<Account[]> {
  const rows = await database().execute(sql`
    select u.id, u.email, u.name, u.role, u.status, u.created_at, u.last_login_at, u.last_seen_at,
      (select count(*) from conversations c where c.user_id = u.id) as conversations,
      (select count(*) from usage_events e where e.user_id = u.id) as requests,
      (select coalesce(sum(e.llm_cost_usd + e.worker_cost_usd + e.exa_cost_usd), 0) from usage_events e where e.user_id = u.id) as cost_usd
    from users u
    order by (u.role = 'admin') desc, u.created_at desc
  `);
  return rows.map((r) => ({
    id: String(r.id),
    email: String(r.email),
    name: String(r.name),
    role: r.role === "admin" ? "admin" : "user",
    status: r.status === "blocked" ? "blocked" : "active",
    createdAt: ms(r.created_at) ?? 0,
    lastLoginAt: ms(r.last_login_at),
    lastSeenAt: ms(r.last_seen_at),
    conversations: num(r.conversations),
    requests: num(r.requests),
    costUsd: num(r.cost_usd),
  }));
}

export type AccountResult = { ok: true; id: string } | { ok: false; status: number; error: string };

const isDuplicate = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
};

/** Add an ordinary account. Accounts made here are never admin. */
export async function createAccount(input: { name: string; email: string; password: string }): Promise<AccountResult> {
  try {
    const [row] = await database()
      .insert(users)
      .values({ name: input.name, email: input.email.toLowerCase(), passwordHash: await hashPassword(input.password), role: "user", status: "active" })
      .returning({ id: users.id });
    return { ok: true, id: row.id };
  } catch (err) {
    if (isDuplicate(err)) return { ok: false, status: 409, error: "An account with that email already exists." };
    throw err;
  }
}

/**
 * Change an account: its name, whether it is blocked, or its password. Blocking it or changing
 * its password signs it out everywhere at once. The admin's own account cannot be blocked here,
 * and its password belongs to the ADMIN_PASSWORD variable.
 */
export async function updateAccount(id: string, change: { name?: string; status?: "active" | "blocked"; password?: string }): Promise<AccountResult> {
  const db = database();
  const [target] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, id)).limit(1);
  if (!target) return { ok: false, status: 404, error: "There is no such account." };
  if (target.role === "admin" && change.status === "blocked") return { ok: false, status: 400, error: "The admin account cannot be blocked." };
  if (target.role === "admin" && change.password !== undefined) {
    return { ok: false, status: 400, error: "The admin's password is set by ADMIN_PASSWORD on the server. Change it there and restart." };
  }
  await db
    .update(users)
    .set({
      ...(change.name !== undefined ? { name: change.name } : {}),
      ...(change.status !== undefined ? { status: change.status } : {}),
      ...(change.password !== undefined ? { passwordHash: await hashPassword(change.password) } : {}),
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

/* ───────────────────────── The overview ───────────────────────── */

export type Spend = { modelUsd: number; workerUsd: number; exaUsd: number };

export type Overview = {
  days: number;
  accounts: { total: number; blocked: number; active7d: number };
  conversations: { total: number; web: number; desktop: number };
  /** Within the chosen period. */
  period: Spend & { requests: number; tokens: number; exaCalls: number; activeAccounts: number };
  allTime: Spend & { requests: number };
  /** One entry per day of the period, oldest first, days without use included. Days are UTC. */
  daily: Array<Spend & { day: string; requests: number; tokens: number }>;
  byModel: Array<{ label: string; requests: number; tokens: number; costUsd: number }>;
  byClient: Array<{ client: "web" | "desktop"; requests: number; costUsd: number }>;
  topAccounts: Array<{ id: string | null; name: string; email: string; requests: number; tokens: number; costUsd: number }>;
};

const TOKENS = sql`(e.input_tokens + e.output_tokens + e.worker_input_tokens + e.worker_output_tokens)`;
const COST = sql`(e.llm_cost_usd + e.worker_cost_usd + e.exa_cost_usd)`;

/** The figures for the admin's overview, for the last `days` days (today included). */
export async function overview(days: number): Promise<Overview> {
  const db = database();
  const span = Math.min(Math.max(Math.round(days) || 14, 1), 90);
  // The period starts at midnight UTC, `span - 1` days ago, so "14 days" is today and the 13 before it.
  const since = sql`(date_trunc('day', now() at time zone 'utc') - make_interval(days => ${span - 1})) at time zone 'utc'`;

  const [accountRows, conversationRows, periodRows, allTimeRows, dailyRows, modelRows, clientRows, topRows] = await Promise.all([
    db.execute(sql`select count(*) as total, count(*) filter (where status = 'blocked') as blocked, count(*) filter (where last_seen_at > now() - interval '7 days') as active from users`),
    db.execute(sql`select count(*) as total, count(*) filter (where origin = 'desktop') as desktop from conversations`),
    db.execute(sql`
      select count(*) as requests, coalesce(sum(${TOKENS}), 0) as tokens,
        coalesce(sum(e.llm_cost_usd), 0) as model_usd, coalesce(sum(e.worker_cost_usd), 0) as worker_usd, coalesce(sum(e.exa_cost_usd), 0) as exa_usd,
        coalesce(sum(e.exa_search_calls + e.exa_contents_calls + e.exa_agent_calls + e.exa_answer_calls), 0) as exa_calls,
        count(distinct e.user_id) as accounts
      from usage_events e where e.created_at >= ${since}`),
    db.execute(sql`
      select count(*) as requests, coalesce(sum(e.llm_cost_usd), 0) as model_usd, coalesce(sum(e.worker_cost_usd), 0) as worker_usd, coalesce(sum(e.exa_cost_usd), 0) as exa_usd
      from usage_events e`),
    db.execute(sql`
      select to_char(date_trunc('day', e.created_at at time zone 'utc'), 'YYYY-MM-DD') as day, count(*) as requests, coalesce(sum(${TOKENS}), 0) as tokens,
        coalesce(sum(e.llm_cost_usd), 0) as model_usd, coalesce(sum(e.worker_cost_usd), 0) as worker_usd, coalesce(sum(e.exa_cost_usd), 0) as exa_usd
      from usage_events e where e.created_at >= ${since} group by 1 order by 1`),
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
    daily.push({ day, requests: num(r?.requests), tokens: num(r?.tokens), modelUsd: num(r?.model_usd), workerUsd: num(r?.worker_usd), exaUsd: num(r?.exa_usd) });
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
      activeAccounts: num(periodRows[0]?.accounts),
      modelUsd: num(periodRows[0]?.model_usd),
      workerUsd: num(periodRows[0]?.worker_usd),
      exaUsd: num(periodRows[0]?.exa_usd),
    },
    allTime: {
      requests: num(allTimeRows[0]?.requests),
      modelUsd: num(allTimeRows[0]?.model_usd),
      workerUsd: num(allTimeRows[0]?.worker_usd),
      exaUsd: num(allTimeRows[0]?.exa_usd),
    },
    daily,
    byModel: modelRows.map((r) => ({ label: String(r.label), requests: num(r.requests), tokens: num(r.tokens), costUsd: num(r.cost_usd) })),
    byClient: [client("web"), client("desktop")],
    topAccounts: topRows.map((r) => ({ id: r.id ? String(r.id) : null, name: String(r.name), email: String(r.email), requests: num(r.requests), tokens: num(r.tokens), costUsd: num(r.cost_usd) })),
  };
}
