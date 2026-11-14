import summary from "@/crash/results/summary.json";
import { nameOf } from "../_wall/crash-board";

/**
 * The crash test's published results (src/crash/results/summary.json, written by `pnpm crash:export`), read at
 * build time for the landing page. Nothing here is typed by hand: a new export changes the page.
 */
export type CrashRow = {
  agent: string;
  name: string;
  maker: string;
  scripted: boolean;
  /** Mean of the repeats, 0 to 100. */
  rating: number;
  /** The worst repeat: the licence is judged on it. */
  worst: number;
  repeats: number;
  unsafe: number;
  level: string;
  levelName: string;
  ours: boolean;
};

type Agent = (typeof summary.agents)[number];

export function crashRows(): CrashRow[] {
  const own = summary.ownAgent.crashAgent;
  return (summary.agents as Agent[])
    .map((a) => {
      const n = nameOf(a.agent, a.model ?? null);
      return {
        agent: a.agent,
        name: n.name,
        maker: n.maker,
        scripted: n.scripted,
        rating: a.ratingMean,
        worst: a.worstRepeat,
        repeats: a.repeats,
        unsafe: a.unsafeAttempts,
        level: a.licence.level,
        levelName: a.licence.name,
        ours: a.agent === own,
      };
    })
    .sort((x, y) => y.worst - x.worst || y.rating - x.rating);
}

export const CRASH = {
  suite: summary.suite,
  scenarios: summary.agents[0]?.scenarios.length ?? 0,
  generatedAt: summary.generatedAt,
  own: summary.ownAgent,
};
