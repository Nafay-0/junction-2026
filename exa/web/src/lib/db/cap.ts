import "server-only";
import { sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/types";
import { USAGE_CAP_CODE, USAGE_CAP_SENTENCE } from "@/lib/usage-cap";
import { database } from "./client";

/*
 * The usage limit. The admin may cap what an account spends in all; once what it has used reaches
 * the cap, nothing more runs for it until the admin raises the cap: new requests are refused, and
 * a task that is running stops at its next step. The admin has no cap.
 *
 * What an account has used is the sum of its usage records, the same figure the admin sees.
 */

export type Cap = {
  /** The limit in US dollars, or null when the account has none. */
  capUsd: number | null;
  /** What the account has used so far, in all. Zero when there is no limit to compare it with. */
  spentUsd: number;
  reached: boolean;
};

const NONE: Cap = { capUsd: null, spentUsd: 0, reached: false };

/** Everything an account has spent, in US dollars. */
export async function spentBy(userId: string): Promise<number> {
  const rows = await database().execute(sql`
    select coalesce(sum(e.llm_cost_usd + e.worker_cost_usd + e.exa_cost_usd + e.decision_cost_usd), 0) as spent
    from usage_events e where e.user_id = ${userId}`);
  return Number(rows[0]?.spent ?? 0) || 0;
}

/**
 * Where an account stands against its limit. If the figures cannot be read, the request goes
 * ahead: a database hiccup must not lock everyone out.
 */
export async function capFor(user: SessionUser): Promise<Cap> {
  if (user.role === "admin" || user.usageCapUsd === null || user.usageCapUsd === undefined) return NONE;
  try {
    const spentUsd = await spentBy(user.id);
    return { capUsd: user.usageCapUsd, spentUsd, reached: spentUsd >= user.usageCapUsd };
  } catch (err) {
    console.warn("[cap] could not read what the account has used", err instanceof Error ? err.message : err);
    return { capUsd: user.usageCapUsd, spentUsd: 0, reached: false };
  }
}

/** What a route answers when the limit is reached: 402, with a code the interface recognises. */
export const capRefusal = () => Response.json({ error: USAGE_CAP_SENTENCE, code: USAGE_CAP_CODE }, { status: 402 });
