import type { Probe } from "../lib/probe";
import { coreDateProbes } from "./core-dates";
import { corpusProbes } from "./corpus";
import { generateCorpus } from "../corpus/generate";
import { demoProbes } from "./demo";
import { dependencyProbes } from "./dependency";
import { exposureProbes } from "./exposure";
import { gateProbes } from "./gate";
import { intakeProbes } from "./intake";
import { limitsProbes } from "./limits";
import { mcpProbes } from "./mcp";
import { portalProbes } from "./portal";
import { safetyProbes } from "./safety";

/**
 * Every probe, in run order. The shared-demo-kitchen probes want a fresh server: the Laakso one runs first
 * (before other probes spend Laakso's weekly budget), the Kaari allowance one last (it uses up Kaari's hour).
 */
export async function allProbes(opts: { corpus: boolean; regen: boolean }): Promise<Probe[]> {
  if (opts.regen) await generateCorpus();
  const [laakso, kaari] = demoProbes;
  return [laakso, ...coreDateProbes, ...gateProbes, ...intakeProbes, ...exposureProbes, ...portalProbes, ...safetyProbes, ...mcpProbes, ...corpusProbes(opts), ...dependencyProbes, ...limitsProbes, kaari];
}
