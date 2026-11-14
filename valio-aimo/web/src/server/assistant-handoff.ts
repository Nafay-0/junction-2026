/**
 * The store's assistant panel hands a request it recognises ("order 10 cases of this for Monday") to the order
 * cards, which open the intake through the console's back end like a typed request. To record that door correctly
 * without the browser saying so, the assistant notes the words it handed over for this console session, and the
 * console's back end marks an intake opened with those words, within a few minutes, as the assistant's.
 */
const HANDOFF_MS = 5 * 60_000;
const g = globalThis as typeof globalThis & { __dockAssistantHandoff?: Map<string, { text: string; at: number }> };
const handoffs = (g.__dockAssistantHandoff ??= new Map());

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function noteAssistantHandoff(kitchen: string, session: string | undefined, text: string, now = Date.now()): void {
  if (!session) return;
  handoffs.set(`${kitchen}|${session}`, { text: norm(text), at: now });
  if (handoffs.size > 2000) handoffs.delete(handoffs.keys().next().value!);
}

/** "assistant" when this console session's assistant just handed these words over; else "typed". */
export function storeDoorFor(kitchen: string, session: string, needText: unknown, now = Date.now()): "typed" | "assistant" {
  const h = handoffs.get(`${kitchen}|${session}`);
  if (!h || now - h.at > HANDOFF_MS || typeof needText !== "string") return "typed";
  const t = norm(needText);
  if (t !== h.text && !t.endsWith(h.text) && !h.text.endsWith(t)) return "typed";
  handoffs.delete(`${kitchen}|${session}`);
  return "assistant";
}
