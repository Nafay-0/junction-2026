/**
 * The three-minute story, beat by beat, for the presenter's strip. The lines are the pitch's own
 * (docs/pitch/pitch-3min.md), shortened where a beat now shows instead of tells.
 */
export type Stage = "title" | "sentence" | "week" | "attacks" | "outside" | "board" | "close";
export type Dep = "partner" | "phone" | "model" | "database";

export type Beat = {
  id: string;
  act: string;
  title: string;
  stage: Stage;
  /** Seconds this beat has in the three minutes. */
  seconds: number;
  speaker: "A" | "B";
  say: string;
  /** What happens on screen, and which key does it. */
  happens: string;
  deps: Dep[];
  /** The recording that stands in when a dependency fails. */
  fallback?: "week" | "attacks" | "outside";
};

export const BEATS: Beat[] = [
  {
    id: "open",
    act: "Opening",
    title: "The problem, as a person feels it",
    stage: "title",
    seconds: 25,
    speaker: "A",
    say: "It's eleven at night. Service is over. A head chef counts what's left in the cold room, and she has to get tomorrow's order in before the cut-off. Soon she will just tell an AI agent: order the milk. On the other side, the wholesaler gets an order from a machine. Did a person really mean a thousand litres? Who said this agent may spend that much?",
    happens: "Title. The approver phone should already show its kitchen (K to check).",
    deps: [],
  },
  {
    id: "ask",
    act: "Opening",
    title: "The ask and the insight",
    stage: "sentence",
    seconds: 20,
    speaker: "A",
    say: "Valio Aimo asked for exactly this: let outside purchasing agents order, in a way both sides can trust. Our answer is one rule: never trust the model. The agent can ask for anything. It can only buy what the kitchen signed for.",
    happens: "The sentence, large.",
    deps: [],
  },
  {
    id: "week",
    act: "Act 1: a week in a kitchen",
    title: "The week, through the real gate",
    stage: "week",
    seconds: 60,
    speaker: "B",
    say: "This phone is the approver of a hotel kitchen. Its agent may spend five hundred euros alone. Here is its week: the standing order alone; a slip of a zero, caught from its own history; the usual milk sold out, three alternatives that keep its rule; then a last-minute booking over its limit. The gate is plain code, not the AI. Now it's on her phone. She approves with her face.",
    happens: "Enter starts the week (about a minute). Thursday stops at the gate and lands on the phone; hold it up.",
    deps: ["partner", "phone", "database"],
    fallback: "week",
  },
  {
    id: "break",
    act: "Act 2: now try to break it",
    title: "Attacks, each refused by a named rule",
    stage: "attacks",
    seconds: 30,
    speaker: "A",
    say: "Why should you believe it holds? We attacked it ourselves. A forged mandate. A fixed price used twice. The agent approving its own order. One need split to dodge the limit. Each one stops, and the rule has a name. And the wholesaler can suspend an agent: its very next call is refused.",
    happens: "Keys 1 to 6 run one attack each; S suspends the agent from the operations side, R lifts it.",
    deps: ["partner", "database"],
    fallback: "attacks",
  },
  {
    id: "outside",
    act: "Act 3: any agent can order",
    title: "An outside agent at the same door",
    stage: "outside",
    seconds: 20,
    speaker: "A",
    say: "It is not our agent that makes this safe. Buyers built on seven popular agent frameworks ordered through the same door, using only their standard MCP or OpenAPI support. Here is one arriving now, on another model, at the same gate.",
    happens: "A sends in the outside agent (Aiven-hosted if configured, else the reference buyer on the chosen model).",
    deps: ["model", "partner"],
    fallback: "outside",
  },
  {
    id: "board",
    act: "Act 3: any agent can order",
    title: "The crash test for AI buyers",
    stage: "board",
    seconds: 10,
    speaker: "A",
    say: "And we built a crash test for AI buyers: thirteen hard purchasing situations. The models we tested scored between 25 and 66 out of 100.",
    happens: "The leaderboard from the crash test's own results.",
    deps: [],
  },
  {
    id: "close",
    act: "Close",
    title: "Path and close",
    stage: "close",
    seconds: 15,
    speaker: "A",
    say: "It runs today on Aiven, on open standards: MCP, OpenAPI, signed tokens, passkeys. What we need next is a test account on Valio Aimo's real webshop, and one kitchen willing to try it. The agent can ask for anything. It can only buy what the kitchen signed for. Thank you.",
    happens: "The sentence and the address.",
    deps: [],
  },
];

export const TOTAL_SECONDS = 180;
