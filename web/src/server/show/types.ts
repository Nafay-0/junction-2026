/**
 * The show's shapes: what the big screen, the presenter and the table wall draw. Plain data, safe to import from
 * client components. Everything in a WeekRun was produced by a real call through the gate; nothing here is
 * invented for the screen. A condition the show set on purpose (a stock-out) is listed in `simulated`.
 */

export type StepKind = "standing" | "slip" | "stockout" | "lastminute" | "drift" | "refusal";

/**
 * ahead: not started. running: calls in flight. waiting: at the gate, waiting for the named person.
 * done: finished (whatever the gate decided). failed: a service did not answer; the week went on. skipped: not
 * possible today (the reason is in `note`).
 */
export type StepStatus = "ahead" | "running" | "waiting" | "done" | "failed" | "skipped";

/** One rule of the gate as the screen shows it. */
export type CheckView = { rule: string; outcome: "pass" | "escalate" | "fail" };

export type GateView = {
  outcome: "auto_approve" | "needs_human_approval" | "reject";
  /** The rule that decided: the first that failed, or the first that sent it to a person. */
  rule?: string;
  /** Plain reasons, as the gate wrote them. */
  reasons: string[];
  checks: CheckView[];
  totalCents: number;
  limitCents: number;
};

export type SignOffView = {
  approverName: string;
  roleLabel: string;
  /** waiting, then approved (committed), declined, rejected (approved, but the re-check refused), or timed_out. */
  state: "waiting" | "approved" | "declined" | "rejected" | "timed_out" | "withdrawn" | "expired";
  askedAt: string;
  /** When the show stops waiting and the agent withdraws the order. */
  deadline: string;
  decidedAt?: string;
  /** How it was signed, from the ledger: passkey (verified) or a demo tap. */
  method?: string;
  verified?: boolean;
  /** When the director heard of the decision: decidedAt to seenAt is the phone-to-screen delay. */
  seenAt?: string;
  /** Does the kitchen have a passkey on a phone? Without one nobody can sign, and the step will time out. */
  phone: boolean;
};

export type OptionView = {
  rank: "best" | "better" | "good";
  match: "full" | "compromise";
  labels: string[];
  title: string;
  totalCents: number;
  delivery: string;
  lines: { name: string; packs: number; amount: string }[];
  chosen: boolean;
  pros: string[];
  cons: string[];
};

export type ExcludedView = { name: string; reason: string; code?: string; simulated: boolean };

export type ConcernView = {
  code: string;
  /** The mistake check's own words. */
  message: string;
  /** The answer given, and who gave it. Scripted answers say so. */
  answer: string;
  answeredBy: string;
  scripted: boolean;
};

export type OrderView = {
  orderId: string;
  status: string;
  totalCents: number;
  lines: { name: string; packs: number; amount: string; delivery: string }[];
};

export type WeekStep = {
  kind: StepKind;
  /** The story's day ("Monday"); the real delivery date is `delivery`. */
  day: string;
  title: string;
  status: StepStatus;
  /** What the kitchen asked for, in its own words. */
  asked: string;
  /** What the agent did, in order, one short line each. */
  did: string[];
  /** What the kitchen's memory answered instead of asking. */
  memory: string[];
  concern?: ConcernView;
  options: OptionView[];
  excluded: ExcludedView[];
  gate?: GateView;
  signOff?: SignOffView;
  order?: OrderView;
  /** Conditions the show set for this step (labelled on screen and in the ledger). */
  simulated: string[];
  /** Plain-language note: why a step was skipped or failed, or what to notice. */
  note?: string;
  /** Delivery date asked for (YYYY-MM-DD). */
  delivery?: string;
  decisions: number;
  askedPerson: number;
  refused: number;
  requestIds: string[];
  orderIds: string[];
  liveCalls: number;
  startedAt?: string;
  endedAt?: string;
};

export type KitchenRef = {
  sandboxId: string;
  orgId: string;
  agentId: string;
  name: string;
  city: string;
  approverName: string;
  roleLabel: string;
  passkey: boolean;
  perOrderLimitCents: number;
  expiresAt: string;
  /** house: made by the show because no phone joined; nobody can sign its orders. */
  house: boolean;
};

export type Tally = { decisions: number; askedPerson: number; refused: number; wrongOrders: number; committed: number; spentCents: number };

export type WeekState = "preparing" | "running" | "waiting_signoff" | "finished" | "cancelled" | "failed";

export type WeekRun = {
  runId: string;
  version: number;
  kitchen: KitchenRef;
  state: WeekState;
  startedAt: string;
  endedAt?: string;
  current: number;
  steps: WeekStep[];
  tally: Tally;
  /** Every condition the show set during the week, for the footer. */
  simulated: string[];
  /** Partner live calls the week made (from the ledger of its own requests). */
  liveCalls: number;
  /** Clean-up done after the week: orders withdrawn, memory restored, simulations cleared. */
  cleanup?: string[];
  error?: string;
  /** Where this run came from: live, or a recording of an earlier live run. */
  source: "live" | "recording";
  recordedAt?: string;
};

/** A recording: a real run's snapshots over time, replayed through the same screen. */
export type Frame<T> = { t: number; data: T };
export type Recording<T> = { kind: string; title: string; capturedAt: string; source: string; durationMs: number; frames: Frame<T>[] };

// ---------- act 2: attacks ----------

export type AttackId = "tenfold" | "forged_mandate" | "replay" | "self_approve" | "split" | "relayed_yes" | "suspend" | "resume";

export type AttackResult = {
  id: AttackId;
  title: string;
  /** What the attacker tried, in one plain line. */
  tried: string;
  /** Did the gate stop it (refused, or sent it to a person instead of letting the agent decide)? */
  held: boolean;
  /** refused: nothing happened. person: it went to the named person. stopped: the intake stopped before any price. */
  how: "refused" | "person" | "stopped" | "allowed" | "error";
  rule?: string;
  code?: string;
  status?: number;
  message: string;
  /** The extra calls made to set it up or tidy after it (an order withdrawn, a suspension lifted). */
  notes: string[];
  at: string;
  source: "live" | "recording";
};

// ---------- act 3: an outside agent ----------

export type OutsideEvent = { at: string; kind: "model" | "tool" | "human" | "info" | "error"; text: string };

export type OutsideRun = {
  runId: string;
  version: number;
  /** aiven: the Aiven-hosted agent; builtin: Dock's reference buyer on the chosen model. */
  runner: "aiven" | "builtin";
  model: string;
  door: string;
  kitchenName: string;
  task: string;
  state: "running" | "done" | "failed";
  events: OutsideEvent[];
  outcome?: string;
  orderId?: string;
  totalCents?: number;
  gate?: GateView;
  costUsd?: number;
  startedAt: string;
  endedAt?: string;
  source: "live" | "recording";
  recordedAt?: string;
};

// ---------- presenter ----------

export type CheckState = "ok" | "warn" | "fail";
export type PreflightCheck = { id: string; label: string; state: CheckState; detail: string; fix?: string };

export type Spend = {
  day: string;
  weeks: { used: number; cap: number };
  outsideRuns: { used: number; cap: number };
  modelUsd: { used: number; cap: number };
  partnerCalls: { byShow: number; byDock: number; dailyCeiling: number };
  /** Average partner calls per finished week today. */
  callsPerWeek: number | null;
};
