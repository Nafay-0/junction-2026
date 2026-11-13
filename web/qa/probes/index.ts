import type { Probe } from "../lib/probe";
import { coreDateProbes } from "./core-dates";
import { demoProbes } from "./demo";
import { exposureProbes } from "./exposure";
import { gateProbes } from "./gate";
import { intakeProbes } from "./intake";

/**
 * Every probe, in run order. The shared-demo-kitchen probes want a fresh server: the Laakso one runs first
 * (before other probes spend Laakso's weekly budget), the Kaari allowance one last (it uses up Kaari's hour).
 */
export async function allProbes(opts: { corpus: boolean; regen: boolean }): Promise<Probe[]> {
  void opts;
  const [laakso, kaari] = demoProbes;
  return [laakso, ...coreDateProbes, ...gateProbes, ...intakeProbes, ...exposureProbes, kaari];
}
