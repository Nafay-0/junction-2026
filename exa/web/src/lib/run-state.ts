/**
 * What the server and the interface say to each other about tasks that keep running. Shared by
 * both: no imports, no keys.
 */

/** A request for a conversation that already has a task running is refused with this code. */
export const RUN_ACTIVE_CODE = "run_active";

export const RUN_ACTIVE_SENTENCE = "A task is still running in this conversation. Wait for it to finish, or stop it first.";

/** Asked to join a task that has just ended: load the saved conversation instead. */
export const RUN_GONE_CODE = "run_gone";

/** What `/api/chat/[id]/run` answers: whether a task is running, and the conversation as it was when that task began. */
export type RunState = { active: false } | { active: true; startedAt: number; messages: unknown[] };

/** What `/api/chat/runs` answers: the conversations of this account that have a task running. */
export type RunList = { running: Array<{ id: string; startedAt: number }> };
