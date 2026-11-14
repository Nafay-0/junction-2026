import type { Approver, Mandate } from "./mandate";
import type { Quote, QuoteLine } from "./quote";
import { latestDeliveryDay } from "./kitchen";
import { formatEur } from "./util";
import { allergenOf, forbiddenPresent, isMaterialAttribute } from "./vocabulary";

/**
 * The gate. A pure function: same mandate, draft and context in, same decision out. No I/O, no clock,
 * no model. Every rule always reports a result, so a refusal can name exactly what fired and why.
 *
 * Outcomes per rule:
 *   pass      the rule is satisfied
 *   escalate  allowed only with a human sign-off (over the per-order limit, a substitute under "needs_approval" or one
 *             that differs from the original under "within_preferences", a need split into orders under the limit,
 *             money held by orders waiting for sign-off, or a likely mistake no identified person confirmed)
 *   fail      not allowed at all; the order is rejected
 *
 * Decision: any fail -> reject; else any escalate -> needs_human_approval (to the least senior approver
 * who can sign the amount); else auto_approve.
 */
export const RULES = [
  "mandate_agent", // the agent presenting the order is the one the mandate names
  "mandate_window", // the mandate is in force at decision time: inside its dates, and not replaced by a reissue
  "quote_binding", // the quote was issued to this organisation, agent, mandate and request
  "quote_expiry", // the quote's fixed price still holds
  "quote_replay", // the quote has not been used for another order
  "order_matches_quote", // the order buys exactly what was quoted, at the quoted prices and quantities
  "category_allowed",
  "required_attributes",
  "forbidden_allergens",
  "required_certificates",
  "recall_hold", // no product is held by the wholesaler under a recall notice (or a recall drill)
  "delivery_deadline", // every line arrives by the need-by date and within the mandate's max lead time
  "substitution_rule", // substitutes allowed per the mandate's rule (none / same_attributes / needs_approval)
  "substitute_price", // substitute's price per unit within the tolerated increase
  "weekly_budget", // committed spend over 7 days stays within budget (hard); money held by orders waiting for sign-off is a person's call
  "per_order_limit", // above it, a human must sign off
  "order_splitting", // orders the agent placed alone within a day for the same product family may not add up to more than it may spend alone, whatever their delivery days; the weekly budget is the ceiling behind it
  "human_confirmation", // the mistake check flagged the order and no identified person confirmed it (nobody was asked, or the yes was only relayed): a person signs off
  "approver_authority", // someone named in the mandate can sign off this amount
] as const;

export type RuleId = (typeof RULES)[number];
export type RuleOutcome = "pass" | "escalate" | "fail";
export type RuleResult = { rule: RuleId; outcome: RuleOutcome; reason: string; details?: Record<string, unknown> };

export type OrderDraftLine = { productId: string; quantity: number; unitPriceCents: number };

/** What the agent asks to buy: a verified quote plus the lines it says it is ordering from it. */
export type OrderDraft = {
  agentId: string; // agent presenting the order
  quote: Quote; // signature already verified
  lines: OrderDraftLine[];
  neededBy?: string; // YYYY-MM-DD, from the purchase request
  /** Delivered exactly on this day (YYYY-MM-DD), when the request asked for a day rather than a deadline. */
  deliverOn?: string;
  /** The request the order is placed under. A quote buys only for the request it was issued for. */
  requestId?: string;
  /** What the request asked for (orders.ts PurchaseRequest.asked): any other product is a substitute of it. */
  asked?: { productIds: string[]; category?: string; names?: Record<string, string>; /** Lines of the family asked for that are not the kind asked for (core/qualifiers.ts): stand-ins. */ standIns?: string[] };
};

/** A product the wholesaler holds (a recall notice, a drill): no order may buy it while the hold is in force. */
export type ProductHold = { productId: string; name?: string; reason: string; url?: string; drill?: boolean };

/** An earlier order of the same organisation, as the splitting check needs it. */
export type RecentOrder = {
  orderId: string;
  requestId: string;
  placedAt: string; // ISO
  totalCents: number;
  categories: string[];
  deliveryDates: string[];
  /** "mandate": the agent placed it alone; "approver": a person signed it off; "pending": waiting for sign-off. */
  authorisedBy: "mandate" | "approver" | "pending";
};

/**
 * The orders that count together with this one for order_splitting, counted by the store: those the agent placed
 * alone in the window, for the same request or product family. `latest`: the newest few of them, to name.
 */
export type SplitWindow = { count: number; totalCents: number; latest: RecentOrder[] };

/** How many earlier orders a splitting reason or its details name; the rest are counted. */
export const SPLIT_NAMED_MAX = 10;

export type PolicyContext = {
  now: Date;
  spentThisWeekCents: number; // committed + pending orders of this organisation over the last 7 days
  /**
   * The part of spentThisWeekCents held by orders still waiting for sign-off (their fixed price not yet expired).
   * Committed spend is a hard limit; held money only stops the agent spending it alone: an order that fits the
   * budget unless every waiting order is signed too goes to a person, who sees both. Absent: 0 (all committed).
   */
  heldThisWeekCents?: number;
  /** The orders holding that money, named in the reason. */
  heldOrders?: { orderId: string; totalCents: number; expiresAt: string }[];
  /**
   * Confirmations of likely mistakes that matter (an unusual amount, a request against a stated rule) that reached
   * Dock only as the agent's word, not through a channel that identifies a person (intake.ts InputChannel).
   */
  unverifiedConfirmations?: { code: string; message: string; by: string }[];
  /**
   * What the mistake check finds in this order when nobody was asked: the order did not come through the intake's
   * questions (orders.ts mistakeCheckOf). Each is a likely mistake that matters; the agent may not decide it alone.
   */
  unconfirmedConcerns?: { code: string; message: string }[];
  quoteAlreadyUsed: boolean;
  /** Set when the kitchen reissued its mandate after this one was signed (mandate.ts supersededBy): the reason, in words. */
  mandateSuperseded?: string;
  /** Orders of this organisation in the last SPLIT_WINDOW_HOURS, for the order_splitting check. Absent: none. */
  recentOrders?: RecentOrder[];
  /**
   * The same check's earlier orders as the store counted them (orders.ts DockRepository.splitWindow): used instead
   * of recentOrders when present, so a busy day costs a sum, not a list of every order placed that day.
   */
  splitWindow?: SplitWindow;
  /** Holds in force on the order's products (orders.ts ProductHolds). Absent: none. */
  holds?: ProductHold[];
  /**
   * The kitchen's own person chose this stand-in or substitute themselves, in a channel that identifies them (the
   * signed-in store, a voice call from their signed-in phone; intake.ts InputChannel): their confirmation of it. A
   * choice an agent relayed never sets it.
   */
  substitutionConfirmedBy?: string;
};

/**
 * Orders placed within this window are read together, by when they were placed, not by when they deliver. A day
 * covers "three orders in a row before lunch" and the evening top-up, and asking for the second half a day later
 * no longer slips past. A standing order placed a week after the last one is outside it and stands alone.
 */
export const SPLIT_WINDOW_HOURS = 24;

type Common = { totalCents: number; rules: RuleResult[]; reasons: string[] };
export type Decision =
  | ({ outcome: "auto_approve" } & Common)
  | ({ outcome: "needs_human_approval"; approver: Approver } & Common)
  | ({ outcome: "reject" } & Common);

export function evaluatePolicy(mandate: Mandate, draft: OrderDraft, ctx: PolicyContext): Decision {
  const q = draft.quote;
  const total = q.totalCents;
  const results: RuleResult[] = [];
  const add = (rule: RuleId, outcome: RuleOutcome, reason: string, details?: Record<string, unknown>) =>
    results.push({ rule, outcome, reason, details });
  const lineCheck = (rule: RuleId, bad: (l: QuoteLine) => string | null, okReason: string) => {
    const problems = q.lines.map(bad).filter((x): x is string => x !== null);
    if (problems.length) add(rule, "fail", problems.join(" "));
    else add(rule, "pass", okReason);
  };

  // Who and when
  if (draft.agentId === mandate.agentId) add("mandate_agent", "pass", `Agent ${draft.agentId} is the one the mandate names.`);
  else add("mandate_agent", "fail", `Mandate is for agent ${mandate.agentId}, but agent ${draft.agentId} presented it.`, { expected: mandate.agentId, actual: draft.agentId });

  const t = ctx.now.getTime();
  if (ctx.mandateSuperseded) add("mandate_window", "fail", ctx.mandateSuperseded, { superseded: true });
  else if (t >= Date.parse(mandate.validFrom) && t < Date.parse(mandate.validUntil)) add("mandate_window", "pass", "Mandate is in force.");
  else add("mandate_window", "fail", `Mandate is only valid from ${mandate.validFrom} until ${mandate.validUntil}.`);

  // Quote integrity
  const binding: string[] = [];
  if (q.buyerOrgId !== mandate.issuer.orgId) binding.push(`organisation ${q.buyerOrgId}`);
  if (q.agentId !== mandate.agentId) binding.push(`agent ${q.agentId}`);
  if (q.mandateId !== mandate.mandateId) binding.push(`mandate ${q.mandateId}`);
  if (binding.length) add("quote_binding", "fail", `Quote ${q.quoteId} was issued to ${binding.join(", ")}, not to this mandate.`);
  else if (draft.requestId !== undefined && q.requestId !== draft.requestId)
    add("quote_binding", "fail", `Quote ${q.quoteId} was issued for request ${q.requestId}, not ${draft.requestId}; a quote buys only for the request it was made for.`, { quoteRequestId: q.requestId, orderRequestId: draft.requestId });
  else add("quote_binding", "pass", `Quote ${q.quoteId} was issued under this mandate${draft.requestId ? ` for request ${draft.requestId}` : ""}.`);

  if (t < Date.parse(q.expiresAt)) add("quote_expiry", "pass", `Quote holds its prices until ${q.expiresAt}.`);
  else add("quote_expiry", "fail", `Quote ${q.quoteId} expired at ${q.expiresAt}; ask for a new quote.`, { expiresAt: q.expiresAt });

  if (ctx.quoteAlreadyUsed) add("quote_replay", "fail", `Quote ${q.quoteId} has already been used for an order; a quote buys once.`);
  else add("quote_replay", "pass", "Quote has not been used before.");

  const mismatch = compareLines(q, draft.lines);
  if (mismatch) add("order_matches_quote", "fail", mismatch);
  else add("order_matches_quote", "pass", "Order buys exactly the quoted products, quantities and prices.");

  // Products
  lineCheck(
    "category_allowed",
    (l) => (mandate.allowedCategories.includes(l.category) ? null : `${l.productId} is in category "${l.category}", which the mandate does not allow (allowed: ${mandate.allowedCategories.join(", ")}).`),
    "Every product is in an allowed category.",
  );
  lineCheck(
    "required_attributes",
    (l) => {
      const missing = mandate.requiredAttributes.filter((a) => !l.attributes.includes(a));
      return missing.length ? `${l.productId} lacks required attribute(s): ${missing.join(", ")}.` : null;
    },
    mandate.requiredAttributes.length ? `Every product is ${mandate.requiredAttributes.join(", ")}.` : "No attributes required.",
  );
  // Unknown is never safe. A product whose maker sent no allergen data is refused when the mandate forbids any
  // allergen, rather than sent to a person: the approver on a phone has no better data than Dock, and a sign-off
  // would turn the organisation's hard safety rule into a tap. The fix is a product with declared allergens.
  lineCheck(
    "forbidden_allergens",
    (l) => {
      // One vocabulary with the intake and the knowledge map (core/vocabulary.ts): "tree nuts", "pähkinä" and a
      // hazelnut are all nuts; milk without a lactose-free claim carries lactose; a word nobody can map is refused.
      const unmapped = mandate.forbiddenAllergens.filter((a) => !allergenOf(a));
      if (unmapped.length) return `the mandate forbids ${unmapped.join(", ")}, which Dock cannot check against product data, so nothing shows ${l.productId} is free of it.`;
      const found = forbiddenPresent({ present: l.allergens, claims: l.attributes }, mandate.forbiddenAllergens);
      if (found.length) return `${l.productId} contains forbidden allergen(s): ${found.join(", ")}.`;
      if (mandate.forbiddenAllergens.length && l.allergensDeclared === false) {
        // Fresh, whole produce contains what it is itself (core/catalog/nature.ts), unless the mandate asks for declared data only.
        const nature = mandate.allergenEvidence === "declared" ? undefined : l.allergensByNature;
        if (!nature) return `${l.productId} has no allergen data from its maker, so nothing shows it is free of ${mandate.forbiddenAllergens.join(", ")}. Unknown is not safe: choose a product with declared allergens.`;
        const byNature = forbiddenPresent({ present: nature.allergens, claims: l.attributes }, mandate.forbiddenAllergens);
        if (byNature.length) return `${l.productId} contains forbidden allergen(s) by its nature: ${byNature.join(", ")}.`;
      }
      return null;
    },
    mandate.forbiddenAllergens.length
      ? `No product contains ${mandate.forbiddenAllergens.join(", ")}, by declared allergen data${q.lines.some((l) => l.allergensDeclared === false && l.allergensByNature) && mandate.allergenEvidence !== "declared" ? `; ${q.lines.filter((l) => l.allergensDeclared === false && l.allergensByNature).map((l) => `${l.productId} by its nature, not declared by the maker (${l.allergensByNature!.basis.split(":")[0]})`).join("; ")}` : ""}.`
      : "No product contains a forbidden allergen.",
  );
  lineCheck(
    "required_certificates",
    (l) => {
      const missing = mandate.requiredCertificates.filter((c) => !l.certificates.includes(c));
      return missing.length ? `${l.productId} lacks required certificate(s): ${missing.join(", ")}.` : null;
    },
    mandate.requiredCertificates.length ? `Every product carries ${mandate.requiredCertificates.join(", ")}.` : "No certificates required.",
  );

  const holds = (ctx.holds ?? []).filter((h) => q.lines.some((l) => l.productId === h.productId));
  if (holds.length)
    add(
      "recall_hold",
      "fail",
      holds.map((h) => `${h.drill ? "DRILL, not a real recall: " : ""}${h.name ?? q.lines.find((l) => l.productId === h.productId)?.name ?? h.productId} (${h.productId}) is held by the wholesaler: ${h.reason}${h.url ? ` Notice: ${h.url}` : ""}`).join(" "),
      { holds: holds.map((h) => ({ productId: h.productId, url: h.url, drill: h.drill ?? false })) },
    );
  else add("recall_hold", "pass", "No product is on a recall hold.");

  const leadLimit = latestDeliveryDay(ctx.now, mandate.delivery.maxLeadDays); // Helsinki days, as the intake counts them
  const latest = draft.neededBy && draft.neededBy < leadLimit ? draft.neededBy : leadLimit;
  lineCheck(
    "delivery_deadline",
    (l) =>
      l.deliveryDate > latest
        ? `${l.productId} arrives ${l.deliveryDate}, after the latest acceptable date ${latest}.`
        : draft.deliverOn && l.deliveryDate !== draft.deliverOn
          ? `${l.productId} arrives ${l.deliveryDate}, not on ${draft.deliverOn}, the day the request asked for.`
          : null,
    draft.deliverOn ? `Every line arrives on ${draft.deliverOn}, the day asked.` : `Every line arrives by ${latest}.`,
  );

  // Substitution. The gate works out for itself what is a substitute: a declared one, or any line that is not what
  // the request asked for (another product than the one named, or another family), declared or not.
  const askedIds = draft.asked?.productIds ?? [];
  const askedCategory = draft.asked?.category;
  const askedName = (id: string) => (draft.asked?.names?.[id] ? `${draft.asked.names[id]} (${id})` : id);
  const standIns = new Set(draft.asked?.standIns ?? []);
  const undeclared = q.lines.filter(
    (l) => !l.substituteFor && ((askedIds.length > 0 && !askedIds.includes(l.productId)) || (askedCategory !== undefined && l.category !== askedCategory) || standIns.has(l.productId)),
  );
  const subs = q.lines.filter((l) => l.substituteFor);
  const rule = mandate.substitution.rule;
  // Declared substitutes: judged against the original they name (Dock names it from the request, see orders.ts).
  let subRule: { outcome: RuleOutcome; reason: string; details?: Record<string, unknown> } = { outcome: "pass", reason: "No substitutes." };
  if (subs.length) {
    const describe = (l: QuoteLine) => `${l.productId} substitutes for ${originalName(l)}`;
    const differences = subs.map((l) => attributeDifference(l)).filter((x): x is string => x !== null);
    if (rule === "none") subRule = { outcome: "fail", reason: `${subs.map(describe).join("; ")}, but the mandate allows no substitutes.` };
    else if (rule === "same_attributes")
      subRule = differences.length ? { outcome: "fail", reason: `Substitutes must match the original: ${differences.join(" ")}` } : { outcome: "pass", reason: `${subs.map(describe).join("; ")} with the same attributes.` };
    else if (rule === "within_preferences")
      subRule = differences.length
        ? { outcome: "escalate", reason: `${subs.map(describe).join("; ")}, but not like for like, so a person must approve it: ${differences.join(" ")}` }
        : { outcome: "pass", reason: `${subs.map(describe).join("; ")}, like for like (same category, unit, diet, fat and organic status): the agent may decide.` };
    else subRule = { outcome: "escalate", reason: `${subs.map(describe).join("; ")}; the mandate requires a person to approve substitutes.${differences.length ? " " + differences.join(" ") : ""}` };
  }
  // Undeclared ones: not what was asked, with no original to compare to. Never decided by the agent alone.
  if (undeclared.length) {
    const what = undeclared.map((l) => `${l.productId} is not what the request asked for (${standIns.has(l.productId) ? `not the kind of ${askedCategory ?? "product"} the words asked for` : askedIds.length ? askedIds.map(askedName).join(", ") : `category ${askedCategory}`})`).join("; ");
    const strict = rule === "none" || rule === "same_attributes";
    const u = strict
      ? { outcome: "fail" as const, reason: `${what}, so it is a substitute, and the mandate allows ${rule === "none" ? "no substitutes" : "only like-for-like substitutes it can compare"}.` }
      : { outcome: "escalate" as const, reason: `${what}, so it is a substitute nobody priced against the original: a person must approve it.` };
    const worse = subRule.outcome === "fail" ? subRule : u;
    subRule = { outcome: worse.outcome, reason: subs.length && subRule.outcome !== "pass" && worse !== subRule ? `${u.reason} ${subRule.reason}` : worse === subRule ? `${subRule.reason} ${u.reason}` : u.reason, details: { undeclared: undeclared.map((l) => l.productId) } };
  }
  // The kitchen's own identified person chose it: their confirmation, where the mandate leaves it to a person.
  if (subRule.outcome === "escalate" && ctx.substitutionConfirmedBy)
    subRule = { outcome: "pass", reason: `${subRule.reason} ${ctx.substitutionConfirmedBy} chose it themselves, signed in to the kitchen's store: that is a person's confirmation.`, details: { ...subRule.details, confirmedBy: ctx.substitutionConfirmedBy } };
  add("substitution_rule", subRule.outcome, subRule.reason, subRule.details);
  if (subs.length === 0) add("substitute_price", "pass", undeclared.length ? "No declared substitute to price; undeclared ones are judged by substitution_rule." : "No substitutes.");
  else {
    const limit = mandate.substitution.maxPriceIncreasePct;
    const over = subs
      .map((l) => ({ l, pct: perUnitIncreasePct(l) }))
      .filter(({ pct }) => pct > limit + 1e-9);
    if (over.length) {
      add(
        "substitute_price",
        "fail",
        over.map(({ l, pct }) => `${l.productId} costs ${pct.toFixed(1)} % more per ${l.unit} than ${originalName(l)}; the mandate tolerates ${limit} %.`).join(" "),
        { maxPriceIncreasePct: limit, increases: over.map(({ l, pct }) => ({ productId: l.productId, pct: round1(pct) })) },
      );
    } else {
      add("substitute_price", "pass", `Every substitute is within +${limit} % per unit of the original.`, {
        increases: subs.map((l) => ({ productId: l.productId, pct: round1(perUnitIncreasePct(l)) })),
      });
    }
  }

  // Money
  const held = Math.min(Math.max(0, ctx.heldThisWeekCents ?? 0), ctx.spentThisWeekCents);
  const committed = ctx.spentThisWeekCents - held;
  const after = ctx.spentThisWeekCents + total;
  const budgetDetails = { budgetCents: mandate.weeklyBudgetCents, spentCents: ctx.spentThisWeekCents, committedCents: committed, heldCents: held, totalCents: total };
  if (after <= mandate.weeklyBudgetCents)
    add("weekly_budget", "pass", `Weekly spend would be ${formatEur(after)} of ${formatEur(mandate.weeklyBudgetCents)}.`, budgetDetails);
  else if (committed + total > mandate.weeklyBudgetCents)
    add("weekly_budget", "fail", `This ${formatEur(total)} order would take weekly spend to ${formatEur(committed + total)}, over the ${formatEur(mandate.weeklyBudgetCents)} budget (already ${formatEur(committed)} committed${held ? `, ${formatEur(held)} more waiting for sign-off` : ""}).`, budgetDetails);
  else {
    // Fits with what is committed, not with what waits for sign-off. Decided below, once the other rules are in:
    // an order a person signs anyway goes to them with both in view; one the agent would place alone is refused.
    add("weekly_budget", "escalate", "", { ...budgetDetails, heldOrders: ctx.heldOrders, held: true });
  }

  const limitDetails = { limitCents: mandate.perOrderLimitCents, totalCents: total };
  if (total <= mandate.perOrderLimitCents)
    add("per_order_limit", "pass", `Total ${formatEur(total)} is within the ${formatEur(mandate.perOrderLimitCents)} per-order limit.`, limitDetails);
  else
    add("per_order_limit", "escalate", `Total ${formatEur(total)} is over the ${formatEur(mandate.perOrderLimitCents)} per-order limit the agent may spend alone.`, limitDetails);

  const split = splitCheck(mandate, draft, ctx);
  add("order_splitting", split.outcome, split.reason, split.details);

  const unverified = ctx.unverifiedConfirmations ?? [];
  const CONFIRMATION_KIND: Record<string, string> = {
    quantity_tenfold: "an amount about ten times the usual",
    quantity_unusual: "an unusual amount",
    unit_confusion: "a unit that may be mixed up",
    contradicts_preference: "a request against one of the kitchen's own rules",
    duplicate_recent: "a possible repeat of a recent order",
    declined_before: "a product the kitchen turned down before",
    breaks_remembered_rule: "a request against a rule the kitchen's memory holds",
    standing_order_range: "an amount outside the kitchen's standing order",
  };
  const unasked = ctx.unconfirmedConcerns ?? [];
  const kinds = (xs: { code: string }[]) => [...new Set(xs.map((u) => CONFIRMATION_KIND[u.code] ?? "a likely mistake AimoPilot flagged"))].join(" and ");
  if (unverified.length === 0 && unasked.length === 0) add("human_confirmation", "pass", "The mistake check found nothing that an identified person has not confirmed.");
  else if (unverified.length === 0)
    // Nobody was asked: the order did not come through the intake's questions. Same privacy rule as below: the kind
    // of check, never its words.
    add("human_confirmation", "escalate", `The mistake check flagged ${kinds(unasked)}, and no person was asked. A named person must sign it off, with the check shown to them.`, { flagged: unasked.map((u) => u.code) });
  else
    add(
      "human_confirmation",
      "escalate",
      // The decision is the shared record the wholesaler reads: it names what kind of check was confirmed, never the
      // check's words, which quote the kitchen's memory (its usual amounts, its own rules). The person signing off
      // sees the words with the order (Order.notes).
      `The agent relayed that ${[...new Set(unverified.map((u) => u.by))].join(", ")} confirmed ${kinds(unverified)} as intended, but nobody verified it.${unasked.length ? ` The mistake check also flagged ${kinds(unasked)}, and no person was asked.` : ""} A named person must sign it off, with the check shown to them.`,
      { confirmations: unverified.map((u) => ({ code: u.code, by: u.by })), ...(unasked.length ? { flagged: unasked.map((u) => u.code) } : {}) },
    );

  const heldBudget = results.find((r) => r.rule === "weekly_budget" && r.details?.held === true);
  if (heldBudget) {
    const named = (ctx.heldOrders ?? []).map((o) => `${o.orderId} (${formatEur(o.totalCents)})`).join(", ");
    const why = `This ${formatEur(total)} order fits the ${formatEur(mandate.weeklyBudgetCents)} weekly budget with the ${formatEur(committed)} committed, but not together with the ${formatEur(held)} waiting for sign-off${named ? ` on ${named}` : ""}.`;
    if (results.some((r) => r.outcome === "escalate" && r !== heldBudget)) {
      heldBudget.reason = `${why} A person signs this order anyway, so they decide with both in view; if both are signed, the later one is refused.`;
    } else {
      heldBudget.outcome = "fail";
      heldBudget.reason = `${why} The agent may not spend money held for another order alone: withdraw or decide the waiting order, or wait until its price expires.`;
    }
  }

  const needsHuman = results.some((r) => r.outcome === "escalate");
  const signAmount = split.outcome === "escalate" ? Math.max(total, split.combinedCents) : total;
  const approver = needsHuman ? pickApprover(mandate.approvers, signAmount) : undefined;
  if (!needsHuman) add("approver_authority", "pass", "No sign-off needed.");
  else if (approver)
    add("approver_authority", "pass", `${approver.name} (${approver.role}) can sign off up to ${formatEur(approver.maxApprovalCents)}.`, { role: approver.role });
  else
    add("approver_authority", "fail", `Sign-off is needed, but no approver in the mandate may sign ${formatEur(signAmount)}.`, {
      approvers: mandate.approvers.map((a) => ({ role: a.role, maxApprovalCents: a.maxApprovalCents })),
    });

  const rules = RULES.map((id) => results.find((r) => r.rule === id)!);
  const fails = rules.filter((r) => r.outcome === "fail");
  const escalations = rules.filter((r) => r.outcome === "escalate");
  if (fails.length) return { outcome: "reject", totalCents: total, rules, reasons: fails.map((r) => r.reason) };
  if (escalations.length && approver) {
    return {
      outcome: "needs_human_approval",
      approver,
      totalCents: total,
      rules,
      reasons: [...escalations.map((r) => r.reason), `Sent to ${approver.name} (${approver.role}) for sign-off.`],
    };
  }
  return {
    outcome: "auto_approve",
    totalCents: total,
    rules,
    reasons: [`All ${rules.length} checks passed; ${formatEur(total)} is within what the agent may spend alone.`],
  };
}

/** The rule that decided a refusal: the first failing rule, in RULES order. */
export function decidingRule(decision: Decision): RuleResult | undefined {
  return decision.rules.find((r) => r.outcome === "fail");
}

function compareLines(q: Quote, lines: OrderDraftLine[]): string | null {
  if (lines.length !== q.lines.length)
    return `Order has ${lines.length} line(s) but quote ${q.quoteId} has ${q.lines.length}; an order must buy exactly what was quoted.`;
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.productId)) return `Order lists ${line.productId} more than once.`;
    seen.add(line.productId);
    const quoted = q.lines.find((l) => l.productId === line.productId);
    if (!quoted) return `${line.productId} is not in quote ${q.quoteId}.`;
    if (line.quantity !== quoted.quantity)
      return `Order asks for ${line.quantity} packs of ${line.productId}; the quote fixed ${quoted.quantity}.`;
    if (line.unitPriceCents !== quoted.unitPriceCents)
      return `Order states ${formatEur(line.unitPriceCents)} per pack of ${line.productId}; the quote fixed ${formatEur(quoted.unitPriceCents)}.`;
  }
  return null;
}

/**
 * How a substitute differs from the product it replaces, on what makes them interchangeable: category, unit and
 * the material attributes (diet, fat, organic). Marketing claims one brand states and another does not
 * ("additive_free", "low_salt") do not count, or no two real products would ever match.
 */
function attributeDifference(l: QuoteLine): string | null {
  const o = l.substituteFor!;
  const parts: string[] = [];
  if (o.category !== l.category) parts.push(`category ${l.category} instead of ${o.category}`);
  if (o.unit !== l.unit) parts.push(`sold per ${l.unit} instead of ${o.unit}`);
  const missing = o.attributes.filter((a) => isMaterialAttribute(a) && !l.attributes.includes(a));
  if (missing.length) parts.push(`lacks ${missing.join(", ")}`);
  const extra = l.attributes.filter((a) => /^fat_/.test(a) && isMaterialAttribute(a) && !o.attributes.includes(a));
  if (extra.length && missing.some((a) => /^fat_/.test(a))) parts.push(`has ${extra.join(", ")}`);
  return parts.length ? `${l.productId} differs from ${originalName(l)}: ${parts.join("; ")}.` : null;
}

/**
 * The product a substitute replaces, by name and code. Its name travels in the quote (a person reading a refusal
 * may have only the order's own lines loaded, so a bare code for the original would be all they see).
 */
function originalName(l: QuoteLine): string {
  const o = l.substituteFor!;
  return o.name && o.name !== o.productId ? `${o.name} (${o.productId})` : o.productId;
}

/**
 * Order splitting: an agent that places several orders below its per-order limit for one need has spent more
 * alone than the mandate lets it. Orders count together when the agent placed them alone (no person signed
 * them) within SPLIT_WINDOW_HOURS, and they are for the same request or the same product family (the category
 * substitutes are judged in), whatever days they deliver on. Over the limit together: a person signs off, with
 * the earlier orders named. Judged by when orders are placed: one need spread over several days of ordering is
 * not caught here, and the weekly budget, which no sign-off lifts, is the ceiling behind this rule.
 */
function splitCheck(mandate: Mandate, draft: OrderDraft, ctx: PolicyContext): { outcome: RuleOutcome; reason: string; combinedCents: number; details?: Record<string, unknown> } {
  const q = draft.quote;
  const since = ctx.now.getTime() - SPLIT_WINDOW_HOURS * 3600_000;
  const categories = new Set(q.lines.map((l) => l.category));
  // Oldest first, as they are named.
  const related = ctx.splitWindow
    ? [...ctx.splitWindow.latest].reverse()
    : (ctx.recentOrders ?? []).filter((o) => o.authorisedBy === "mandate" && Date.parse(o.placedAt) > since && (o.requestId === q.requestId || o.categories.some((c) => categories.has(c))));
  const count = ctx.splitWindow ? ctx.splitWindow.count : related.length;
  const earlier = ctx.splitWindow ? ctx.splitWindow.totalCents : related.reduce((s, o) => s + o.totalCents, 0);
  const combinedCents = earlier + q.totalCents;
  if (count === 0) return { outcome: "pass", reason: "No earlier order the agent placed alone for the same product family in the last day.", combinedCents };
  // Name the newest few; a busy day is counted, not listed (each order keeps its decision, so a list of every
  // earlier order would make the store grow with the square of the day's orders).
  const named = related.slice(-SPLIT_NAMED_MAX);
  const more = count - named.length;
  const details = {
    windowHours: SPLIT_WINDOW_HOURS,
    limitCents: mandate.perOrderLimitCents,
    combinedCents,
    earlierCount: count,
    earlierCents: earlier,
    earlier: named.map((o) => ({ orderId: o.orderId, totalCents: o.totalCents, placedAt: o.placedAt })),
  };
  const what = [...categories].join(", ");
  if (q.totalCents > mandate.perOrderLimitCents || combinedCents <= mandate.perOrderLimitCents) {
    return { outcome: "pass", reason: `With ${count} earlier order${count > 1 ? "s" : ""} the agent placed alone for ${what}, the total is ${formatEur(combinedCents)}${q.totalCents > mandate.perOrderLimitCents ? "; this order goes to a person anyway" : `, within the ${formatEur(mandate.perOrderLimitCents)} it may spend alone`}.`, combinedCents, details };
  }
  const list = (more > 0 ? `${more} earlier order${more > 1 ? "s" : ""} (${formatEur(earlier - named.reduce((s, o) => s + o.totalCents, 0))}), ` : "") + named.map((o) => `${o.orderId} (${formatEur(o.totalCents)})`).join(", ");
  return {
    outcome: "escalate",
    reason: `Looks like one need split into smaller orders: with ${list} placed alone in the last ${SPLIT_WINDOW_HOURS} h for ${what}, whatever the delivery days, this ${formatEur(q.totalCents)} order makes ${formatEur(combinedCents)}, over the ${formatEur(mandate.perOrderLimitCents)} the agent may spend alone. Splitting does not lift the limit, so a person must sign off.`,
    combinedCents,
    details,
  };
}

/** Price increase per unit (per litre, per kg) of a substitute over the product it replaces, in percent. */
function perUnitIncreasePct(l: QuoteLine): number {
  const o = l.substituteFor!;
  const sub = l.unitPriceCents / l.packSize;
  const orig = o.unitPriceCents / o.packSize;
  if (orig === 0) return sub === 0 ? 0 : Infinity;
  return (sub / orig - 1) * 100;
}

function pickApprover(approvers: Approver[], totalCents: number): Approver | undefined {
  return [...approvers]
    .filter((a) => a.maxApprovalCents >= totalCents)
    .sort((a, b) => a.maxApprovalCents - b.maxApprovalCents)[0];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
