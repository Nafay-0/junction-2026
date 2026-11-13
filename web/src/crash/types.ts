import type { Product } from "@/core/catalog";
import type { KitchenProfile } from "@/core/kitchen";
import type { Mandate } from "@/core/mandate";
import type { BaseUnit } from "@/core/need";

/**
 * The crash test's vocabulary. A scenario is a self-contained world built from a seed: a synthetic catalogue,
 * a kitchen with history, a mandate, a clock, scripted events, a task in the buyer's words, a scripted human,
 * and what success means. Nothing here reads the partner's data.
 */

// ---------- the world ----------

/** How a product can be bought right now: the live service's view of it. */
export type OfferSpec = {
  unitPriceCents: number; // per pack, ex VAT
  availablePacks: number;
  /** Working days from today to the nominal earliest delivery. */
  leadDays: number;
  /** Order by `time` (Helsinki), `daysBefore` days before the delivery day, to get that day. */
  cutoff: { daysBefore: number; time: string };
  logistic: "Stock" | "Terminal";
};

/** A product in the world. `key` is its role in the scenario ("cheap_but_late"); the id is seeded and means nothing. */
export type WorldProduct = { key: string; product: Product; offer?: OfferSpec };

export type ScenarioEvent = {
  id: string;
  /** Fires once: after the nth completed call of a tool, or when the clock passes start + minutes. */
  when: { afterTool: string; count: number } | { atMinute: number };
  action:
    | { kind: "price"; productKey: string; unitPriceCents: number }
    | { kind: "stock"; productKey: string; availablePacks: number }
    | { kind: "message"; from: string; text: string };
};

/** A failure the environment injects around a Dock tool. */
export type Fault = { tool: string; nth: number; kind: "timeout_after_commit" };

export type World = {
  /** ISO instant the episode starts at (scenarios are set in November: Helsinki is UTC+2). */
  start: string;
  deliveryWeekdays: number[];
  products: WorldProduct[];
  mandate: Mandate;
  kitchen: KitchenProfile;
  events: ScenarioEvent[];
  faults: Fault[];
};

// ---------- the task ----------

/**
 * The same words, restated as data for the scripted agents (which cannot read language). It carries nothing the
 * words do not say: dates are resolved from the briefing's "today", nothing about the catalogue or the traps.
 */
export type StructuredTask = {
  kind: "buy" | "repeat_last" | "renew_standing";
  category: string;
  /** Attributes the words ask for, e.g. lactose_free, fat_1_5. */
  attributes: string[];
  quantity?: { amount: number; unit: BaseUnit };
  neededBy: string;
  /** "Check the total with me before you place it." */
  confirmTotalBeforeOrder?: boolean;
};

export type Task = { text: string; structured: StructuredTask };

// ---------- the human ----------

/** What a question to the buyer is about. The scripted human answers by topic, truthfully, and only about the kitchen. */
export const TOPICS = ["quantity", "delivery", "product", "budget", "go_ahead", "other"] as const;
export type Topic = (typeof TOPICS)[number];

export type HumanAnswer = { text: string; facts?: Record<string, unknown>; delayMinutes?: number };

export type HumanState = {
  /** Latest quote the agent obtained, if any. */
  lastQuote?: { totalCents: number; quoteId: string };
  asked: { topic: Topic; question: string }[];
};

export type HumanScript = {
  answer(topic: Topic, question: string, state: HumanState): HumanAnswer;
  /** Topics a careful buyer might reasonably raise here: asking costs nothing. */
  allowedTopics: Topic[];
  /** Consultations the job requires; each is checked against the record, not the agent's account. */
  required: { id: string; text: string; satisfied(record: RunRecord): boolean }[];
  /** Whether the truthful approver signs this order off (they decline what does not meet the kitchen's need). */
  approves(order: PlacedOrder, ctx: OutcomeContext): { approve: boolean; note: string };
};

// ---------- what success means ----------

/** How well a product meets the need: 1 = what was asked; between = acceptable but not asked; 0 = not acceptable. */
export type Acceptance = { weight: number; why?: string; unsafe?: SafetyFactId };

export type Need = {
  unit: BaseUnit;
  quantity: number;
  /** Deliveries after this date do not count. */
  deadline: string;
  accept(p: Product): Acceptance;
};

export type ScenarioMeta = {
  id: string;
  version: number;
  title: string;
  /** The one decision this scenario isolates. */
  decision: string;
  /** What a competent human buyer would do. */
  competentBuyer: string;
  /** Why it is hard for the right reason. */
  whyHard: string;
};

export type Scenario = ScenarioMeta & {
  build(seed: number): Built;
};

export type Built = {
  world: World;
  task: Task;
  briefing: string;
  need: Need;
  human: HumanScript;
  /** Sign-off requests a good run may cause, and whether at least one is required. */
  signOffs: { allowed: number; required: boolean };
  /** Live price/availability calls (quotes included) a careful agent needs. */
  liveCallBudget: number;
  /** Scenario-specific facts about unsafe behaviour that the gate cannot see. */
  extraSafety?(record: RunRecord, ctx: OutcomeContext): SafetyFinding[];
  /** Ids of the world's products, by role. */
  ids: Record<string, string>;
};

// ---------- what happened (facts, recorded by the environment) ----------

export type StepKind = "tool_call" | "event" | "human" | "gate" | "fault";

export type Step = {
  i: number;
  at: string;
  kind: StepKind;
  tool?: string;
  args?: unknown;
  result?: unknown;
  ok?: boolean;
  detail?: Record<string, unknown>;
};

export type PlacedOrder = {
  orderId: string;
  status: "pending_approval" | "committed" | "rejected" | "declined";
  totalCents: number;
  authorisedBy: "mandate" | "approver" | null;
  signOffRequested: boolean;
  lines: { productId: string; quantity: number; packSize: number; unit: string; unitPriceCents: number; lineTotalCents: number; deliveryDate: string; substituteFor?: string }[];
  rejectedBy: string[]; // gate rules that failed
  escalatedBy: string[]; // gate rules that sent it to a person
  placedAt: string;
};

export type HumanExchange =
  | { kind: "question"; at: string; topic: Topic; question: string; answer: string; facts?: Record<string, unknown>; afterQuoteTotalCents?: number; beforeAnyOrder: boolean }
  | { kind: "sign_off"; at: string; orderId: string; decision: "approve" | "decline"; note: string; totalCents: number }
  /** Dock's own intake asked the buyer (a mistake check or a typed question); relayed by the model runner. */
  | { kind: "intake"; at: string; prompt: "confirmation" | "questions"; asked: string[]; answer: unknown };

export const REPORT_STATUSES = ["ordered", "partially_ordered", "awaiting_sign_off", "not_ordered"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export type FinalReport = {
  status: ReportStatus;
  orderIds: string[];
  totalCents?: number;
  shortfall?: { quantity: number; unit: BaseUnit };
  earliestPossibleDelivery?: string;
  message: string;
};

export type RunRecord = {
  steps: Step[];
  orders: PlacedOrder[];
  human: HumanExchange[];
  report: FinalReport | null;
  /** finish: the agent called finish; final_text: read from a model's last message (see report-text.ts). */
  reportSource: "finish" | "final_text" | null;
  /** Calls the model runner blocked because the model tried to answer for the buyer. */
  answeredForHuman: number;
  /** Quote tokens refused by the signature check whose payload was an issued quote with changed content. */
  tamperedQuotes: number;
  liveCalls: number;
  productsPriced: number;
  refusals: { tool: string; code: string; rule?: string; at: string }[];
  requests: { requestId: string; neededBy?: string }[];
  eventsFired: string[];
  toolCalls: number;
  endedBy: "finish" | "agent_returned" | "call_limit" | "error";
  error?: string;
};

// ---------- scoring ----------

export type SafetyFactId =
  | "unsafe_dietary"
  | "allergen_data_missing"
  | "split_to_dodge_limit"
  | "duplicate_order"
  | "followed_embedded_instruction"
  | "ignored_buyer_limit"
  | "late_delivery"
  | "answered_for_human"
  | "scanned_live_service"
  | "forged_quote";

/** One unsafe action. `committed`: it went through (an order now exists); otherwise the gate, the approver or the runner stopped it. */
export type SafetyFinding = { id: string; source: "gate" | "facts"; severity: number; detail: string; committed: boolean };

export type OutcomeContext = { need: Need; productById: Map<string, Product>; perOrderLimitCents: number; best: BestPlan };

export type BestPlan = {
  /** Most acceptable (weight 1) units that can arrive by the deadline, capped at the need. */
  achievableUnits: number;
  costCents: number;
  units: number;
  lines: { productId: string; packs: number }[];
  earliestAcceptableDelivery?: string;
};

export type Check = { id: string; pass: boolean; weight: number; detail: string };

export type ScoreBreakdown = {
  score: number; // 0..100
  outcome: number;
  report: number;
  conduct: number;
  human: number;
  economy: number;
  safetyFactor: number;
  checks: Check[];
  safety: SafetyFinding[];
  notes: string[];
};
