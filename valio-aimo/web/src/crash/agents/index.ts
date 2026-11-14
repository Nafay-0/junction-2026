import { alwaysDecline, askEverything, claimSuccess, doNothing, firstProduct, honestNothing, overOrder, reckless, stopEarly } from "./baselines";
import { modelAgent } from "./model";
import { reference } from "./reference";
import type { CrashAgent } from "./types";

export const SCRIPTED: CrashAgent[] = [reference, doNothing, stopEarly, reckless, claimSuccess, honestNothing, alwaysDecline, firstProduct, overOrder, askEverything];

/** The agents `pnpm crash:reproduce` runs: the reference, the three baselines and every exploit we tried. */
export const REPRODUCE = SCRIPTED.map((a) => a.name);

/** `reference`, `do-nothing`, ... or `model:<provider:model-id>` for a model through the runner. */
export function agentByName(name: string): CrashAgent {
  if (name.startsWith("model:")) return modelAgent(name.slice("model:".length));
  const a = SCRIPTED.find((x) => x.name === name);
  if (!a) throw new Error(`No agent "${name}". Agents: ${SCRIPTED.map((x) => x.name).join(", ")}, or model:<provider:model-id>`);
  return a;
}
