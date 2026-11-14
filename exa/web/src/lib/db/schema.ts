import { sql } from "drizzle-orm";
import { bigserial, check, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
    lastLoginAt: at("last_login_at"),
    /** The last time a signed-in request came from this account (kept to the nearest few minutes). */
    lastSeenAt: at("last_seen_at"),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(t.email),
    check("users_role_check", sql`${t.role} in ('user', 'admin')`),
    check("users_status_check", sql`${t.status} in ('active', 'blocked')`),
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
 */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    conversationId: text("conversation_id"),
    client: text("client", { enum: ["web", "desktop"] }).notNull().default("web"),
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
  ],
);

export type UserRow = typeof users.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
