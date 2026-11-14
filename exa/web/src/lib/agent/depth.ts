/**
 * How far research goes, decided by the mode and the effort dial together. A quick mode at low
 * effort answers from a handful of pages; the most capable mode at full effort sends out a large
 * team in two rounds and checks hundreds of pages. Everything that scales with depth is decided
 * here and read from the request's `ToolContext`, so no tool invents its own numbers.
 *
 * Measured on 14 November 2026 on one question ("lease or buy an electric car in Finland"), in
 * Smart mode. Time is the research and the report; the main agent's own steps come on top.
 *
 *   Level       Team        Searches  Pages checked  Sources kept  Report        Time    Cost
 *   Standard    3           9         (not counted)  24            ~400 words    25 s    $0.12
 *   Deep        6           36        234            101           ~800 words    1 min   $0.42
 *   Deeper      6 + 3       92        681            239           ~1,300 words  2 min   $1.05
 *   Exhaustive  12 + 4      137       988            480           ~1,750 words  2.5 min $1.50
 *
 * Cost is Exa (about a tenth of a cent per page checked), the sub-agents, the decision model and
 * the report; roughly two thirds of it is Exa. The time budgets below are ceilings, not targets:
 * they leave room, inside the route's 300 seconds, for the main agent's own steps and the report.
 *
 * Shared by the server and the browser (the interface only uses the label): no imports but types.
 */

import type { Effort, ModeId } from "./modes";

export type ResearchDepth = {
  /** 0 is what a quick answer gets, 3 is everything. */
  level: 0 | 1 | 2 | 3;
  label: "Standard" | "Deep" | "Deeper" | "Exhaustive";

  /* Deep research: the team. */
  /** How many sub-agents may work at once in the first round, one per angle, and the fewest worth sending. */
  maxAngles: number;
  minAngles: number;
  /** Sub-agents the lead may send in a second round, to close gaps and settle contradictions. 0: one round. */
  followUps: number;

  /* Deep research: what each sub-agent does. */
  /** Steps a sub-agent may take (a step is one round of searches or reads). The last one is always the write-up. */
  stepsPerAgent: number;
  /** Differently worded searches one call may carry. More wordings per step means fewer steps for the same reach. */
  queriesPerSearch: number;
  /** How many searches a sub-agent is told to run in all, in words for its instructions. */
  searchesPerAgent: string;
  /** How much reading it is told to do, in words for its instructions. */
  readsPerAgent: string;
  /** Results asked of Exa per search. Ten is the most a search returns at its base price. */
  resultsPerSearch: number;
  /** The most pages one search call hands back to the sub-agent, after the ones that do not bear on its angle are dropped. */
  passagesPerSearch: number;
  /** Whether the decision model checks every page a search returns against the angle before it is used. */
  triage: boolean;
  /** Sources each sub-agent may keep for the report's source list. */
  sourcesPerAgent: number;
  /** Words each sub-agent writes up, and the lead's report. */
  findingsWords: string;
  reportWords: string;

  /* Deep research: time. */
  /** Seconds the sub-agents have, both rounds together, before the report is written with what there is. */
  budgetSeconds: number;
  /** How long the whole thing takes, for the tool's description. */
  takes: string;

  /* The main agent's own searching and reading. */
  /** Results per web search by default, and the most it may ask for. */
  searchResults: number;
  maxSearchResults: number;
  /** Pages it may read in full in one call. */
  readPages: number;
};

const LEVELS: ResearchDepth[] = [
  {
    level: 0,
    label: "Standard",
    minAngles: 2,
    maxAngles: 4,
    followUps: 0,
    stepsPerAgent: 6,
    queriesPerSearch: 1,
    searchesPerAgent: "two to four",
    readsPerAgent: "read a page only when the quoted passages leave out something you need",
    resultsPerSearch: 5,
    passagesPerSearch: 5,
    triage: false,
    sourcesPerAgent: 8,
    findingsWords: "120 to 200",
    reportWords: "200 to 350",
    budgetSeconds: 80,
    takes: "30 to 60 seconds",
    searchResults: 6,
    maxSearchResults: 10,
    readPages: 4,
  },
  {
    level: 1,
    label: "Deep",
    minAngles: 3,
    maxAngles: 6,
    followUps: 0,
    stepsPerAgent: 7,
    queriesPerSearch: 2,
    searchesPerAgent: "four to six",
    readsPerAgent: "read in full the two or three pages your findings rest on",
    resultsPerSearch: 8,
    passagesPerSearch: 8,
    triage: true,
    sourcesPerAgent: 20,
    findingsWords: "200 to 300",
    reportWords: "450 to 700",
    budgetSeconds: 100,
    takes: "one to two minutes",
    searchResults: 8,
    maxSearchResults: 15,
    readPages: 6,
  },
  {
    level: 2,
    label: "Deeper",
    minAngles: 5,
    maxAngles: 8,
    followUps: 3,
    stepsPerAgent: 8,
    queriesPerSearch: 2,
    searchesPerAgent: "six to nine",
    readsPerAgent: "read in full the three or four pages your findings rest on, primary and official sources first",
    resultsPerSearch: 10,
    passagesPerSearch: 10,
    triage: true,
    sourcesPerAgent: 36,
    findingsWords: "300 to 450",
    reportWords: "700 to 1,000",
    budgetSeconds: 130,
    takes: "two to three minutes",
    searchResults: 10,
    maxSearchResults: 20,
    readPages: 8,
  },
  {
    level: 3,
    label: "Exhaustive",
    minAngles: 8,
    maxAngles: 12,
    followUps: 4,
    stepsPerAgent: 9,
    queriesPerSearch: 3,
    searchesPerAgent: "eight to ten",
    readsPerAgent: "read in full the four to six pages your findings rest on, primary and official sources first",
    resultsPerSearch: 10,
    passagesPerSearch: 12,
    triage: true,
    sourcesPerAgent: 50,
    findingsWords: "400 to 600",
    reportWords: "1,100 to 1,500",
    budgetSeconds: 150,
    takes: "about three minutes",
    searchResults: 10,
    maxSearchResults: 25,
    readPages: 10,
  },
];

/**
 * The depth for each mode (rows) at each step of the effort dial (columns: Quick, Balanced,
 * Thorough, Max). Both count. At "Quick" every mode but the most capable stays at the standard
 * depth, so the default is as fast as it has always been; the quickest mode never goes past
 * "Deep" however far the dial is turned; the two most capable modes at full effort are "Exhaustive".
 */
const TABLE: Record<ModeId, [number, number, number, number]> = {
  ultrafast: [0, 0, 1, 1],
  fast: [0, 1, 1, 2],
  smart: [0, 1, 2, 3],
  expert: [1, 2, 2, 3],
};

export function researchDepth(mode: ModeId, effort: Effort): ResearchDepth {
  return LEVELS[TABLE[mode]?.[effort - 1] ?? 0];
}

/** The depth of a level by number, for fixtures and tests. */
export const depthAt = (level: 0 | 1 | 2 | 3): ResearchDepth => LEVELS[level];
