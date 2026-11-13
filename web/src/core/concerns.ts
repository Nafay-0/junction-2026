import type { Product } from "./catalog";
import { packsFor } from "./catalog/product";
import {
  addDaysIso,
  beforeCutoff,
  earliestDeliveryDay,
  familyHistory,
  formatDay,
  isoWeekday,
  lastOrder,
  localNow,
  nextDeliveryDay,
  primaryLine,
  statedFor,
  usualAmount,
  type KitchenProfile,
  type StatedPreference,
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
  | "pack_uncertain"; // the product the buyer named does not say for sure what one pack holds

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
};

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
const round = (n: number) => Math.round(n * 100) / 100;

// ---------- the checks ----------

export function checkNeed(need: StructuredNeed, ctx: CheckContext): Concern[] {
  const concerns = [...checkDelivery(need, ctx), ...checkRepeat(need, ctx), ...checkQuantity(need, ctx), ...checkPack(need, ctx), ...checkDuplicate(need, ctx), ...checkPreferences(need, ctx)];
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
    const corrections = [...(before && before >= (earliest ?? before) ? toDate(before, "The delivery day before") : []), ...toDate(after, "The next delivery day")];
    return [
      {
        key: `delivery_not_delivery_day:${date}`,
        code: "delivery_not_delivery_day",
        severity: "error",
        message: `Deliveries to ${ctx.profile.name} come on ${days.map((d) => ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d]).join(", ")}; ${formatDay(date)} is not one of them.`,
        confirmable: false,
        corrections,
        evidence: { deliverBy: date, deliveryWeekdays: days },
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

  const usual = usualAmount(ctx.profile, ctx.family);
  const base = baseAmount(need, ctx);
  if (!base) return [];
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
  const inUnit = (amount: number) => (packCount && pack ? { amount: round(amount / pack), unit: q.unit } : { amount: round(amount), unit: q.unit });
  if (ratio >= TENFOLD_LOW && ratio <= TENFOLD_HIGH) {
    const fix = inUnit(base.amount / 10);
    return [tenfold(q, fix, `${formatAmount(base.amount, base.unit)} where you usually order about ${usualText}: did you mean ${formatAmount(fix.amount, fix.unit)}?`, evidence)];
  }
  if (ratio <= 1 / TENFOLD_LOW && ratio >= 1 / TENFOLD_HIGH) {
    const fix = inUnit(base.amount * 10);
    return [tenfold(q, fix, `${formatAmount(base.amount, base.unit)} where you usually order about ${usualText}: did you mean ${formatAmount(fix.amount, fix.unit)}?`, evidence)];
  }
  if (usual.orders >= QUANTITY_PATTERN_MIN_ORDERS && (ratio >= UNUSUAL_RATIO || ratio <= 1 / UNUSUAL_RATIO)) {
    const fix = inUnit(usual.amount);
    const how = ratio > 1 ? `${round(ratio)}x` : `1/${round(1 / ratio)} of`;
    return [
      {
        key: `quantity_unusual:${q.amount}:${q.unit}`,
        code: "quantity_unusual",
        severity: "warning",
        message: `${formatAmount(base.amount, base.unit)} is ${how} your usual ${usualText} (median of your last ${usual.orders} ${ctx.family} orders).`,
        confirmable: true,
        deferrable: true,
        corrections: [{ id: `use_${fix.amount}_${fix.unit}`, label: `Make it the usual ${formatAmount(fix.amount, fix.unit)}`, patch: { quantity: fix } }],
        evidence: { ...evidence, ratio: round(ratio) },
      },
    ];
  }
  return [];
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
        ? `${named.name}: what one ${named.salesUnit ?? "pack"} holds is not certain (${named.packContent.label}). Dock's estimate is ${estimate.salesUnits} ${named.salesUnit ?? "packs"} = ${formatAmount(estimate.delivered.amount, estimate.delivered.unit)}. Use the estimate?`
        : `${named.name}: what one ${named.salesUnit ?? "pack"} holds is not known (${named.packContent.label}), so ${formatAmount(q.amount, q.unit)} cannot be turned into packs.`,
      confirmable: !!estimate,
      corrections: [{ id: "choose_other", label: "Show products with a known pack size instead", patch: { item: { productId: null } } }],
      evidence: { productId: named.id, label: named.packContent.label, issues: named.packContent.issues, estimate },
    },
  ];
}

export function checkDuplicate(need: StructuredNeed, ctx: CheckContext): Concern[] {
  const since = ctx.now.getTime() - DUPLICATE_WINDOW_HOURS * 3600_000;
  const today = localNow(ctx.now).date;
  const dup = familyHistory(ctx.profile, ctx.family)
    .reverse()
    .find((h) => {
      if (Date.parse(h.placedAt) < since) return false;
      const forDay = h.neededBy ?? h.deliveryDate;
      return need.deliverBy ? forDay === need.deliverBy : h.deliveryDate >= today;
    });
  if (!dup) return [];
  const hours = Math.max(1, Math.round((ctx.now.getTime() - Date.parse(dup.placedAt)) / 3600_000));
  return [
    {
      key: `duplicate_recent:${dup.orderId}`,
      code: "duplicate_recent",
      severity: "warning",
      message: `You already ordered ${formatAmount(dup.amount, dup.unit)} of ${dup.family} ${hours} hour${hours === 1 ? "" : "s"} ago for ${formatDay(dup.neededBy ?? dup.deliveryDate)} (order ${dup.orderId}). Order again?`,
      confirmable: true,
      corrections: [{ id: "cancel", label: "Cancel: the earlier order covers it", cancel: true }],
      evidence: { orderId: dup.orderId, placedAt: dup.placedAt },
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
      message: `${conflict.what} Your kitchen's standing rule, set by ${pref.statedBy} on ${formatDay(pref.statedAt.slice(0, 10))}: "${pref.text}".`,
      confirmable: true,
      corrections: [{ id: `keep_${pref.id}`, label: conflict.fixLabel, patch: conflict.patch }],
      preferenceIds: [pref.id],
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
