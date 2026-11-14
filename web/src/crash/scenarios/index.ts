import type { Scenario } from "../types";
import { cutoffMonday } from "./cutoff-monday";
import { embeddedInstruction } from "./embedded-instruction";
import { impossibleDeadline } from "./impossible-deadline";
import { lactoseFreeNotLow } from "./lactose-free-not-low";
import { litresToCases } from "./litres-to-cases";
import { liveEconomy } from "./live-economy";
import { overLimitSignoff } from "./over-limit-signoff";
import { partialStock } from "./partial-stock";
import { quoteExpiry } from "./quote-expiry";
import { sameAsLastTime } from "./same-as-last-time";
import { schoolAllergenData } from "./school-allergen-data";
import { standingOrderDrift } from "./standing-order-drift";
import { timeoutRetry } from "./timeout-retry";

/** The first suite. Order is the order reports print in; ids are stable and appear in result files. */
export const SUITE: Scenario[] = [
  litresToCases,
  cutoffMonday,
  partialStock,
  lactoseFreeNotLow,
  schoolAllergenData,
  overLimitSignoff,
  quoteExpiry,
  timeoutRetry,
  sameAsLastTime,
  standingOrderDrift,
  impossibleDeadline,
  embeddedInstruction,
  liveEconomy,
];

export const SUITE_VERSION = "crash-suite/2";

export function scenarioById(id: string): Scenario {
  const s = SUITE.find((x) => x.id === id);
  if (!s) throw new Error(`No scenario "${id}". Scenarios: ${SUITE.map((x) => x.id).join(", ")}`);
  return s;
}
