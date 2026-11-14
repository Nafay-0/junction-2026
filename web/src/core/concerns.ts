import type { Product } from "./catalog";
import { packsFor } from "./catalog/product";
import {
  activeMemory,
  addDaysIso,
  beforeCutoff,
  earliestDeliveryDay,
  familyHistory,
  formatDay,
  isoWeekday,
  lastOrder,
  localNow,
  memoryItemIdOf,
  nextDeliveryDay,
  primaryLine,
  statedFor,
  usualAmount,
  type KitchenProfile,
  type MemoryItem,
  type StatedPreference,
  localDateOf,
} from "./kitchen";
import { SPEC_DIMENSIONS, dimensionLabel, dimensionValue, formatAmount, NONE, type BaseUnit, type NeedPatch, type NeedUnit, type StructuredNeed } from "./need";

/**
 * Mistake detection. Pure functions: a need, the kitchen's memory and the clock in, a list of concerns out.
 * A concern blocks the request until the buyer confirms it as is (when `confirmable`) or taps one of its
 * corrections. Errors (a date in the past, a unit we cannot read) can only be corrected.
 */

export type ConcernCode =
  | "quantity_tenfold" // 1,000 where the kitchen usually orders 100
  | "quantity_unusual" // far from the kitchen's own pattern, but not a clean factor of ten
  | "unit_confusion" // litres read as packs, or packs as litres
  | "unit_unclear" // a pack count with no way to tell how big a pack is, or a unit the product is not sold in
  | "duplicate_recent" // the same family for the same delivery, ordered in the last two days
  | "delivery_in_past"
  | "delivery_not_delivery_day"
  | "delivery_after_cutoff" // too late to order for that day
  | "contradicts_preference" // goes against a rule a person stated for this kitchen
  | "large_first_order" // a big order from a kitchen with no history
  | "nothing_to_repeat" // "same as last time" with no earlier order
  | "pack_uncertain" // the product the buyer named does not say for sure what one pack holds
  // From the kitchen's typed memory (profile.memory). Each cites the remembered items it rests on (memoryItemIds).
  | "declined_before" // a product, brand or pack the kitchen turned down before
  | "breaks_remembered_rule" // a product a person said never to order
  | "standing_order_range" // far outside a standing order's normal range
  | "delivery_unusual_day" // a weekday the kitchen does not receive on, by its own pattern
  | "unrelated_first_order" // a first order of a family unrelated to anything the kitchen buys
  // From the second reading (core/second-reading.ts): two independent models read the buyer's words differently.
  | "readings_differ";

export type Correction = { id: string; label: string; patch?: NeedPatch; cancel?: true };

export type Concern = {
  key: string; // code plus what it is about; a confirmation is recorded against this
  code: ConcernCode;
  severity: "error" | "warning";
  message: string;
  confirmable: boolean;
  corrections: Correction[];
  preferenceIds?: string[]; // for contradicts_preference: the stated preferences a confirmation suspends
  evidence?: Record<string, unknown>;
  /** The typed memory items the concern rests on: the facts its message cites. */
  memoryItemIds?: string[];
  /**
   * A plausibility warning that a person signing the order off would see anyway. The intake asks it only when
   * some option is within what the agent may spend alone; otherwise it goes to the approver with the order.
   */
  deferrable?: boolean;
};

export type CheckContext = {
  now: Date;
  profile: KitchenProfile;
  family: string;
  /** Master data of this family (local, no live call): used for pack sizes and a product the buyer named. */
  candidates: Product[];
  /** Stated preferences the buyer has set aside for this request ("just this once"). */
  suspendedPreferenceIds?: string[];
  /** Are two product families related (a knowledge map can tell)? Default: relatedFamilies below. */
  related?: (a: string, b: string) => boolean;
  /**
   * Orders of this kitchen still waiting for a person's sign-off. They are not in the history yet (it holds committed
   * orders only), but they are just as likely to be what a second request repeats.
   */
  pending?: PendingOrderSummary[];
  /** The site within the kitchen the request is for (a daycare unit of a school kitchen): amounts compare with its own orders. */
  site?: string;
};

/** An order waiting for sign-off, as the duplicate check needs it (the intake builds these from the repository). */
export type PendingOrderSummary = { orderId: string; placedAt: string; family: string; amount: number; unit: BaseUnit; neededBy?: string; deliveryDate: string };

/** True when the catalogue reports each product's own order cut-off (the partner's live API does): then that decides. */
export function hasProductCutoffs(ctx: CheckContext): boolean {
  return ctx.candidates.some((p) => p.source === "valio");
}

// ---------- thresholds ----------

/**
 * A clean factor-of-ten slip: 8x to 12.5x (or the inverse) of the usual amount. Typing one zero too many
 * gives exactly 10x; the 25 % band leaves room for the usual week-to-week variation. Checked with a single
 * previous order, because a 10x jump is suspicious even against one data point.
 */
export const TENFOLD_LOW = 8;
export const TENFOLD_HIGH = 12.5;
/**
 * Any other amount at least 3x above or below the usual: a kitchen's weekly milk rarely triples. Needs
 * QUANTITY_PATTERN_MIN_ORDERS orders, so one odd week does not set the pattern.
 */
export const UNUSUAL_RATIO = 3;
export const QUANTITY_PATTERN_MIN_ORDERS = 3;
/** "Close to the usual" for the unit check: within 25 %, the same band as the factor-of-ten check. */
export const UNIT_MATCH_TOLERANCE = 0.25;
/** Same family, same delivery, ordered within two days: typically the same need entered twice. */
export const DUPLICATE_WINDOW_HOURS = 48;
/**
 * A first order at or above these amounts gets a second look: roughly a week of use for a large
 * lunch kitchen (about 300 L of milk). Without history there is nothing else to compare with.
 */
export const LARGE_FIRST_ORDER: Record<BaseUnit, number> = { L: 300, kg: 150, pcs: 500 };

// ---------- quantity helpers ----------

/** The base unit this family is bought in: from the kitchen's history, else from the product data. */
export function familyUnit(ctx: CheckContext): BaseUnit | undefined {
  const last = lastOrder(ctx.profile, ctx.family)?.unit;
  if (last) return last;
  // The unit most products of the family are measured in; "pcs" only when nothing has a certain content.
  const counts = new Map<BaseUnit, number>();
  for (const p of ctx.candidates) counts.set(p.unit, (counts.get(p.unit) ?? 0) + (p.unit === "pcs" && p.packContent ? 0.1 : 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** The pack size a count of "packs" most likely refers to: the named product, the kitchen's usual pack, or the only one there is. */
export function referencePackSize(need: StructuredNeed, ctx: CheckContext): number | undefined {
  const named = need.item.productId && ctx.candidates.find((p) => p.id === need.item.productId);
  if (named) return named.packSize;
  const last = lastOrder(ctx.profile, ctx.family);
  if (last) return primaryLine(last).packSize;
  const sizes = [...new Set(ctx.candidates.map((p) => p.packSize))];
  return sizes.length === 1 ? sizes[0] : undefined;
}

/** Is this unit a count of packs for this family? "pcs" of milk means cartons or boxes, not litres. */
export function isPackCount(unit: NeedUnit, base: BaseUnit | undefined): boolean {
  return unit === "pack" || (unit === "pcs" && base !== undefined && base !== "pcs");
}

/** The need's amount in the family's base unit, or undefined if it cannot be known. */
export function baseAmount(need: StructuredNeed, ctx: CheckContext): { amount: number; unit: BaseUnit } | undefined {
  if (!need.quantity) return undefined;
  const unit = familyUnit(ctx);
  if (isPackCount(need.quantity.unit, unit)) {
    const pack = referencePackSize(need, ctx);
    return pack && unit ? { amount: need.quantity.amount * pack, unit } : undefined;
  }
  return { amount: need.quantity.amount, unit: need.quantity.unit as BaseUnit };
}

const near = (a: number, b: number) => Math.abs(a - b) <= b * UNIT_MATCH_TOLERANCE;

/**
 * A suggested amount in the unit the buyer used. A count of packs stays a count only when it is a whole number of
 * packs; otherwise it is said in litres or kilos ("the usual 1,105 L", never "the usual 110.5 packs").
 */
export function correctionAmount(baseUnits: number, pack: number | undefined, unit: NeedUnit, base: BaseUnit): { amount: number; unit: NeedUnit } {
  if (!pack) return { amount: round(baseUnits), unit: unit === "pack" ? base : unit };
  const packs = baseUnits / pack;
  return Math.abs(packs - Math.round(packs)) < 1e-6 && Math.round(packs) > 0 ? { amount: Math.round(packs), unit } : { amount: round(baseUnits), unit: base };
}
const round = (n: number) => Math.round(n * 100) / 100;

// ---------- the checks ----------

export function checkNeed(need: StructuredNeed, ctx: CheckContext): Concern[] {
  const concerns = [...checkDelivery(need, ctx), ...checkRepeat(need, ctx), ...checkQuantity(need, ctx), ...checkPack(need, ctx), ...checkDuplicate(need, ctx), ...checkPreferences(need, ctx)];
  concerns.push(...checkMemory(need, ctx, concerns));
  return concerns.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}

export function checkDelivery(need: StructuredNeed, ctx: CheckContext): Concern[] {
  const date = need.deliverBy;
  if (!date) return [];
  const days = ctx.profile.deliveryWeekdays;
  const today = localNow(ctx.now).date;
  const earliest = earliestDeliveryDay(ctx.now, days);
  const toDate = (d: string | undefined, label: string): Correction[] => (d ? [{ id: `deliver_${d}`, label: `${label}: ${formatDay(d)}`, patch: { deliverBy: d } }] : []);

  if (date < today) {
    return [
      {
        key: `delivery_in_past:${date}`,
        code: "delivery_in_past",
        severity: "error",
        message: `${formatDay(date)} is in the past (today is ${formatDay(today)}).`,
        confirmable: false,
        corrections: [...toDate(earliest, "Earliest possible delivery"), ...toDate(addDaysIso(date, 7), "Same weekday next week").filter((c) => c.patch!.deliverBy! >= (earliest ?? today))],
        evidence: { deliverBy: date, today },
      },
    ];
  }
  if (!days.includes(isoWeekday(date))) {
    const before = nextDeliveryDay(date, days, -1);
    const after = nextDeliveryDay(date, days, 1);
    // The kitchen receives only on its delivery days: the day chosen is the day delivered, never an earlier one it cannot take.
    const onDay = (d: string | undefined, label: string): Correction[] => toDate(d, label).map((c) => ({ ...c, patch: { ...c.patch, deliverOn: d } }));
    const corrections = [...(before && before >= (earliest ?? before) ? onDay(before, "The delivery day before") : []), ...onDay(after, "The next delivery day")];
    // When a person told the memory which days the kitchen receives, say so in their words.
    const told = activeMemory(ctx.profile, { now: ctx.now }).find((m) => m.fact.kind === "delivery_days" && m.strength === "rule" && m.derived?.deliveryWeekdaysBefore);
    return [
      {
        key: `delivery_not_delivery_day:${date}`,
        code: "delivery_not_delivery_day",
        severity: "error",
        message: `Deliveries to ${ctx.profile.name} come on ${days.map((d) => ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d]).join(", ")}; ${formatDay(date)} is not one of them.${told ? ` ${cite(told)}` : ""}`,
        confirmable: false,
        corrections,
        evidence: { deliverBy: date, deliveryWeekdays: days },
        ...(told ? { memoryItemIds: [told.id] } : {}),
      },
    ];
  }
  // The kitchen-level cut-off is a fallback for catalogues that do not report one. The partner's API states each
  // product's own cut-off (Sunday 17:00 for stock items, days earlier for supplier-shipped ones): Dock then
  // judges every option by its own and never blocks a request on a guess.
  if (!hasProductCutoffs(ctx) && !beforeCutoff(date, ctx.now)) {
    return [
      {
        key: `delivery_after_cutoff:${date}`,
        code: "delivery_after_cutoff",
        severity: "error",
        message: `Too late to order for ${formatDay(date)}: the cut-off was 12:00 the day before.`,
        confirmable: false,
        corrections: toDate(earliest, "Earliest possible delivery"),
        evidence: { deliverBy: date, earliest },
      },
    ];
  }
  return [];
}

function checkRepeat(need: StructuredNeed, ctx: CheckContext): Concern[] {
  if (!need.sameAsLastTime || lastOrder(ctx.profile, ctx.family)) return [];
  return [
    {
      key: `nothing_to_repeat:${ctx.family}`,
      code: "nothing_to_repeat",
      severity: "error",
      message: `There is no earlier ${ctx.family} order from ${ctx.profile.name} to repeat.`,
      confirmable: false,
      corrections: need.quantity ? [{ id: "show_options", label: "Show me the options instead", patch: { sameAsLastTime: false } }] : [],
    },
  ];
}

export function checkQuantity(need: StructuredNeed, ctx: CheckContext): Concern[] {
  const q = need.quantity;
  if (!q) return [];
  const unit = familyUnit(ctx);
  const asked = formatAmount(q.amount, q.unit);

  // A base unit the family is not sold in (kilos of milk).
  if (unit && q.unit !== "pack" && q.unit !== "pcs" && q.unit !== unit) {
    return [
      {
        key: `unit_unclear:${q.amount}:${q.unit}`,
        code: "unit_unclear",
        severity: "error",
        message: `${ctx.family} is sold by ${unit}, not by ${q.unit}. Did you mean ${formatAmount(q.amount, unit)}?`,
        confirmable: false,
        corrections: [{ id: `use_${q.amount}_${unit}`, label: `Make it ${formatAmount(q.amount, unit)}`, patch: { quantity: { amount: q.amount, unit } } }],
      },
    ];
  }

  const pack = referencePackSize(need, ctx);
  const packCount = isPackCount(q.unit, unit);
  if (packCount && (!pack || !unit)) {
    const sizes = [...new Set(ctx.candidates.map((p) => p.packSize))].sort((a, b) => a - b).slice(0, 3);
    const base = unit ?? "L";
    return [
      {
        key: `unit_unclear:${q.amount}:${q.unit}`,
        code: "unit_unclear",
        severity: "error",
        message: `${asked} of ${need.item.text}: packs come in ${sizes.map((s) => formatAmount(s, base)).join(", ") || "several sizes"}, so the amount is unclear.`,
        confirmable: false,
        corrections: [
          { id: `use_${q.amount}_${base}`, label: `${formatAmount(q.amount, base)} in total`, patch: { quantity: { amount: q.amount, unit: base } } },
          ...sizes.map((s) => ({ id: `use_${round(q.amount * s)}_${base}`, label: `${asked} of ${formatAmount(s, base)} = ${formatAmount(round(q.amount * s), base)}`, patch: { quantity: { amount: round(q.amount * s), unit: base } } })),
        ],
      },
    ];
  }

  const usual = usualAmount(ctx.profile, ctx.family, ctx.site);
  const base = baseAmount(need, ctx);
  if (!base) return [];
  if (!usual && ctx.site) {
    // A site's first order: never "too small" against the whole kitchen; only an amount above the kitchen's own
    // usual is worth a word.
    const kitchen = usualAmount(ctx.profile, ctx.family);
    return kitchen && kitchen.unit === base.unit && base.amount <= kitchen.amount * TENFOLD_LOW ? [] : largeFirstOrder(need, ctx, base);
  }
  if (!usual) return largeFirstOrder(need, ctx, base);
  if (usual.unit !== base.unit) return [];
  const usualText = formatAmount(usual.amount, usual.unit);
  const evidence = { usualAmount: usual.amount, unit: usual.unit, basedOnOrders: usual.orders, asked: q };

  // Litres and packs mixed up: the other reading matches the kitchen's usual amount.
  if (pack && unit && pack !== 1) {
    if (packCount && !near(base.amount, usual.amount) && near(q.amount, usual.amount)) {
      return [
        {
          key: `unit_confusion:${q.amount}:${q.unit}`,
          code: "unit_confusion",
          severity: "warning",
          message: `${asked} of ${formatAmount(pack, unit)} is ${formatAmount(base.amount, unit)}; you usually order about ${usualText}. Did you mean ${formatAmount(q.amount, unit)}?`,
          confirmable: true,
          corrections: [{ id: `use_${q.amount}_${unit}`, label: `Make it ${formatAmount(q.amount, unit)}`, patch: { quantity: { amount: q.amount, unit } } }],
          evidence: { ...evidence, packSize: pack },
        },
      ];
    }
    if (!packCount && !near(q.amount, usual.amount) && near(q.amount * pack, usual.amount)) {
      return [
        {
          key: `unit_confusion:${q.amount}:${q.unit}`,
          code: "unit_confusion",
          severity: "warning",
          message: `${asked} is what you usually order in packs: ${formatAmount(q.amount, "pack")} of ${formatAmount(pack, unit)} = ${formatAmount(q.amount * pack, unit)}. Did you mean ${formatAmount(q.amount, "pack")}?`,
          confirmable: true,
          corrections: [{ id: `use_${q.amount}_pack`, label: `Make it ${formatAmount(q.amount, "pack")} (${formatAmount(q.amount * pack, unit)})`, patch: { quantity: { amount: q.amount, unit: "pack" } } }],
          evidence: { ...evidence, packSize: pack },
        },
      ];
    }
  }

  const ratio = base.amount / usual.amount;
  const inUnit = (amount: number) => correctionAmount(amount, packCount ? pack : undefined, q.unit, base.unit);
  if (ratio >= TENFOLD_LOW && ratio <= TENFOLD_HIGH) {
    const fix = inUnit(base.amount / 10);
    return [tenfold(q, fix, `${formatAmount(base.amount, base.unit)} where you usually order about ${usualText}: did you mean ${formatAmount(fix.amount, fix.unit)}?`, evidence)];
  }
  if (ratio <= 1 / TENFOLD_LOW && ratio >= 1 / TENFOLD_HIGH) {
    const fix = inUnit(base.amount * 10);
    return [tenfold(q, fix, `${formatAmount(base.amount, base.unit)} where you usually order about ${usualText}: did you mean ${formatAmount(fix.amount, fix.unit)}?`, evidence)];
  }
  // An amount far from the kitchen's pattern but not a likely slip is not asked: noticeNeed says it on the card.
  return [];
}

// ---------- noticing without asking ----------

/**
 * Things worth a line on the "understood" card that do not stop the order: the buyer said the amount in words, it is
 * not a likely slip (those are asked, above), and a question would cost more than it saves. The person signing an
 * order off sees them too. Two kinds:
 *   amount_above_usual / amount_below_usual   clearly outside the kitchen's own range (NOTE_HIGH x or 1/NOTE_LOW of
 *                                             its usual, from at least QUANTITY_PATTERN_MIN_ORDERS orders)
 *   standing_order_drift                      the kitchen's recurring order has crept up over its recent weeks
 *                                             (the newer half of its last orders DRIFT_RATIO above the older half),
 *                                             said when it is about to be ordered again
 */
export type NoticedCode = "amount_above_usual" | "amount_below_usual" | "standing_order_drift";
export type Noticed = { code: NoticedCode; message: string; params: Record<string, string | number> };

export const NOTE_HIGH = 1.5;
export const NOTE_LOW = 2;
export const DRIFT_RATIO = 1.2;
export const DRIFT_MIN_ORDERS = 4;

export function noticeNeed(need: StructuredNeed, ctx: CheckContext): Noticed[] {
  return [...noticeQuantity(need, ctx), ...noticeDrift(need, ctx)];
}

/** The amount is UNUSUAL_RATIO or more away from the kitchen's usual (what used to be asked as quantity_unusual). */
export function farFromUsual(need: StructuredNeed, ctx: CheckContext): boolean {
  const n = noticeQuantity(need, ctx)[0];
  const r = n ? Number(n.params.ratio) : 1;
  return !!n && (r >= UNUSUAL_RATIO || r <= 1 / UNUSUAL_RATIO);
}

export function noticeQuantity(need: StructuredNeed, ctx: CheckContext): Noticed[] {
  const base = baseAmount(need, ctx);
  const usual = usualAmount(ctx.profile, ctx.family, ctx.site);
  if (!base || !usual || usual.unit !== base.unit || usual.orders < QUANTITY_PATTERN_MIN_ORDERS) return [];
  const ratio = base.amount / usual.amount;
  // A likely slip is asked instead (checkQuantity), never also noted.
  if ((ratio >= TENFOLD_LOW && ratio <= TENFOLD_HIGH) || (ratio <= 1 / TENFOLD_LOW && ratio >= 1 / TENFOLD_HIGH)) return [];
  const params = { ratio: round(ratio), usual: usual.amount, unit: usual.unit, asked: base.amount, orders: usual.orders };
  if (ratio >= NOTE_HIGH) return [{ code: "amount_above_usual", params, message: `${formatAmount(base.amount, base.unit)} is ${round(ratio)} times your usual ${formatAmount(usual.amount, usual.unit)} (median of your last ${usual.orders} ${ctx.family} orders).` }];
  if (ratio <= 1 / NOTE_LOW) return [{ code: "amount_below_usual", params, message: `${formatAmount(base.amount, base.unit)} is ${round(ratio * 100)} % of your usual ${formatAmount(usual.amount, usual.unit)} (median of your last ${usual.orders} ${ctx.family} orders).` }];
  return [];
}

export function noticeDrift(need: StructuredNeed, ctx: CheckContext): Noticed[] {
  const base = baseAmount(need, ctx);
  if (!base) return [];
  const recent = ctx.profile.history.filter((h) => h.family === ctx.family && h.unit === base.unit && (ctx.site ? h.site === ctx.site : !h.site)).sort((a, b) => a.placedAt.localeCompare(b.placedAt)).slice(-6);
  if (recent.length < DRIFT_MIN_ORDERS) return [];
  const half = Math.floor(recent.length / 2);
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];
  const older = median(recent.slice(0, half).map((h) => h.amount));
  const newer = median(recent.slice(-half).map((h) => h.amount));
  const last = recent.at(-1)!.amount;
  // Crept up: the newer orders sit clearly above the older ones, and this order keeps (or raises) the newer level.
  if (newer < older * DRIFT_RATIO || base.amount < newer || last < older * DRIFT_RATIO) return [];
  const weeks = Math.max(1, Math.round((Date.parse(recent.at(-1)!.placedAt) - Date.parse(recent[0].placedAt)) / (7 * 86_400_000)));
  return [
    {
      code: "standing_order_drift",
      params: { from: older, to: base.amount, unit: base.unit, weeks, orders: recent.length },
      message: `Your ${ctx.family} order has crept up from about ${formatAmount(older, base.unit)} to ${formatAmount(base.amount, base.unit)} over ${weeks} week${weeks === 1 ? "" : "s"}.`,
    },
  ];
}

function tenfold(q: NonNullable<StructuredNeed["quantity"]>, fix: { amount: number; unit: NeedUnit }, message: string, evidence: Record<string, unknown>): Concern {
  return {
    key: `quantity_tenfold:${q.amount}:${q.unit}`,
    code: "quantity_tenfold",
    severity: "warning",
    message,
    confirmable: true,
    corrections: [{ id: `use_${fix.amount}_${fix.unit}`, label: `Make it ${formatAmount(fix.amount, fix.unit)}`, patch: { quantity: fix } }],
    evidence,
  };
}

function largeFirstOrder(need: StructuredNeed, ctx: CheckContext, base: { amount: number; unit: BaseUnit }): Concern[] {
  if (ctx.profile.history.length > 0 || base.amount < LARGE_FIRST_ORDER[base.unit]) return [];
  return [
    {
      key: `large_first_order:${need.quantity!.amount}:${need.quantity!.unit}`,
      code: "large_first_order",
      severity: "warning",
      message: `This is the first order from ${ctx.profile.name}, and ${formatAmount(base.amount, base.unit)} is a large one. Please check the amount.`,
      confirmable: true,
      deferrable: true,
      corrections: [{ id: "cancel", label: "Cancel and enter the amount again", cancel: true }],
      evidence: { threshold: LARGE_FIRST_ORDER[base.unit], unit: base.unit },
    },
  ];
}

/**
 * The buyer named a product whose pack content is not certain (the name and the packaging data disagree, or say
 * nothing): Dock will not guess how many packs make the amount. It shows its estimate and asks once; the
 * confirmation lets the options use it.
 */
export function checkPack(need: StructuredNeed, ctx: CheckContext): Concern[] {
  const q = need.quantity;
  const named = need.item.productId ? ctx.candidates.find((p) => p.id === need.item.productId) : undefined;
  if (!q || !named?.packContent || named.packContent.certain || (q.unit !== "L" && q.unit !== "kg")) return [];
  const conv = packsFor(named, { amount: q.amount, unit: q.unit });
  if (conv.ok) return [];
  const estimate = conv.estimate;
  return [
    {
      key: `pack_uncertain:${named.id}:${q.amount}:${q.unit}`,
      code: "pack_uncertain",
      severity: "warning",
      message: estimate
        ? `${named.name}: what one ${named.salesUnit ?? "pack"} holds is not certain (${named.packContent.label}). AimoPilot's estimate is ${estimate.salesUnits} ${named.salesUnit ?? "packs"} = ${formatAmount(estimate.delivered.amount, estimate.delivered.unit)}. Use the estimate?`
        : `${named.name}: what one ${named.salesUnit ?? "pack"} holds is not known (${named.packContent.label}), so ${formatAmount(q.amount, q.unit)} cannot be turned into packs.`,
      confirmable: !!estimate,
      corrections: [{ id: "choose_other", label: "Show products with a known pack size instead", patch: { item: { productId: null } } }],
      evidence: { productId: named.id, label: named.packContent.label, issues: named.packContent.issues, estimate },
    },
  ];
}

/** "a moment ago", "12 minutes ago", "3 hours ago" (QA: "ordered 1 hour ago" was said for an order 3 minutes old). */
export function agoText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "a moment ago";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

export function checkDuplicate(need: StructuredNeed, ctx: CheckContext): Concern[] {
  const since = ctx.now.getTime() - DUPLICATE_WINDOW_HOURS * 3600_000;
  const today = localNow(ctx.now).date;
  const matches = (h: { placedAt: string; neededBy?: string; deliveryDate: string }) => {
    if (Date.parse(h.placedAt) < since) return false;
    const forDay = h.neededBy ?? h.deliveryDate;
    return need.deliverBy ? forDay === need.deliverBy : h.deliveryDate >= today;
  };
  // A waiting order first: it is the likelier repeat (the buyer may think the first one did not go through).
  const waiting = (ctx.pending ?? []).filter((o) => o.family === ctx.family).sort((a, b) => b.placedAt.localeCompare(a.placedAt)).find(matches);
  const dup = waiting ?? familyHistory(ctx.profile, ctx.family).reverse().find(matches);
  if (!dup) return [];
  const ago = agoText(ctx.now.getTime() - Date.parse(dup.placedAt));
  const message = waiting
    ? `You already asked for ${formatAmount(dup.amount, dup.unit)} of ${dup.family} ${ago} for ${formatDay(dup.neededBy ?? dup.deliveryDate)} (order ${dup.orderId}), and that order is still waiting for sign-off. Order again?`
    : `You already ordered ${formatAmount(dup.amount, dup.unit)} of ${dup.family} ${ago} for ${formatDay(dup.neededBy ?? dup.deliveryDate)} (order ${dup.orderId}). Order again?`;
  return [
    {
      key: `duplicate_recent:${dup.orderId}`,
      code: "duplicate_recent",
      severity: "warning",
      message,
      confirmable: true,
      corrections: [{ id: "cancel", label: waiting ? "Cancel: the order waiting for sign-off covers it" : "Cancel: the earlier order covers it", cancel: true }],
      evidence: { orderId: dup.orderId, placedAt: dup.placedAt, ...(waiting ? { status: "pending_approval" } : {}) },
    },
  ];
}

export function checkPreferences(need: StructuredNeed, ctx: CheckContext): Concern[] {
  const named = need.item.productId ? ctx.candidates.find((p) => p.id === need.item.productId) : undefined;
  const out: Concern[] = [];
  for (const pref of statedFor(ctx.profile, ctx.family)) {
    if (ctx.suspendedPreferenceIds?.includes(pref.id)) continue;
    const conflict = contradiction(pref, need, named);
    if (!conflict) continue;
    out.push({
      key: `contradicts_preference:${pref.id}`,
      code: "contradicts_preference",
      severity: "warning",
      message: `${conflict.what} Your kitchen's standing rule, set by ${pref.statedBy} on ${formatDay(localDateOf(pref.statedAt))}: "${pref.text}".`,
      confirmable: true,
      corrections: [{ id: `keep_${pref.id}`, label: conflict.fixLabel, patch: conflict.patch }],
      preferenceIds: [pref.id],
      ...(memoryItemIdOf(pref.id) ? { memoryItemIds: [memoryItemIdOf(pref.id)!] } : {}),
    });
  }
  return out;
}

function contradiction(pref: StatedPreference, need: StructuredNeed, named: Product | undefined): { what: string; fixLabel: string; patch: NeedPatch } | undefined {
  const dropNamed = named ? { productId: null } : {};
  if (pref.kind === "require_claim") {
    const excluded = need.item.excludedAttributes.includes(pref.claim);
    const lacking = named && !named.attributes.includes(pref.claim);
    if (!excluded && !lacking) return undefined;
    return {
      what: lacking ? `${named!.name} is not ${pref.claim.replaceAll("_", "-")}.` : `This asks for ${need.item.text} that is not ${pref.claim.replaceAll("_", "-")}.`,
      fixLabel: `Keep it ${pref.claim.replaceAll("_", "-")}, as always`,
      patch: { item: { ...dropNamed, excludedAttributes: need.item.excludedAttributes.filter((a) => a !== pref.claim) } },
    };
  }
  if (pref.kind === "forbid_allergen") {
    if (!named?.allergens.includes(pref.allergen)) return undefined;
    return { what: `${named.name} contains ${pref.allergen}.`, fixLabel: `Choose a product without ${pref.allergen}`, patch: { item: { productId: null } } };
  }
  if (pref.kind === "dimension") {
    const dim = SPEC_DIMENSIONS.find((d) => d.id === pref.dimension);
    if (!dim || pref.choice === "no_preference") return undefined;
    const valueAttrs = dim.values.map((v) => v.attribute);
    const askedValue = named ? dimensionValue(dim, named.attributes) : need.item.attributes.find((a) => valueAttrs.includes(a)) ?? (pref.choice !== NONE && need.item.excludedAttributes.includes(pref.choice) ? NONE : undefined);
    if (askedValue === undefined || askedValue === pref.choice) return undefined;
    const attributes = need.item.attributes.filter((a) => !valueAttrs.includes(a)).concat(pref.choice === NONE ? [] : [pref.choice]);
    return {
      what: `This asks for ${dimensionLabel(dim, askedValue).toLowerCase()}.`,
      fixLabel: `Keep it ${dimensionLabel(dim, pref.choice).toLowerCase()}, as always`,
      patch: { item: { ...dropNamed, attributes, excludedAttributes: need.item.excludedAttributes.filter((a) => a !== pref.choice) } },
    };
  }
  return undefined;
}

// ---------- checks from the kitchen's typed memory ----------

/**
 * Thresholds for the memory checks. Every one of these stops the buyer for a tap, so each is set where a wrong
 * order would cost more than the tap (the partner scores "least manual correction"):
 *
 * STANDING_HIGH / STANDING_LOW  a standing order's range is the min..max of the orders that formed it, so it
 *   already holds the kitchen's normal week-to-week swing. 1.5x above its maximum is at least half a week of
 *   extra perishable stock (milk keeps 7 to 10 days), which spoils before the next delivery; below 1/1.5 of its
 *   minimum the kitchen runs out before the next one. Inside that band a bigger or smaller week is ordinary.
 *   Tighter than UNUSUAL_RATIO (3x the median), because a standing order is a pattern the kitchen repeats on
 *   purpose; looser than that and it would ask about every catering week.
 * UNRELATED_MIN_ORDERS  "unrelated to anything it buys" needs a buying pattern: five orders. A new kitchen's
 *   second family is not an anomaly.
 * UNRELATED_MIN_SHARE  a first order of a new family is raised only from a tenth of LARGE_FIRST_ORDER (30 L,
 *   15 kg, 50 pcs): below that a mistaken family costs a few euros, less than the buyer's time.
 * A declined product is raised whenever the buyer names it: a person turned it down in words, and naming it
 * again is either a change of mind (one tap) or a slip that the kitchen said it did not want.
 * An unusual delivery day is raised only when a PERSON said which days the kitchen receives (in words, or as a
 * rule): goods arriving at a closed kitchen are refused or spoil. Days merely read from order history (Mondays and
 * Thursdays so far) are not raised: a kitchen that has not had a Friday delivery yet may still receive one.
 */
export const STANDING_HIGH = 1.5;
export const STANDING_LOW = 1 / 1.5;
export const UNRELATED_MIN_ORDERS = 5;
export const UNRELATED_MIN_SHARE = 0.1;

const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const daysText = (ds: number[]) => ds.map((d) => DAY[d]).join(", ");

/** One line saying what was remembered, by whom, when, and in which words. Every memory concern ends with it. */
export function cite(m: MemoryItem): string {
  const s = [...m.sources].reverse().find((x) => x.quote) ?? m.sources.at(-1);
  const who = m.origin === "learned" ? "learned from your orders" : m.confirmedBy ? `confirmed by ${m.confirmedBy.by}` : s?.by ? `said by ${s.by}` : "remembered";
  const when = s ? ` on ${formatDay(localDateOf(s.at))}` : "";
  return `Remembered: ${m.text} (${who}${when}${s?.quote ? `: "${s.quote}"` : ""}).`;
}

/** Related product families: the same group below, a shared word, or the same two-digit product-group code. */
const FAMILY_GROUPS: string[][] = [
  ["milk", "cream", "yoghurt", "plant_drink", "cheese", "butter", "quark", "sour_milk", "ice_cream", "dairy", "eggs", "dessert"],
  ["meat", "poultry", "fish", "seafood", "sausage", "cold_cuts"],
  ["vegetables", "fruit", "berries", "potatoes", "salad", "herbs", "mushrooms", "frozen_vegetables"],
  ["bread", "bakery", "flour", "grain", "cereal", "muesli", "pasta", "rice", "porridge", "oats"],
  ["beverage", "juice", "coffee", "tea", "water", "soft_drinks"],
];
export function relatedFamilies(a: string, b: string): boolean {
  if (a === b) return true;
  if (/^\d{4,}$/.test(a) && /^\d{4,}$/.test(b)) return a.slice(0, 2) === b.slice(0, 2);
  const words = (x: string) => new Set(x.split(/[_\s-]+/).filter((w) => w.length > 2));
  const wa = words(a);
  if ([...words(b)].some((w) => wa.has(w))) return true;
  return FAMILY_GROUPS.some((g) => g.includes(a) && g.includes(b));
}

/** The memory checks. `already`: concerns the other checks raised, so the same slip is not asked twice. */
export function checkMemory(need: StructuredNeed, ctx: CheckContext, already: Concern[] = []): Concern[] {
  const out = [...checkDeclined(need, ctx)];
  // An amount far outside the pattern (noted, not asked) also counts: the standing-order check would only repeat it.
  const quantityRaised = already.some((c) => c.code.startsWith("quantity_") || c.code.startsWith("unit_") || c.code === "large_first_order") || farFromUsual(need, ctx);
  if (!quantityRaised) out.push(...checkStanding(need, ctx));
  if (!already.some((c) => c.code.startsWith("delivery_"))) out.push(...checkReceivingDay(need, ctx));
  out.push(...checkUnrelated(need, ctx));
  return out;
}

const heavy = (m: MemoryItem) => m.strength === "rule" || m.weight >= 0.5;

export function checkDeclined(need: StructuredNeed, ctx: CheckContext): Concern[] {
  const named = need.item.productId ? ctx.candidates.find((p) => p.id === need.item.productId) : undefined;
  if (!named) return [];
  const mem = activeMemory(ctx.profile, { family: ctx.family, now: ctx.now });
  const hits = mem.filter((m) => {
    const f = m.fact;
    if (f.kind === "substitute") return !f.accepted && f.productId === named.id; // a person said no, in words: enough
    if (!heavy(m)) return false;
    if (f.kind === "product") return f.stance === "avoid" && f.productId === named.id;
    if (f.kind === "brand") return f.stance === "avoid" && !!named.brand && f.brand.toLowerCase() === named.brand.toLowerCase();
    if (f.kind === "pack") return f.stance === "avoid" && f.unit === named.unit && Math.abs(f.packSize - named.packSize) < 1e-6;
    return false;
  });
  if (!hits.length) return [];
  const rule = hits.some((m) => m.strength === "rule");
  const code: ConcernCode = rule ? "breaks_remembered_rule" : "declined_before";
  const why = (m: MemoryItem) => {
    const f = m.fact;
    if (f.kind !== "substitute") return cite(m);
    const s = m.sources.at(-1);
    return `${s?.by ?? "Your kitchen"} turned it down as a substitute${f.forName ? ` for ${f.forName}` : ""}${s ? ` on ${formatDay(localDateOf(s.at))}` : ""}${f.reason ? `: "${f.reason}"` : ""}.`;
  };
  const usual = mem.find((m) => m.fact.kind === "product" && m.fact.stance === "prefer" && m.fact.productId !== named.id && ctx.candidates.some((p) => p.id === (m.fact as { productId: string }).productId));
  const corrections: Correction[] = [];
  if (usual && usual.fact.kind === "product") corrections.push({ id: `use_${usual.fact.productId}`, label: `Order your usual ${usual.fact.name} instead`, patch: { item: { productId: usual.fact.productId } } });
  corrections.push({ id: "choose_other", label: "Show me other products", patch: { item: { productId: null } } });
  return [
    {
      key: `${code}:${named.id}`,
      code,
      severity: "warning",
      message: `${named.name}: ${hits.map(why).join(" ")} Order it anyway?`,
      confirmable: true,
      corrections,
      memoryItemIds: hits.map((m) => m.id),
      evidence: { productId: named.id },
    },
  ];
}

export function checkStanding(need: StructuredNeed, ctx: CheckContext): Concern[] {
  const q = need.quantity;
  const base = baseAmount(need, ctx);
  if (!q || !base) return [];
  const day = need.deliverBy ? isoWeekday(need.deliverBy) : undefined;
  const so = activeMemory(ctx.profile, { family: ctx.family, now: ctx.now }).find(
    (m) => m.family === ctx.family && m.fact.kind === "standing_order" && m.fact.unit === base.unit && heavy(m) && (day === undefined || m.fact.weekdays.includes(day)),
  );
  if (!so || so.fact.kind !== "standing_order") return [];
  const f = so.fact;
  if (base.amount <= f.high * STANDING_HIGH && base.amount >= f.low * STANDING_LOW) return [];
  const pack = referencePackSize(need, ctx);
  const packCount = isPackCount(q.unit, familyUnit(ctx));
  const fix = correctionAmount(f.amount, packCount ? pack : undefined, q.unit, base.unit);
  const how = base.amount > f.high ? `${round(base.amount / f.high)}x the most` : `under ${Math.round((base.amount / f.low) * 100)} % of the least`;
  return [
    {
      key: `standing_order_range:${q.amount}:${q.unit}`,
      code: "standing_order_range",
      severity: "warning",
      message: `${formatAmount(base.amount, base.unit)}${need.deliverBy ? ` for ${formatDay(need.deliverBy)}` : ""} is ${how} your standing ${daysText(f.weekdays)} ${ctx.family} order takes (normally ${formatAmount(f.low, f.unit)} to ${formatAmount(f.high, f.unit)}). ${cite(so)} Did you mean the usual ${formatAmount(fix.amount, fix.unit)}?`,
      confirmable: true,
      deferrable: true,
      corrections: [{ id: `use_${fix.amount}_${fix.unit}`, label: `Make it the usual ${formatAmount(fix.amount, fix.unit)}`, patch: { quantity: fix } }],
      memoryItemIds: [so.id],
      evidence: { low: f.low, high: f.high, usual: f.amount, asked: base.amount },
    },
  ];
}

export function checkReceivingDay(need: StructuredNeed, ctx: CheckContext): Concern[] {
  const date = need.deliverBy;
  if (!date) return [];
  const wd = isoWeekday(date);
  const m = activeMemory(ctx.profile, { now: ctx.now }).find((x) => x.fact.kind === "delivery_days" && x.origin !== "learned" && heavy(x) && x.strength !== "one_off" && !x.fact.weekdays.includes(wd) && ctx.profile.deliveryWeekdays.includes(wd));
  if (!m || m.fact.kind !== "delivery_days") return [];
  const earliest = earliestDeliveryDay(ctx.now, ctx.profile.deliveryWeekdays);
  const days = m.fact.weekdays;
  const options = [nextDeliveryDay(date, days, -1), nextDeliveryDay(date, days, 1)].filter((d): d is string => !!d && (!earliest || d >= earliest));
  return [
    {
      key: `delivery_unusual_day:${date}`,
      code: "delivery_unusual_day",
      severity: "warning",
      message: `${ctx.profile.name} receives deliveries on ${daysText(days)}; ${formatDay(date)} is not one of them. ${cite(m)}`,
      confirmable: true,
      corrections: options.map((d) => ({ id: `deliver_${d}`, label: `Deliver ${formatDay(d)} instead`, patch: { deliverBy: d } })),
      memoryItemIds: [m.id],
      evidence: { deliverBy: date, receivingDays: days },
    },
  ];
}

export function checkUnrelated(need: StructuredNeed, ctx: CheckContext): Concern[] {
  const h = ctx.profile.history;
  if (h.length < UNRELATED_MIN_ORDERS) return [];
  const families = [...new Set(h.map((x) => x.family))].sort();
  const related = ctx.related ?? relatedFamilies;
  if (families.some((f) => related(f, ctx.family))) return [];
  if ((ctx.profile.memory?.items ?? []).some((m) => m.family === ctx.family && m.status === "active")) return []; // the kitchen told us about it
  const base = baseAmount(need, ctx);
  if (base && base.amount < LARGE_FIRST_ORDER[base.unit] * UNRELATED_MIN_SHARE) return [];
  return [
    {
      key: `unrelated_first_order:${ctx.family}`,
      code: "unrelated_first_order",
      severity: "warning",
      message: `${ctx.profile.name} has never ordered ${ctx.family}: its last ${h.length} orders were all ${families.join(", ")}. Is ${ctx.family} what you meant?`,
      confirmable: true,
      corrections: [{ id: "cancel", label: "Cancel and say it again", cancel: true }],
      evidence: { families, orders: h.length },
    },
  ];
}
