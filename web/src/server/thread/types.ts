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
  /**
   * Order an earlier order again, rebuilt by plain code (no model): the same product, amount and goal, for the next
   * same weekday. `ref` is the earlier request's id, or the order id for history without a request.
   */
  | { type: "repeat"; ref: string }
  // ----- widgets (docs/agent-thread.md "Widgets"): every one a turn through the same engine and gate -----
  /** Order sheet: set a line's amount in whole packs. `version` is the sheet version the widget showed. */
  | { type: "sheet_packs"; sheetId: string; version: number; lineId: string; packs: number }
  /** Order sheet: deliver every line on this day (one of the sheet's `days`). */
  | { type: "sheet_day"; sheetId: string; version: number; date: string }
  /** Order sheet: replace a line's product (from its alternatives picker). Judged by the substitution rule. */
  | { type: "sheet_swap"; sheetId: string; version: number; lineId: string; productId: string }
  | { type: "sheet_remove"; sheetId: string; version: number; lineId: string }
  /** Add a product to the thread's current order sheet (a sheet is made if there is none): from the catalogue, the basket, a picker. */
  | { type: "sheet_add"; sheetId?: string; version?: number; productId: string; packs?: number }
  /** Open the alternatives picker for one line of a sheet. */
  | { type: "sheet_alternatives"; sheetId: string; lineId: string }
  /** Place the sheet as one order through the gate, at the version the buyer saw (a newer version refuses: re-confirm). */
  | { type: "sheet_place"; sheetId: string; version: number }
  /** Turn the options card's choice into an editable sheet instead of ordering it at once. */
  | { type: "sheet_from_option"; requestId: string; optionId: string }
  /** Alternatives picker: rank again by another requirement (one of the picker's `chips`). */
  | { type: "alt_rerank"; pickerId: string; chip: string }
  /** Alternatives picker: take this candidate (for a sheet line, it becomes a sheet_swap). */
  | { type: "alt_pick"; pickerId: string; productId: string }
  /** Menu builder: take one of the proposals the planner made. */
  | { type: "menu_choose"; planId: string; proposalId: string }
  | { type: "menu_covers"; planId: string; covers: number }
  | { type: "menu_day"; planId: string; date: string }
  /** Menu builder: a line's product, from the line's candidates. */
  | { type: "menu_line_swap"; planId: string; lineId: string; optionId: string }
  /** Menu builder: "we have this" (the line is not bought) or back on the list. */
  | { type: "menu_line_have"; planId: string; lineId: string; have: boolean }
  /** Menu builder: the amount per cover for a line (in the line's own unit, g, ml or pcs). */
  | { type: "menu_line_per_cover"; planId: string; lineId: string; dishId: string; amount: number }
  /** Menu builder: accept a doubt the planner raised on a line ("a different form than the recipe asks"). */
  | { type: "menu_accept"; planId: string; doubtId: string }
  /** The buyer's answer to the wholesaler's offer the agent said (server/offers/thread.ts). */
  | { type: "offer_answer"; offerId: string; answer: "yes" | "no" | "mute" | "off" }
  /** Menu builder: put every bought line on an order sheet, one order. */
  | { type: "menu_to_sheet"; planId: string }
  /** Remember this, in the kitchen's own words: goes through the memory writer, confirmed by the person. */
  | { type: "remember_this"; text: string }
  // ----- the agent as the kitchen's home (docs/agent-thread.md "The home") -----
  /** Search the assortment's master data (no live call): results as a grid that adds to the order sheet. */
  | { type: "products_search"; query: string; category?: string }
  /** One product's facts, in place. */
  | { type: "product_show"; productId: string }
  /** An earlier order's lines on the order sheet, for the next same weekday (the sheet then re-prices and previews). */
  | { type: "order_again"; ref: string }
  /** An order's details and its signed confirmation, in place. */
  | { type: "order_show"; orderId: string }
  /** The kitchen's order history, recurring orders, upcoming deliveries, or what the agent remembers, as a card. */
  | { type: "home_show"; what: "history" | "standing" | "deliveries" | "memory" | "today" }
  /** A recurring order changed: its product at a new amount on the order sheet for its next day. */
  | { type: "standing_change"; family: string; packs?: number }
  /** Pause a recurring order (or run it again): no reminders, not part of "the usual", until switched back on. */
  | { type: "standing_pause"; family: string; paused: boolean }
  /** What the agent remembers: change the words of an item, or forget it (the kitchen's signed-in person only). */
  | { type: "memory_edit"; itemId: string; text: string }
  | { type: "memory_forget"; itemId: string }
  /** The rules card: propose a change (before and after shown, nothing signed), sign it as the kitchen's person, or drop it. */
  | { type: "rules_show" }
  /** `sign`: the person confirms in the same tap (the widget's confirm button): proposed, then signed, if this browser may. */
  | { type: "rules_propose"; change: RulesChange; sign?: boolean }
  | { type: "rules_sign"; proposalId: string }
  | { type: "rules_cancel"; proposalId: string };

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
  /**
   * `input` says which answer widget fits: chips (choice, the default), a day picker (each option a date, with its
   * order-by time), or a stepper (an amount: options are the suggested amounts, min/max/step bound it).
   */
  questions: {
    id: string;
    text: string;
    options: { id: string; label: string; date?: string; orderBy?: string; amount?: number }[];
    input?: { kind: "choice" } | { kind: "day" } | { kind: "amount"; unit: string; min: number; max: number; step: number };
  }[];
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
  /** `taxRatePct`: the VAT rate (prices are before VAT); `depositCents`: per pack, refunded on return, no VAT. */
  lines: { productId: string; name: string; quantity: number; packSize?: number; unit?: string; unitPriceCents?: number; substituteFor?: string; taxRatePct?: number; depositCents?: number }[];
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
  /**
   * What happens when it is tapped, from the gate's own preview (core/intake.ts): placed by the agent alone, sent to
   * the named person, or refused with the rule (then it is not a choice, only shown to say why it is missing).
   */
  gate?: { outcome: "auto_approve" | "needs_human_approval" | "reject"; rule?: string; approver?: { name: string; role: string }; reasons: string[] };
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
  /** The buyer took this option to the order sheet to change it: the card no longer orders by itself. */
  adjusted?: string;
  /**
   * The kind asked for cannot be offered (oat drink), though the assortment has it: why (the kitchen's rules, the day,
   * stock), said first, and every option is shown as something else instead, never as the best match.
   */
  insteadOf?: { asked: string; why: "rules" | "day" | "stock" | "other"; attr?: string; day?: string };
  /** The day the buyer asked for, so an option arriving earlier says so ("arrives Monday, earlier than the Thursday you asked for"). */
  askedDay?: string;
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
  /**
   * The proof, opened in place: the signed quote token and the signed claims (price, stock, origin) it rests on, each
   * verifiable in the browser against the published keys (the shop's verify-signed helper).
   */
  proof?: { quoteToken: string; claims: { claimId: string; type: string; productId: string; token: string }[]; keysUrl: string };
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
  /** A committed order the kitchen's signed-in person may still take back (a `withdraw` tap), until the order cut-off. */
  takeBackUntil?: string;
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
  /** Every row with a `ref` can be ordered again with one tap (a `repeat` action, no model). */
  repeatable?: boolean;
};

export type NoticeCard = CardBase & {
  type: "notice";
  /** `paused`: the agent's reading is paused for today (the server's daily model cap); ordering without a model still works. */
  kind: "not_found" | "not_purchase" | "incomplete" | "unavailable" | "refused" | "error" | "suspended" | "paused";
  message: string;
  /** For `incomplete`: what is missing ("how much, with the unit"). */
  missing?: string[];
  /** For `incomplete`: the words read so far (a follow-up completes them: subject.ts). */
  words?: string;
  /** For `refused`: the rule that fired. */
  rule?: string;
  retry?: boolean;
};

// ---------- widgets ----------

/** What the gate's own preview says will happen when a widget's confirm is pressed: never a guess. */
export type GatePreview = {
  outcome: "auto_approve" | "needs_human_approval" | "reject";
  /** The deciding rule (escalated or failed), as the gate names it. */
  rule?: string;
  /** For needs_human_approval: who signs. */
  approver?: { name: string; role: string };
  /** The gate's reasons, as codes and details for words in the buyer's language, with its sentences as a fallback. */
  rules: { rule: string; outcome: string; details?: Record<string, unknown> }[];
  reasons: string[];
};

/**
 * The order sheet: the thread's current order, editable in place. Every edit is a turn (sheet_* actions) that re-prices
 * the changed lines live and re-runs the gate's preview; the card comes back with the same cardId and version + 1.
 * One sheet is one order through the gate, however many lines.
 */
export type SheetCard = CardBase & {
  type: "sheet";
  sheetId: string;
  version: number;
  state: "editing" | "placed" | "stale";
  /** The delivery day every line is quoted for, and the days the buyer may move to, each with its order-by time. */
  deliveryDate: string;
  days: { date: string; orderBy?: string; available: boolean; why?: string }[];
  lines: {
    lineId: string;
    productId: string;
    name: string;
    category?: string;
    packSize: number;
    unit: string;
    packs: number;
    /** Stepper bounds, in whole packs: min 1, max what the wholesaler can deliver (or the gate's line cap). */
    minPacks: number;
    maxPacks: number;
    unitPriceCents: number;
    lineTotalCents: number;
    /** Per litre or kilo, for comparison. */
    perUnitCents?: number;
    /** When this line stands in for another product: which, and that the substitution rule applies. */
    substituteFor?: { productId: string; name: string };
    /** How many alternatives the picker would show (0: no picker). */
    alternatives: number;
    /** What on this line the gate or the kitchen's rules object to (an allergen, a stated rule, a price cap). */
    issues: { code: string; text: string; blocking: boolean }[];
    stockConfirmed: boolean;
    /** The kitchen's usual amounts of this product, in packs, from its records (one-tap picks beside the stepper). */
    usualPacks?: number[];
  }[];
  totalCents: number;
  /** The gate's own preview of the sheet as it stands. */
  gate: GatePreview;
  /** Shown above the confirm button: what was fixed since the last version ("price changed", "day moved"). */
  changed?: string[];
  /** Set once placed. */
  orderId?: string;
  /** What the mistake check flagged (codes: quantity_unusual, large_first_order, ...), shown to the signed-in person
   * as a notice; confirming the sheet confirms it is what they mean, and `gate` is the preview with it confirmed. */
  check?: string[];
  /** The line the last edit removed, so one tap puts it back (a `sheet_add` of the same product and packs). */
  removed?: { productId: string; name: string; packs: number };
};

/**
 * The alternatives picker: candidates side by side for one line (or one need), each with its numbers, its gate
 * preview and why it ranks where it does. The chips re-rank by another requirement (alt_rerank), in plain code.
 */
export type AlternativesCard = CardBase & {
  type: "alternatives";
  pickerId: string;
  /** What the candidates stand in for: a sheet line, or a request. */
  for: { sheetId?: string; lineId?: string; requestId?: string; productId?: string; name: string; amount: { amount: number; unit: string } };
  /** Re-ranking requirements; `on` marks the active one. */
  chips: { id: "price" | "co2" | "reliability" | "same_kind" | "organic" | "lactose_free" | "gluten_free" | "pack_size" | string; label: string; on: boolean }[];
  candidates: {
    productId: string;
    name: string;
    category?: string;
    packSize: number;
    unit: string;
    packs: number;
    unitPriceCents: number;
    totalCents: number;
    perUnitCents?: number;
    deliveryDate: string;
    orderBy?: string;
    attributes: string[];
    co2Kg: number | null;
    reliability: number | null;
    /** good / better / best by the active chip; the current product is marked. */
    rank: string;
    current: boolean;
    /** What it differs on, as codes for words in the buyer's language ("price_more", "different_kind"). */
    differs: { code: string; params: Record<string, string | number> }[];
    /** What happens if picked: the gate's preview of the sheet with this candidate in the line. */
    gate: GatePreview;
  }[];
  picked?: string;
};

/**
 * The menu builder: a menu request inside the thread. It forms on screen as the planner works: proposals first (the
 * dishes it would cook), then each dish's ingredient lines as they resolve. The buyer edits it in place (menu_*
 * actions); every line obeys the kitchen's mandate, stated rules and memory, as the planner enforces.
 */
export type MenuCard = CardBase & {
  type: "menu";
  planId: string;
  /** proposing: dishes are being drafted; resolving: lines are being matched and priced; ready: editable; ordered. */
  stage: "proposing" | "choose" | "resolving" | "ready" | "ordered" | "declined";
  /** Menu proposals to choose from, when the words leave the menu open ("lunch for 40 around beetroot"). */
  proposals: { proposalId: string; title: string; dishes: string[]; costPerCoverCents?: number }[];
  covers: number | null;
  serviceDate?: string;
  /** Days the plan can be delivered on, with order-by times (menu_day). */
  days: { date: string; orderBy?: string; available: boolean }[];
  /** The day asked for cannot be had (no deliveries that day, or every order time has passed): the earliest that can. */
  dayProblem?: { asked: string; earliest?: string };
  dishes: {
    dishId: string;
    name: string;
    course: string;
    portion?: string;
    lines: {
      lineId: string;
      ingredient: string;
      /** Amount per cover, in g, ml or pcs (menu_line_per_cover edits it). */
      perCover: { amount: number; unit: string };
      /** What the covers need in total, in the product's unit. */
      need: { amount: number; unit: string };
      status: "resolving" | "ready" | "decide" | "have" | "left_out";
      product?: { productId: string; name: string; packs: number; packSize: number; unit: string; totalCents: number; deliveryDate?: string };
      /** Other products for this line (menu_line_swap), each with what it differs on. */
      options: { optionId: string; productId: string; name: string; totalCents: number; differs: { code: string; params: Record<string, string | number> }[] }[];
      /** Allergen, rule and mandate conflicts and the planner's doubts, on the line they concern. */
      conflicts: { code: string; text: string; doubtId?: string; blocking: boolean }[];
    }[];
  }[];
  totalCents: number;
  costPerCoverCents?: number;
  /** What would stop the order now, in plain words (no covers, a doubt open, nothing can arrive by the day). */
  blockers: string[];
  /** The gate's preview of the plan as one order. */
  gate?: GatePreview;
  /** Set once it is on a sheet. */
  sheetId?: string;
};

// ---------- the home: what the kitchen sees and does in the agent (docs/agent-thread.md "The home") ----------

/** One thing that needs the kitchen today, from records and plain code (never the model). */
export type TodayItem =
  /** An order waiting for a named person's sign-off: signed in place (the gate card's sign-off widget). */
  | { kind: "sign_off"; orderId: string; requestId?: string; approvalId: string; totalCents: number; approver: { name: string; role: string }; requestedAt: string; lines: { name: string; quantity: number }[] }
  /** The order cut-off for something the kitchen usually buys closes today: order the usual now (onto the sheet). */
  | { kind: "cutoff"; family: string; productId: string; name: string; orderBy: string; deliveryDate: string; usual: { amount: number; unit: string }; packs: number }
  /** A recurring order whose amount or price has drifted from the usual. */
  | { kind: "drift"; family: string; warning: string; productId: string; name: string; usual: { amount: number; unit: string }; recent: number; amountPct: number | null; pricePct: number | null; nextDue?: string }
  /** A recall hold on a product the kitchen has bought. */
  | { kind: "recall"; productId: string; productName: string; reason: string; noticeTitle: string; noticeUrl: string; publisher: string; drill: boolean; lastOrdered?: string }
  /** An order arriving today or tomorrow. */
  | { kind: "delivery"; orderId: string; deliveryDate: string; totalCents: number; lines: { name: string; quantity: number }[] };

/** The opening: what needs the kitchen today, posted by the engine when the kitchen opens the agent. Empty: nothing does. */
/** What needs the kitchen today (the opening); `pending` while it is being gathered. Plain code from records only. */
export type TodayCard = CardBase & { type: "today"; date: string; items: TodayItem[]; pending?: boolean };

export type ProductTile = {
  productId: string;
  name: string;
  brand?: string;
  category: string;
  packSize: number;
  unit: string;
  attributes: string[];
  allergens: string[];
  /** How it relates to the words (smart search's judge): the kind asked, a variant, or a stand-in shown as "instead". */
  match?: "exact" | "variant" | "standin";
};

/** A grid of products from the assortment's master data (no live call until one is added to the order sheet). */
export type ProductsCard = CardBase & {
  type: "products";
  query: string;
  category?: string;
  total: number;
  products: ProductTile[];
  /**
   * What the search made of the words (server/search): `onlyStandins` when nothing is the kind asked and the products
   * are stand-ins ("no oat drink; instead:"), `notSold` when nothing in the assortment is, `unsure` when the judge was
   * not sure of its top answer, `notes` for requirements read from the words ("read 'laktositon' as lactose-free").
   */
  search?: { path: "judge" | "ranked" | "lexical"; onlyStandins: boolean; notSold: boolean; unsure: boolean; notes: string[] };
};

/** One product's facts, from master data (prices only once it is on the order sheet). */
export type ProductCard = CardBase & {
  type: "product";
  product: ProductTile & {
    certificates: string[];
    allergensDeclared: boolean;
    /** No allergen data from the maker, but fresh whole produce: what it is, "by its nature, not declared by the maker". */
    allergensByNature?: string;
    origin?: string;
    co2KgPerUnit: number | null;
    reliability: number | null;
    gtin?: string;
  };
};

/** The kitchen's recurring orders, as the history shows them (no separate store: plain code over the order history). */
export type StandingCard = CardBase & {
  type: "standing";
  items: { family: string; productId: string; name: string; weekdays: number[]; usual: { amount: number; unit: string }; usualPacks: number; lastAmount: number; nextDue?: string; drift: { amountPct: number | null; pricePct: number | null }; paused?: boolean }[];
};

/** Orders on their way: committed or waiting for sign-off, by delivery day. */
export type DeliveriesCard = CardBase & {
  type: "deliveries";
  items: { orderId: string; status: string; deliveryDate: string; totalCents: number; lines: { name: string; quantity: number }[] }[];
};

/** What the agent remembers about the kitchen, each item editable or forgettable by the kitchen's signed-in person. */
export type MemoryListCard = CardBase & {
  type: "memory_list";
  items: { itemId: string; text: string; kind: string; strength: string; origin: string; status: string; family?: string }[];
  /** False when nobody is signed in for the kitchen: the items can be read, not changed. */
  canChange: boolean;
};

/**
 * The wholesaler's one offer, said by the agent in the conversation (server/offers): its sentence and question in each
 * language (plain code wrote them from the signed offer), the steps and proof for the closed steps view, and the answer.
 */
export type OfferCard = CardBase & {
  type: "offer";
  offerId: string;
  productId: string;
  name: string;
  text: Record<"en" | "fi" | "sv", { say: string; ask: string }>;
  steps: string[];
  proof: { token: string; keysUrl: string; verified: boolean };
  validUntil: string;
  state: "open" | "yes" | "no" | "mute" | "off";
  /** The agent's line back after the answer, in the language it was given in. */
  reply?: string;
  requestId?: string;
};

export type Card = OfferCard | UnderstoodCard | AnomalyCard | QuestionCard | OptionsCard | PriceCard | GateCard | OrderCard | MemoryCard | RecordsCard | NoticeCard | SheetCard | AlternativesCard | MenuCard | TodayCard | ProductsCard | ProductCard | StandingCard | DeliveriesCard | MemoryListCard | RulesCard;
// ---------- the kitchen's rules (docs/agent-thread.md "Widgets": rules) ----------

/** The mandate as the rules card shows it: plain values. `groups` only where the kitchen has terms (an account). */
export type RulesSnapshot = {
  perOrderLimitCents: number;
  weeklyBudgetCents: number;
  categories: string[];
  groups?: { id: string; name: string }[];
  requiredAttributes: string[];
  forbiddenAllergens: string[];
  approvers: { name: string; role: string; maxApprovalCents: number }[];
  maxLeadDays: number;
  substitution: string;
};

/**
 * One change to the rules, in the mandate's own vocabulary. Only `forbidAdd` and `requireAdd` narrow the mandate
 * (any kitchen, its signed-in person); everything else is a change of terms (an account's own session only).
 */
export type RulesChange = {
  forbidAdd?: string[];
  forbidRemove?: string[];
  requireAdd?: string[];
  requireRemove?: string[];
  groupsAdd?: string[];
  groupsRemove?: string[];
  perOrderLimitEur?: number;
  weeklyBudgetEur?: number;
  maxLeadDays?: number;
  signer?: string;
  substitution?: "within_preferences" | "needs_approval" | "none";
};

export type RulesCard = CardBase & {
  type: "rules";
  kitchenKind: "demo" | "visitor" | "account";
  mandateId: string;
  validUntil: string;
  current: RulesSnapshot;
  /** Rules the kitchen's people stated (memory), applied on every order. */
  stated: { id: string; text: string }[];
  /** What this browser may sign here; `why` is a code the widget words (not_signed_in, not_this_account, demo_terms_fixed, visitor_terms_fixed). */
  editable: { narrow: boolean; terms: boolean; why?: string; /** The signed-in person who would sign. */ as?: string };
  /** The values the widget may offer (the mandate's vocabulary). */
  vocabulary: { forbid: string[]; require: string[]; substitution: string[]; groups: { id: string; name: string }[] };
  /** A proposed change: nothing is signed until `rules_sign`. */
  proposal?: { proposalId: string; change: RulesChange; kind: "narrow" | "terms"; state: "open" | "signed" | "cancelled"; canSign: boolean; why?: string; signedAs?: string };
  after?: RulesSnapshot;
  /** Before and after, field by field; `widens` marks a change that lets the agent do more. */
  diff: { field: string; before: string; after: string; widens: boolean }[];
};

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
