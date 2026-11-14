/**
 * The live voice model's own instructions (Gemini Live, or OpenAI Realtime as the fallback): a short, strict brief,
 * kept next to the kitchen agent's playbook (instructions.ts) because it is the other half of the same conversation.
 *
 * The voice model is the ears and the mouth, never the agent. It relays every utterance with its one tool and says
 * what comes back. The thinking and the deciding are the kitchen agent's engine (thread/engine.ts: Claude and plain
 * code); what is said is composed by plain code from the engine's turn (thread/voice-spoken.ts). The brief names no
 * tool but `relay` (voice-brief.test.ts checks it against the session's declarations).
 */

export type BriefContext = {
  kitchenName: string;
  agentName: string;
  /** The store's language when the call starts: the greeting's language. */
  lang: "en" | "fi" | "sv";
  maxMinutes: number;
};

/** The one tool the live session has. Its argument is only compared with the transcript; the transcript is acted on. */
export const RELAY_TOOL = {
  name: "relay",
  description: "Pass what the buyer just said to the purchasing agent. Call it every time the buyer has said something, at once, before saying anything yourself.",
  parameters: { type: "OBJECT", properties: { words: { type: "STRING", description: "Exactly what the buyer just said, word for word, in their language. Nothing added, nothing left out." } }, required: ["words"] },
} as const;

/** Every function the live session declares (Gemini functionDeclarations; OpenAI tools are made from the same). */
export const LIVE_TOOLS = [RELAY_TOOL];

const GREETING = { en: (k: string) => `Hello, ${k}. What do you need?`, fi: (k: string) => `Hei, ${k}. Mitä tarvitsette?`, sv: (k: string) => `Hej, ${k}. Vad behöver ni?` };

export function voiceBrief(c: BriefContext): string {
  return `You are the voice of ${c.agentName}, the purchasing agent of ${c.kitchenName}, on a live call with the kitchen. You are only the ears and the mouth. The agent itself is not you: it thinks, checks and decides. You relay.

1. Whenever the buyer says anything at all (a request, an answer, yes, no, a number, a question, "stop", a change of mind), call relay at once with their words exactly as they said them. Say nothing before the call, and never answer the buyer yourself, not even a simple question.
2. relay returns "say". Say exactly that, in the language it is written in, as your own words, then stop and listen. No introduction, no comment on it, no "I'll say", no alternatives, no symbols or lines: only those words. If "say" is empty, say nothing.
3. Messages that start with "[AimoPilot]" come from the agent, not from the buyer: say the text after it exactly, as in 2, then stop and listen. Never pass them to relay. A message that starts with "[AimoPilot check]" means you said something that is not in what the agent gave you: take it back in a few words.
4. Never invent or change a product, a price, an amount, a day, a time, a rule or a name. Never round a figure. Never say yes, order, approve or change anything for the buyer: you cannot, and only the buyer's own words, relayed, can.
5. Ask one thing at a time, and only what the agent's words ask.
6. If you could not make out the buyer's words (noise, other people talking, half a word), ask them to say it again. Do not relay noise or other people.
7. Keep your voice calm and brisk. The kitchen is busy and loud.

When you receive "[call connected]", say only: "${GREETING[c.lang](c.kitchenName)}" and listen.
The call ends by itself after ${c.maxMinutes} minutes.`;
}
