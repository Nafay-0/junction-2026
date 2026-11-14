/**
 * The buyer's conversation with the kitchen's agent: one thread per kitchen, a list of turns, and an append-only
 * stream of events every door and screen reads. The contract is documented in docs/agent-thread.md; keep the two
 * in step.
 *
 * The rule the shapes enforce: an agent turn is at most one short line of text plus cards, and every inventory
 * fact (product, price, amount, date, stock) is in a card built from a tool result or a gate record. The line is
 * the model's and passes the grounding check (core/grounding.ts) or is not shown.
 *
 * Plain types only: the browser imports this file too.
 */

/** Which door a buyer turn came through. `typed` is the store's composer; `voice` the call page or a microphone. */
export type ThreadDoor = "typed" | "voice" | "photo";
/** How the buyer's turn reached the door. `tap`: a button on a card (no words to interpret). */
export type TurnVia = "typed" | "speech" | "tap" | "photo";

/**
 * What a tap (or a spoken word the engine mapped onto a card) does. Each one names the card it answers, so a
 * stale tap on an old card is refused instead of acting on the newest request.
 */
export type ThreadAction =
  /** The mistake check: "confirm" the amount as said, or one of the concern's correction ids. */
  | { type: "concern"; requestId: string; key: string; choice: string }
  /** One of the intake's typed questions. `remember`: keep the answer for next time (memory confirms it). */
  | { type: "answer"; requestId: string; questionId: string; optionId: string; remember?: boolean }
  /** Pick an option card and order it: the gate then places it alone or sends it to a named person. */
  | { type: "choose"; requestId: string; optionId: string }
  /** Order the quote already fixed for this request (after a choice made earlier, e.g. a price that was shown). */
  | { type: "place"; requestId: string }
  /** Take back an order that still waits for sign-off. */
  | { type: "withdraw"; orderId: string }
  /** The after-order memory proposal: keep it, or not. */
  | { type: "remember"; itemId: string; yes: boolean }
  /** Run the last failed step of an agent turn again. */
  | { type: "retry"; turnId: string }
  /** Order a menu plan as it stands: one fixed-price quote for every line, then the gate (the plan card's one confirmation). */
  | { type: "plan_order"; planId: string };

export type BuyerTurn = {
  turnId: string;
  role: "buyer";
  at: string;
  door: ThreadDoor;
  via: TurnVia;
  /** The buyer's own words, exactly as typed or transcribed. Absent for a pure tap. */
  text?: string;
  action?: ThreadAction;
  /** The label of the button tapped, as shown, so the thread reads naturally ("Make it 100 L"). */
  label?: string;
  /** Sent by the door so a resend after a dropped connection is not a second turn. */
  clientTurnId?: string;
};

export type StepStatus = "running" | "done" | "failed" | "skipped";

/** A live step while the agent works ("Reading your request", "Checking price and stock for 3 products"). */
export type ThreadStep = {
  stepId: string;
  /** Machine name: read, recall, intake, lookup, quote, gate, place, sign_off, memory, model, tool:<name>. */
  kind: string;
  label: string;
  status: StepStatus;
  startedAt: string;
  ms?: number;
  detail?: string;
};

export type AgentTurnStatus = "working" | "waiting_buyer" | "waiting_approver" | "done" | "failed";

export type AgentTurn = {
  turnId: string;
  role: "agent";
  at: string;
  /** The buyer turn this answers. */
  replyTo: string;
  status: AgentTurnStatus;
  steps: ThreadStep[];
  cards: Card[];
  /** One short sentence by the model, shown only after it passed the grounding check. */
  line?: string;
  /** Wall time from the buyer's turn to the end of this agent turn. */
  ms?: number;
  /** Milliseconds from the buyer's turn to each milestone, for the operations trace and the speed report. */
  marks?: Partial<Record<"first_step" | "understood" | "options" | "placed" | "waiting" | "line" | "done", number>>;
};

export type Turn = BuyerTurn | AgentTurn;

// ---------- cards ----------

export type Money = { cents: number };
export type CardBase = { cardId: string; requestId?: string };

export type UnderstoodCard = CardBase & {
  type: "understood";
  requestId?: string;
  /** The buyer's words this reading rests on. */
  words: string;
  item: string;
  amount?: { amount: number; unit: string };
  deliverBy?: string;
  deliverOn?: string;
  claims: string[];
  allergens: string[];
  optimise?: string;
  /** "Same as last Thursday": which earlier request it was built on, and what was taken from it. */
  basedOn?: { requestId: string; fields: string[]; label?: string };
  /** One line per remembered thing used instead of asking ("Lactose-free: your stated rule, 3 Nov"). */
  memoryUsed: string[];
  /**
   * The same lines as data, for words in the buyer's language (server/memory/recall.ts usageLines): `code` is
   * applied | preselected | checked, `params` names the remembered fact and where it came from.
   */
  memory?: MemoryLine[];
  /** Other items the same message named; each gets its own cards in the same agent turn. */
  alsoAsked: string[];
  /**
   * Things noticed that do not stop the order (the mistake check's quiet tier, core/concerns.ts): one line each, from
   * a code and parameters, e.g. { code: "amount_above_usual", params: { ratio: 2.5, usual: 400, unit: "L" } }.
   */
  notes?: { code: string; params: Record<string, string | number> }[];
};

/** A line of what memory used, as text and as data (server/memory/recall.ts usageLines). */
export type MemoryLine = { itemId?: string; text: string; code?: string; params?: Record<string, string | number> };

export type AnomalyCard = CardBase & {
  type: "anomaly";
  requestId: string;
  concerns: {
    key: string;
    code: string;
    message: string;
    confirmable: boolean;
    corrections: { id: string; label: string }[];
    /** The figures the message rests on (core/concerns.ts Concern.evidence), for the message in the buyer's language. */
    evidence?: Record<string, unknown>;
  }[];
  /** Set once answered: what the buyer chose, and whether it counted as the person's own (verified) or relayed. */
  answered?: { choice: string; by: string; verified: boolean };
};

export type QuestionCard = CardBase & {
  type: "question";
  requestId: string;
  questions: { id: string; text: string; options: { id: string; label: string }[] }[];
  answered?: Record<string, string>;
};

export type OptionView = {
  optionId: string;
  rank: string;
  title: string;
  match: "full" | "compromise";
  givesUp: string[];
  totalCents: number;
  deliveryDate: string;
  orderBy?: string;
  stockConfirmed: boolean;
  lines: { productId: string; name: string; quantity: number; packSize?: number; unit?: string; unitPriceCents?: number; substituteFor?: string }[];
  delivered: { amount: number; unit: string };
  co2Kg: number | null;
  reliability: number | null;
  signOff: string[];
  pros: string[];
  cons: string[];
  /** The pros, cons and sign-off reasons as codes and parameters (core/options.ts OptionReason): say them in the buyer's language, and a reason every option shares once. */
  reasons: { code: string; tone: "pro" | "con" | "quiet" | "signoff"; params: Record<string, string | number> }[];
  alternative?: { for: string; tier: string; reason: string };
  /** The catalogue's kind of product (the art by kind), for the option's illustration. */
  category?: string;
};

export type OptionsCard = CardBase & {
  type: "options";
  requestId: string;
  options: OptionView[];
  /** The card the agent would pick, and why (the buyer's goal, a stated rule, a habit). */
  preselected?: { optionId: string; reason: string };
  /** Why products were left out, grouped ("12 not lactose-free"). */
  /** Why products were left out, grouped; `code` (core/options.ts ExclusionCode) for words in the buyer's language. */
  excluded: { reason: string; count: number; code?: string }[];
  notes: string[];
  chosen?: string;
};

export type PriceCard = CardBase & {
  type: "price";
  requestId: string;
  quoteId: string;
  totalCents: number;
  expiresAt: string;
  deliveryDate: string;
  lines: OptionView["lines"];
  /** What the gate would decide on this quote, before it is placed. */
  preview: { outcome: string; reasons: string[] };
  /** The wholesaler's signature over the price: verifiable offline against /.well-known/jwks.json. */
  signed: true;
};

export type GateCard = CardBase & {
  type: "gate";
  requestId: string;
  orderId?: string;
  outcome: "placed_alone" | "waiting" | "refused" | "approved" | "declined" | "withdrawn" | "expired";
  /** The rule that decided (refused) or escalated (waiting). */
  rule?: string;
  reasons: string[];
  /** Every rule the gate checked, as codes and parameters (core/policy.ts RuleResult), for words in the buyer's language. */
  rules?: { rule: string; outcome: string; details?: Record<string, unknown> }[];
  approver?: { name: string; role: string };
  approvalId?: string;
  /** Plain words: what the buyer can do now ("Nothing: Aino signs on her phone"). */
  next?: string;
};

export type OrderCard = CardBase & {
  type: "order";
  orderId: string;
  requestId?: string;
  status: string;
  totalCents: number;
  deliveryDate: string;
  lines: OptionView["lines"];
  /** Placed by the agent alone, or signed by a named person. */
  authorised: { by: "agent" } | { by: "person"; name: string; role: string; verified: boolean } | { by: "waiting"; name: string; role: string };
  /** The compact JWS the wholesaler signed (committed orders only): verifiable offline. */
  confirmation?: string;
  /** What the agent passed over when it chose alone, so the buyer sees the trade-off without asking. */
  passedOver: { title: string; totalCents: number; why: string }[];
};

export type MemoryCard = CardBase & {
  type: "memory";
  /** What memory answered in this turn instead of asking. */
  used: string[];
  /** After an order: things the agent proposes to remember; the kitchen's person confirms each. */
  proposals: { itemId: string; question: string; decided?: "kept" | "dropped" }[];
};

/** An answer to a question about records ("what did we order last week?"), with the records it rests on. */
export type RecordsCard = CardBase & {
  type: "records";
  question: string;
  rows: { kind: "order" | "request" | "product" | "memory" | "mandate"; label: string; detail?: string; totalCents?: number; date?: string; ref?: string }[];
  /** "same as last Thursday": the buyer can repeat one row as a new request. */
  repeat?: { ref: string; label: string };
};

export type NoticeCard = CardBase & {
  type: "notice";
  kind: "not_found" | "not_purchase" | "incomplete" | "unavailable" | "refused" | "error" | "suspended";
  message: string;
  /** For `incomplete`: what is missing ("how much, with the unit"). */
  missing?: string[];
  /** For `refused`: the rule that fired. */
  rule?: string;
  retry?: boolean;
};

/** One point of a plan, by the planner's code: cannot_arrive, no_safe_product, no_product, not_priced, allergen_unknown, different_form, amount_check, rule_conflict. */
export type PlanPoint = { ingredient: string; kind: string; text: string };

/**
 * A dish or a menu for a number of covers, planned by the menu planner (server/agent/menu): the ingredients it worked
 * out, the product chosen for each with the amount in packs and the line's price, and what ordering it means. One
 * confirmation (`plan_order`) orders the whole plan as one fixed-price order through the gate.
 */
export type PlanCard = CardBase & {
  type: "plan";
  planId: string;
  requestId?: string;
  state: "planned" | "quoted" | "ordered" | "declined";
  covers: number | null;
  serviceDate?: string;
  dishes: string[];
  lines: {
    lineId: string;
    /** The ingredient as the plan names it ("salmon fillet"). */
    ingredient: string;
    /** For which dishes, when there are several. */
    dishes: string[];
    status: "ready" | "decide" | "left_out";
    /** The product chosen, its full name. */
    product?: string;
    /** Packs as the wholesaler sells them ("12 × 1 kg"). */
    packs?: string;
    totalCents?: number;
    /** Why a line is left out, or what ordering accepts for it: the planner's code and its sentence. */
    point?: { kind: string; text: string };
  }[];
  /**
   * What the one confirmation also does: points it accepts as they are, and lines it leaves out because nothing fits.
   * `kind` is the planner's reason code (translated at the edge); `text` its own sentence, for detail.
   */
  onOrder: { accepts: PlanPoint[]; leavesOut: PlanPoint[] };
  /** Why it cannot be ordered yet (no number of covers, nothing can arrive by the day): the button stays off. */
  blockers: string[];
  totalCents: number;
  deliveryDate?: string;
  orderBy?: string;
  signOff?: { approver?: { name: string; role: string }; reasons: string[] };
  canOrder: boolean;
  /** Where the plan's lines can be edited one by one (the menu planner page). */
  editUrl: string;
  declined?: string;
};

export type Card = UnderstoodCard | AnomalyCard | QuestionCard | OptionsCard | PriceCard | GateCard | OrderCard | MemoryCard | RecordsCard | NoticeCard | PlanCard;
export type CardType = Card["type"];

// ---------- the thread and its event stream ----------

export type Thread = {
  threadId: string;
  kitchen: string;
  orgId: string;
  startedAt: string;
  turns: Turn[];
  /** The last event's sequence number: resume the stream after it. */
  seq: number;
  /** Set while an agent turn is still working or waiting (one at a time per thread). */
  activeTurnId?: string;
};

export type ThreadEvent = { seq: number; threadId: string; at: string } & (
  | { type: "turn"; turn: Turn }
  | { type: "step"; turnId: string; step: ThreadStep }
  /** A new card, or a newer version of one already shown (same cardId): replace it in place. */
  | { type: "card"; turnId: string; card: Card }
  | { type: "line"; turnId: string; text: string }
  | { type: "status"; turnId: string; status: AgentTurnStatus; ms?: number; marks?: AgentTurn["marks"] }
  /** The thread was started over: drop what you hold and load it again. */
  | { type: "reset" }
);

export type ThreadEventType = ThreadEvent["type"];

/** POST /ui-api/kitchens/{kitchen}/thread/turns */
export type SubmitTurn = { door: ThreadDoor; via: TurnVia; text?: string; action?: ThreadAction; label?: string; clientTurnId?: string; lang?: "en" | "fi" | "sv" };
export type SubmitTurnReply = { threadId: string; buyerTurnId: string; agentTurnId: string; seq: number; duplicate?: boolean };
