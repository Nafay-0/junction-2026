import { addFacts, addWords, emptyFacts } from "@/core/grounding";
import { recordGrounding } from "@/server/grounding";
import { groundText } from "@/core/grounding";

/**
 * The Aiven Managed Agent's transcript in the operations portal, through the grounding check (core/grounding.ts):
 * each of the agent's own messages may only state products, prices, amounts, dates, claims and allergen facts that
 * Dock's tool answers before it returned (or the task it was given). A sentence that states anything else is shown
 * as "The data does not say." The tool answers themselves are Dock's data and are shown as they are.
 */
type Msg = { at: string; type: "user" | "assistant" | "tool_call" | "tool_return"; text: string };

/** Each message counted once, however often the page polls the run. */
const counted = new Set<string>();

export function groundRunMessages<M extends Msg>(messages: M[], full?: string[]): M[] {
  const facts = emptyFacts();
  return messages.map((m, i) => {
    const raw = full?.[i] ?? m.text;
    if (m.type === "tool_return") {
      try {
        addFacts(facts, JSON.parse(raw));
      } catch {
        addFacts(facts, raw);
      }
      return m;
    }
    if (m.type === "user") {
      addWords(facts, raw);
      return m;
    }
    if (m.type !== "assistant" || !m.text.trim()) return m;
    const g = groundText(m.text, facts);
    const key = `${m.at}:${m.text.length}:${m.text.slice(0, 40)}`;
    if (!counted.has(key)) {
      counted.add(key);
      if (counted.size > 2000) counted.clear();
      recordGrounding("aiven", g.violations, "Aiven agent run");
    }
    return g.replaced ? { ...m, text: g.text } : m;
  });
}
