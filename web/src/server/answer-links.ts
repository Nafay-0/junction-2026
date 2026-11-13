import { randomBytes } from "node:crypto";
import { DockError } from "@/core/errors";
import type { IntakeView } from "@/core/intake";
import type { AgentSession } from "@/core/orders";

/**
 * One-time answer links. On paths without the protocol's own human-input mechanism (plain REST, an MCP client that
 * cannot elicit), an intake step that waits for the buyer's own answer (needs_confirmation, needs_input) carries an
 * `answerUrl`: a page on Dock where a person picks one of Dock's fixed choices. The agent is told to hand it to the
 * buyer instead of relaying the answer, so the words that reach the ledger are Dock's choices, not a model's
 * paraphrase or an invented choice id.
 *
 *   - single use: the first answer spends the link; a step that waits for the buyer again gets a new one;
 *   - bound to one request and the exact step (its concern keys or question ids): a stale link cannot answer a
 *     later question;
 *   - expires after ANSWER_LINK_MINUTES; kept in memory (one process, like the door log): a restart ends every link,
 *     and the agent simply gets a new one with the next step it reads.
 *
 * Whoever holds the link can answer, so it does not identify a person by itself: the answer is recorded with the
 * channel `answer_link`, named after the person only when their kitchen's signed-in session is present (intake.ts).
 */
export const ANSWER_LINK_MINUTES = 30;
const MAX_LINKS = 2000;

type Link = { session: AgentSession; requestId: string; state: IntakeView["state"]; keys: string; expiresAt: number; usedAt?: number };

const g = globalThis as typeof globalThis & { __dockAnswerLinks?: Map<string, Link> };
const links = (g.__dockAnswerLinks ??= new Map<string, Link>());

const keysOf = (step: Pick<IntakeView, "state" | "concerns" | "questions">) =>
  step.state === "needs_confirmation" ? step.concerns.map((c) => c.key).join("|") : step.questions.map((q) => q.id).join("|");

export const needsBuyer = (state: string) => state === "needs_confirmation" || state === "needs_input";

/** The answer link for a step that waits for the buyer, or undefined. Reuses a live unused link for the same step. */
export function answerLinkFor(session: AgentSession, step: Pick<IntakeView, "requestId" | "state" | "concerns" | "questions">, origin: string, now = Date.now()): string | undefined {
  if (!needsBuyer(step.state)) return undefined;
  const keys = keysOf(step);
  for (const [token, l] of links) {
    if (l.requestId === step.requestId && l.keys === keys && l.state === step.state && !l.usedAt && l.expiresAt > now && l.session.agentId === session.agentId) return `${origin}/answer/${token}`;
  }
  const token = randomBytes(18).toString("base64url");
  links.set(token, { session, requestId: step.requestId, state: step.state, keys, expiresAt: now + ANSWER_LINK_MINUTES * 60_000 });
  if (links.size > MAX_LINKS) for (const [t, l] of links) if (l.usedAt || l.expiresAt <= now || links.size > MAX_LINKS) links.delete(t);
  return `${origin}/answer/${token}`;
}

/** The link's request and agent session, if it can still answer. `step` (once read) must still be the step it was made for. */
export function openAnswerLink(token: string, now = Date.now()): { session: AgentSession; requestId: string; check: (step: IntakeView) => void } {
  const l = /^[A-Za-z0-9_-]{16,64}$/.test(token) ? links.get(token) : undefined;
  if (!l) throw new DockError(404, "answer_link_not_found", "This answer link is not known. Ask the agent for the current one.");
  if (l.usedAt) throw new DockError(410, "answer_link_used", "This answer link was already used: an answer was given through it.");
  if (l.expiresAt <= now) throw new DockError(410, "answer_link_expired", `This answer link expired (links last ${ANSWER_LINK_MINUTES} minutes). Ask the agent for a new one.`);
  return {
    session: l.session,
    requestId: l.requestId,
    check: (step) => {
      if (step.state !== l.state || keysOf(step) !== l.keys) throw new DockError(409, "answer_link_stale", "The request has moved on since this link was made; there is nothing to answer here now.", "intake_sequence", { state: step.state });
    },
  };
}

/** Spend the link: called once an answer through it was accepted. */
export function useAnswerLink(token: string, now = Date.now()): void {
  const l = links.get(token);
  if (l) l.usedAt = now;
}

/** For tests. */
export function resetAnswerLinks(): void {
  links.clear();
}
