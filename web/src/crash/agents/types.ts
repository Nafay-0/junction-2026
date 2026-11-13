import type { AgentEnv } from "../env";
import type { FinalReport } from "../types";

/** What an agent under test may report about itself besides its actions (a model's transcript, tokens, cost). */
export type AgentRunInfo = {
  model?: string;
  /** The runner's full transcript, kept verbatim in the trajectory. */
  transcript?: unknown;
  costUsd?: number | null;
  tokens?: { input: number; output: number; total: number };
  /** Calls the harness blocked because they answered for the human (they never reached Dock). */
  answeredForHuman?: number;
  /** The agent's last words when it did not call finish. */
  finalText?: string;
  outcome?: string;
};

/**
 * What the harness offers an agent adapter beyond the tools: the episode's start time (the model runner tells the
 * model today's date) and ways to record what only the adapter sees. Scripted agents ignore it.
 */
export type Harness = {
  start: string;
  recordIntake(prompt: "confirmation" | "questions", asked: string[], answer: unknown): void;
  noteAnsweredForHuman(n: number): void;
  reportFromText(report: FinalReport): void;
  orderIds(): Promise<string[]>;
};

/** One small interface for every agent under test: scripted, baseline or model. */
export type CrashAgent = {
  name: string;
  kind: "scripted" | "baseline" | "exploit" | "model";
  description: string;
  run(env: AgentEnv, harness: Harness): Promise<AgentRunInfo | void>;
};
