import { sql } from "drizzle-orm";
import { bigserial, boolean, check, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/*
 * Everything Beryl keeps on the server: accounts, their sign-ins, their conversations, and what
 * each model request cost. Preferences, the theme and the desktop app's website sign-ins stay on
 * the user's own device.
 *
 * This file is read by drizzle-kit as plain TypeScript, so it imports nothing from the app.
 * After changing it: `pnpm db:generate`, then commit the new file in drizzle/.
 */

const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** An account. Created by the admin; the one admin account comes from ADMIN_EMAIL. */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stored lower-case. */
    email: text("email").notNull(),
    name: text("name").notNull(),
    /** scrypt, with its own salt and parameters in the string. Never the password. */
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
    status: text("status", { enum: ["active", "blocked"] }).notNull().default("active"),
    /**
     * The modes this account may use (the ids in src/lib/agent/modes.ts). A new account has only
     * the quickest one; the admin switches the others on. The admin's own account has every mode
     * whatever is stored here.
     */
    modes: text("modes").array().notNull().default(sql`'{ultrafast}'::text[]`),
    /** Whether the account sees what its conversations and answers cost and used. Off for a new account. */
    showUsage: boolean("show_usage").notNull().default(false),
    /**
     * The most the account may spend in all, in US dollars. Null is no limit. When what it has
     * used reaches this, nothing more runs for it until the admin raises or removes the limit.
     */
    usageCapUsd: doublePrecision("usage_cap_usd"),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
    lastLoginAt: at("last_login_at"),
    /** The last time a signed-in request came from this account (kept to the nearest few minutes). */
    lastSeenAt: at("last_seen_at"),
    /**
     * Which emails the account wants (src/lib/notifications/types.ts). Only what differs from the
     * defaults is stored, so a new default reaches everyone who never touched the setting.
     */
    notify: jsonb("notify").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(t.email),
    check("users_role_check", sql`${t.role} in ('user', 'admin')`),
    check("users_status_check", sql`${t.status} in ('active', 'blocked')`),
    check("users_modes_check", sql`cardinality(${t.modes}) >= 1`),
    check("users_usage_cap_check", sql`${t.usageCapUsd} is null or ${t.usageCapUsd} > 0`),
  ],
);

/** One sign-in on one device. The cookie holds a random token; only its SHA-256 is stored. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Where the sign-in happened: the web, or the desktop app. */
    client: text("client", { enum: ["web", "desktop"] }).notNull().default("web"),
    userAgent: text("user_agent"),
    createdAt: at("created_at").notNull().defaultNow(),
    lastSeenAt: at("last_seen_at").notNull().defaultNow(),
    expiresAt: at("expires_at").notNull(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_unique").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
    check("sessions_client_check", sql`${t.client} in ('web', 'desktop')`),
  ],
);

/**
 * A conversation, with its whole message list as the interface holds it. The id is chosen by the
 * client, so it is only unique within one account: the key is the account and the id together,
 * which also means nobody can reach or overwrite another account's conversation by guessing ids.
 */
export const conversations = pgTable(
  "conversations",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    title: text("title").notNull(),
    /** Where it was started. It never changes: from the other kind of client it is read-only. */
    origin: text("origin", { enum: ["web", "desktop"] }).notNull(),
    modelLabel: text("model_label"),
    messages: jsonb("messages").notNull().default(sql`'[]'::jsonb`),
    messageCount: integer("message_count").notNull().default(0),
    /** The user asked to be told when the answer being worked on here is finished. Cleared once they are. */
    notifyWhenDone: boolean("notify_when_done").notNull().default(false),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    index("conversations_user_updated_idx").on(t.userId, t.updatedAt.desc()),
    check("conversations_origin_check", sql`${t.origin} in ('web', 'desktop')`),
  ],
);

/**
 * What one request to a model used and cost. A request is one round of the agent: an answer that
 * pauses for a question or an approval is several. Rows outlive the account (the user becomes
 * null), so past spend still adds up after an account is deleted.
 *
 * The cost of a row falls into four kinds: LLMs (`llm_cost_usd` of a typed request, and
 * `worker_cost_usd` of any row), Exa (`exa_cost_usd`), voice (`llm_cost_usd` of a voice row) and
 * decisions (`decision_cost_usd`). The total is the four columns added up.
 */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    conversationId: text("conversation_id"),
    client: text("client", { enum: ["web", "desktop"] }).notNull().default("web"),
    /**
     * "chat": a typed request. "voice": the voice of a live call, or voice input. "tool": a tool
     * that ran on behalf of a live call (it has no model cost of its own, only what the tool spent).
     * "job": one run of a scheduled job (`conversation_id` then holds the job's id).
     */
    kind: text("kind", { enum: ["chat", "voice", "tool", "job"] }).notNull().default("chat"),
    /** The mode the user had picked and where the effort dial stood. Null for voice, and for rows from before modes. */
    mode: text("mode"),
    effort: integer("effort"),
    modelId: text("model_id").notNull(),
    modelLabel: text("model_label").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    /** Sub-agents and helper calls made inside tools. */
    workerInputTokens: integer("worker_input_tokens").notNull().default(0),
    workerOutputTokens: integer("worker_output_tokens").notNull().default(0),
    llmCostUsd: doublePrecision("llm_cost_usd").notNull().default(0),
    workerCostUsd: doublePrecision("worker_cost_usd").notNull().default(0),
    exaCostUsd: doublePrecision("exa_cost_usd").notNull().default(0),
    /** The decision model behind sift: what it cost and how many requests it took. */
    decisionCostUsd: doublePrecision("decision_cost_usd").notNull().default(0),
    decisionCalls: integer("decision_calls").notNull().default(0),
    exaSearchCalls: integer("exa_search_calls").notNull().default(0),
    exaContentsCalls: integer("exa_contents_calls").notNull().default(0),
    exaAgentCalls: integer("exa_agent_calls").notNull().default(0),
    exaAnswerCalls: integer("exa_answer_calls").notNull().default(0),
    steps: integer("steps").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("usage_events_created_idx").on(t.createdAt),
    index("usage_events_user_created_idx").on(t.userId, t.createdAt),
    check("usage_events_client_check", sql`${t.client} in ('web', 'desktop')`),
    check("usage_events_kind_check", sql`${t.kind} in ('chat', 'voice', 'tool', 'job')`),
  ],
);

/**
 * A scheduled job: something the agent does by itself at set times, with the result emailed to
 * the account and kept as a run. Made in a chat from what the user asked for. A job only reads
 * the web and uses the tools a chat on the web has; it never acts in a browser.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** What the user wants, in a sentence or two. */
    description: text("description").notNull(),
    /** The instructions the agent wrote for each run: what to look up and how to lay out the result. */
    prompt: text("prompt").notNull(),
    /** When it runs (src/lib/jobs/schedule.ts): once, every so often, or by a cron line. */
    schedule: jsonb("schedule").notNull(),
    /** The schedule in plain words, as shown to the user. */
    scheduleText: text("schedule_text").notNull(),
    /** The time zone the schedule is meant in. */
    timeZone: text("time_zone").notNull(),
    /** A repeating job stops after this moment, or after this many runs, whichever comes first. */
    untilAt: at("until_at"),
    maxRuns: integer("max_runs"),
    /** "active": it runs on schedule. "paused": it waits. "done": it has no run left. */
    status: text("status", { enum: ["active", "paused", "done"] }).notNull().default("active"),
    /** The mode and effort each run uses, taken from the chat it was made in. */
    mode: text("mode").notNull(),
    effort: integer("effort").notNull().default(1),
    /** Where the user was when they made it, so "here" means something in a run. */
    place: text("place"),
    country: text("country"),
    coords: jsonb("coords"),
    /** The next scheduled run. Null when there is none (done), and kept while paused so the list can say what was due. */
    nextRunAt: at("next_run_at"),
    lastRunAt: at("last_run_at"),
    /** Scheduled runs so far. "Run now" does not count. */
    runCount: integer("run_count").notNull().default(0),
    /** The chat it was made in. */
    conversationId: text("conversation_id"),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("jobs_user_idx").on(t.userId, t.createdAt.desc()),
    index("jobs_due_idx").on(t.status, t.nextRunAt),
    check("jobs_status_check", sql`${t.status} in ('active', 'paused', 'done')`),
    check("jobs_max_runs_check", sql`${t.maxRuns} is null or ${t.maxRuns} > 0`),
  ],
);

/** One run of a job: when, how it went, what it produced and what it cost. */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "schedule": its time came. "manual": someone pressed Run now. */
    trigger: text("trigger", { enum: ["schedule", "manual"] }).notNull().default("schedule"),
    /** "skipped": it did not run, and `error` says why (the usage limit, a blocked account). */
    status: text("status", { enum: ["running", "done", "failed", "skipped"] }).notNull().default("running"),
    startedAt: at("started_at").notNull().defaultNow(),
    finishedAt: at("finished_at"),
    /** The result as the agent wrote it (Markdown). This is what the email carries. */
    output: text("output"),
    /** The run as the interface shows it: the agent's message with its steps, cards and sources. */
    messages: jsonb("messages").notNull().default(sql`'[]'::jsonb`),
    /** Why it failed or was skipped, in a sentence. */
    error: text("error"),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    /** When the result was emailed. Null when it was not (emails off, or nothing to send). */
    emailedAt: at("emailed_at"),
  },
  (t) => [
    index("job_runs_job_idx").on(t.jobId, t.startedAt.desc()),
    check("job_runs_trigger_check", sql`${t.trigger} in ('schedule', 'manual')`),
    check("job_runs_status_check", sql`${t.status} in ('running', 'done', 'failed', 'skipped')`),
  ],
);

/**
 * Something the account is told about: a chat it asked to hear about has finished, the live
 * browser is waiting for it, a job has run. Always shown in the app; emailed only when the
 * account's settings say so and, for most kinds, only when the user is away.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["chat_done", "needs_you", "job_done", "job_failed"] }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    /** What it is about, so a click opens it. */
    conversationId: text("conversation_id"),
    jobId: uuid("job_id"),
    runId: uuid("run_id"),
    /** Tells the same event apart from a new one: a second notice with this key is not made. */
    dedupe: text("dedupe"),
    createdAt: at("created_at").notNull().defaultNow(),
    readAt: at("read_at"),
    /** For "needs you": the user has dealt with it, so no email is due any more. */
    resolvedAt: at("resolved_at"),
    emailedAt: at("emailed_at"),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.createdAt.desc()),
    uniqueIndex("notifications_dedupe_unique").on(t.userId, t.dedupe),
    check("notifications_kind_check", sql`${t.kind} in ('chat_done', 'needs_you', 'job_done', 'job_failed')`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type JobRunRow = typeof jobRuns.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
