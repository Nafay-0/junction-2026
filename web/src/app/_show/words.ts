import { ruleTitle } from "../_ui/plain";
import type { WeekStep } from "@/server/show/types";

/** Rule titles for the show, including the intake's own checks the gate's list does not name. */
const EXTRA: Record<string, string> = {
  human_input: "A person answers first",
  intake_sequence: "Steps in order",
  quote_availability: "Only what can be delivered",
  live_lookup_limit: "Live price checks for a short list only",
  show_limit: "The show's own daily cap",
};

export function titleOf(rule: string | undefined): string {
  return (rule && EXTRA[rule]) || ruleTitle(rule);
}

/** One line for a finished day, for the doors and the summary. */
export function outcomeLine(s: WeekStep, money: (c: number) => string): string {
  if (s.status === "skipped") return "Not today";
  if (s.status === "failed") return "Service did not answer";
  const so = s.signOff;
  if (so?.state === "approved" && s.order?.status === "committed") return `Signed by ${so.approverName.split(" ")[0]}`;
  if (so?.state === "declined") return `Declined by ${so.approverName.split(" ")[0]}`;
  if (so?.state === "timed_out" || so?.state === "withdrawn") return "Nobody signed: withdrawn";
  if (s.gate?.outcome === "reject" || s.order?.status === "rejected") return `Refused: ${titleOf(s.gate?.rule).toLowerCase()}`;
  if (s.concern && s.order?.status === "committed") return s.kind === "drift" ? "Queried, then renewed" : "Caught, then corrected";
  if (s.order?.status === "committed") return `Placed alone, ${money(s.order.totalCents)}`;
  if (s.concern) return "Asked a person";
  return s.status === "done" ? "Done" : "";
}

export const SHORT_DAY: Record<string, string> = { Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri", Saturday: "Sat" };
