/**
 * Pack content and unit conversion.
 *
 * A buyer asks in litres or kilograms ("1,000 litres"); the wholesaler sells in sales units such as KI (case)
 * or ST (piece). This module works out how much one sales unit holds, from the packaging hierarchy, the GS1
 * measurements and the product name, and converts between the two. It never guesses silently: when the
 * sources disagree or are missing, the result says so and the caller must ask a human.
 *
 * Pure functions, no I/O. This is the place where an agent would add a zero, so it is tested hard.
 */

export type Measure = "L" | "kg";
export type Amount = { amount: number; unit: Measure };
export type Contents = Partial<Record<Measure, number>>;

/** A measured value as GS1 Synkka ships it: `{ value, unit }` with units such as LTR, MLT, GRM, KGM, H87 (pieces). */
export type GsValue = { value?: number | null; unit?: string | null } | null | undefined;
export type GsLevel = { volume?: GsValue; netWeight?: GsValue };

/** What the content derivation needs from one product record. */
export type PackFacts = {
  salesUnit: string;
  baseUnit: string;
  /** Packaging hierarchy: how many base units each unit holds. */
  units: { unitId: string; sizeInBaseUnits: number }[];
  /** Product names, most trusted first (en, fi, sv). */
  names: string[];
  /** GS1 BASE_UNIT_OR_EACH level (the consumer unit). */
  each?: GsLevel;
  /** GS1 CASE level. */
  case?: GsLevel;
  /** Sold by variable weight: the content of one piece is only approximate. */
  variableWeight?: boolean;
};

export type PackIssue =
  | "no_content_data" // nothing says how much a unit holds
  | "sources_disagree" // name and packaging data give different contents
  | "names_disagree" // the en / fi / sv names state different sizes
  | "approximate" // "ca. 5 kg", "about", variable weight sold per piece
  | "name_ambiguous" // several sizes in the name that do not reconcile
  | "count_mismatch" // the name says "12 x" but no unit holds 12
  | "case_content_unclear" // the base unit is a case and nothing says how many items it holds
  | "sales_unit_not_in_hierarchy"; // the sales unit is not in the packaging hierarchy

export type PackContent = {
  salesUnit: string;
  baseUnit: string;
  /** How many base units one sales unit holds (1 when they are the same), or null if unknown. */
  baseUnitsPerSalesUnit: number | null;
  /** Best estimate of the content of one base unit. Only trust it when `certain` is true. */
  perBaseUnit: Contents;
  /** Best estimate of the content of one sales unit. Only trust it when `certain` is true. */
  perSalesUnit: Contents;
  /** The measure the product is naturally sold by (litres for milk, kilograms for flour), or null. */
  primary: Measure | null;
  /** True only if the primary measure per sales unit is backed by data and nothing contradicts it. */
  certain: boolean;
  /** Measures that can be trusted for conversion. Usually just the primary one; sometimes both. */
  certainMeasures: Measure[];
  issues: PackIssue[];
  /** Which data the figure rests on, e.g. "name", "units.ZML", "gs1.each". */
  sources: string[];
  /** Short human-readable description, e.g. "2 x 10 l = 20 l per KI". */
  label: string;
};

// ---------- name parsing ----------

const UNIT_RE = String.raw`(litres?|liters?|litraa?|ltr|l|dl|cl|ml|kgm?|kilos?|kilogram(?:s|ma)?|grm|grams?|gramma|gr|g)`;
// A size: number, optional space, unit, then a word boundary (or "x" for "220gx18").
const QTY_RE = new RegExp(String.raw`(?<![\d.])(\d+(?:\.\d+)?)\s*${UNIT_RE}(?=x\s*\d|[^a-z0-9äöå]|$)`, "g");
const APPROX_RE = /(?:\bca\.?|\bappr\.?|\bapprox\.?|\bapp\.?|\babout|\babt\.?|\bab\.|\bnoin|\bn\.|~|\bcirka|\bcirca|\bvariable)\s*$/;

function toBase(value: number, unit: string): { measure: Measure; amount: number } {
  const u = unit.toLowerCase();
  if (u.startsWith("lit") || u === "ltr" || u === "l") return { measure: "L", amount: value };
  if (u === "dl") return { measure: "L", amount: value / 10 };
  if (u === "cl") return { measure: "L", amount: value / 100 };
  if (u === "ml") return { measure: "L", amount: value / 1000 };
  if (u.startsWith("kg") || u.startsWith("kilo")) return { measure: "kg", amount: value };
  return { measure: "kg", amount: value / 1000 }; // g, gr, grm, gram(s)
}

type Qty = { measure: Measure; amount: number; start: number; end: number; approx: boolean; countBefore?: number; countAfter?: number };

export type NameParse = {
  /** Items in what the name describes (12 in "12 x 1 l", 100 in "100x2 cl"), if the name says. */
  count?: number;
  countKind?: "multiplier" | "pieces" | "ratio";
  /** Content of one item. */
  item: Contents;
  /** Content of everything the name describes: count x item, or the single size. */
  total: Contents;
  approximate: boolean;
  ambiguous: boolean;
  /** Item sizes given as a range ("30-40 g"): piece sizes, not pack content. Ignored. */
  ranges: number;
};

/** Normalise a product name for parsing: lower case, decimal commas to points, x for multiplication signs. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[®™©℮]/g, " ")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[×*]/g, "x")
    .replace(/\s+/g, " ")
    .trim();
}

const near = (a: number, b: number, tol = 0.03) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b));
const roundQty = (n: number) => Math.round(n * 1e6) / 1e6;

/** Read pack sizes from one product name: "10 l", "5 dl", "100x2 cl", "12 x ... 1 L", "60 g x 100 / 6 kg", "5000 ml/2840 g". */
export function parsePackName(rawName: string): NameParse {
  const s = normalizeName(rawName);
  const out: NameParse = { item: {}, total: {}, approximate: false, ambiguous: false, ranges: 0 };
  const qtys: Qty[] = [];
  for (const m of s.matchAll(QTY_RE)) {
    const start = m.index!;
    const end = start + m[0].length;
    const before = s.slice(0, start);
    // "30-40 g", "200-400g": a size range of pieces, not the pack content.
    if (/\d\s*-\s*$/.test(before)) {
      out.ranges += 1;
      continue;
    }
    const { measure, amount } = toBase(Number(m[1]), m[2]);
    if (!(amount > 0)) continue;
    const q: Qty = { measure, amount, start, end, approx: APPROX_RE.test(before) };
    const cb = /(?<![\d.])(\d+)\s*x\s*$/.exec(before);
    if (cb) q.countBefore = Number(cb[1]);
    const ca = /^\s*x\s*(\d+)(?![\d.]|\s*(?:cm|mm|m)\b)/.exec(s.slice(end));
    if (ca) q.countAfter = Number(ca[1]);
    qtys.push(q);
  }
  if (qtys.some((q) => q.approx) || /\b(?:ca|appr|approx|noin|about)\b/.test(s)) out.approximate = true;
  if (qtys.length === 0) return out;
  // "4 x 6 x 0,33 l" (nested packs) and "400/210 g" (gross and drained weight) cannot be read safely.
  if (/(?<![\d.])\d+\s*x\s*\d+\s*x/.test(s)) out.ambiguous = true;
  if (new RegExp(String.raw`(?<![\d.])(?<!x\s{0,3})\d+(?:\.\d+)?\s*/\s*\d+(?:\.\d+)?\s*${UNIT_RE}(?![a-z])`).test(s)) out.ambiguous = true;

  const leading = /^(\d+)\s*x\s*(?=[a-zäöå])/.exec(s);
  const pieces = /(?<![\d.])(\d+)\s*(?:pcs|pc|kpl|stk|st|pieces?|pz|pack)\b/.exec(s);

  // A size with a local multiplier: "100x2 cl", "60 g x 100", "2 x 5 l".
  const counted = qtys.filter((q) => (q.countBefore ?? q.countAfter) !== undefined);
  const measures = [...new Set(qtys.map((q) => q.measure))];

  if (counted.length > 0) {
    const first = counted[0];
    const n = (first.countBefore ?? first.countAfter)!;
    if (n <= 0) return { ...out, ambiguous: true };
    out.count = n;
    out.countKind = "multiplier";
    // Items: the counted size of each measure; a size of another measure without its own count belongs to the item
    // only if it is clearly the same thing ("100ml/84g x 20"), otherwise it is a total.
    for (const m of measures) {
      const own = counted.find((q) => q.measure === m && (q.countBefore ?? q.countAfter) === n);
      const others = qtys.filter((q) => q.measure === m && q !== own);
      if (own) {
        out.item[m] = own.amount;
        out.total[m] = roundQty(own.amount * n);
        for (const o of others) {
          if (o.countBefore !== undefined || o.countAfter !== undefined) {
            if (!near(o.amount * (o.countBefore ?? o.countAfter)!, out.total[m]!)) out.ambiguous = true;
          } else if (!near(o.amount, out.total[m]!) && !near(o.amount, own.amount)) out.ambiguous = true;
        }
      } else {
        // e.g. "100ml/84g x 20": the weight right next to the counted volume is the same item.
        const lone = others.filter((q) => q.countBefore === undefined && q.countAfter === undefined);
        const adjacent = lone.find((q) => Math.abs(q.start - first.end) <= 2 || Math.abs(first.start - q.end) <= 2);
        if (adjacent) {
          out.item[m] = adjacent.amount;
          out.total[m] = roundQty(adjacent.amount * n);
        } else if (lone.length === 1) {
          out.total[m] = lone[0].amount;
        } else if (lone.length > 1) out.ambiguous = true;
      }
    }
    if (counted.some((q) => (q.countBefore ?? q.countAfter) !== n && q.measure === first.measure)) out.ambiguous = true;
    return out;
  }

  // Sizes without a local multiplier. Group per measure.
  for (const m of measures) {
    const vals = [...new Set(qtys.filter((q) => q.measure === m).map((q) => q.amount))].sort((a, b) => a - b);
    if (vals.length === 1) {
      out.item[m] = vals[0];
      out.total[m] = vals[0];
    } else if (vals.length === 2) {
      // "70 g / 5,6 kg": item and total of the same thing.
      const [small, big] = vals;
      const ratio = big / small;
      if (Math.abs(ratio - Math.round(ratio)) < 0.02 && Math.round(ratio) > 1) {
        out.item[m] = small;
        out.total[m] = big;
        if (out.count === undefined) {
          out.count = Math.round(ratio);
          out.countKind = "ratio";
        } else if (out.count !== Math.round(ratio)) out.ambiguous = true;
      } else {
        out.ambiguous = true;
        out.total[m] = big;
      }
    } else out.ambiguous = true;
  }

  if (leading) {
    const n = Number(leading[1]);
    if (out.count === undefined) {
      // "12 x whole milk 1 L": twelve items of the single size.
      for (const m of measures) if (out.item[m] !== undefined) out.total[m] = roundQty(out.item[m]! * n);
      out.count = n;
      out.countKind = "multiplier";
    } else if (out.count !== n) out.ambiguous = true;
  } else if (pieces && out.count === undefined) {
    // "24 pcs 100 g": 24 items of 100 g, or 24 items weighing 100 g together. Undecidable from the name alone.
    out.count = Number(pieces[1]);
    out.countKind = "pieces";
  }
  return out;
}

// ---------- reconciliation with the packaging data ----------

/** Unit codes that denote a case or larger, never a single consumer item. */
const CASE_UNITS = new Set(["KI", "CS", "KRT", "PAL", "KRS", "DSP", "KOR", "DOL"]);

function gsContents(level: GsLevel | undefined): { contents: Contents; pieces?: number } {
  const contents: Contents = {};
  let pieces: number | undefined;
  const put = (v: GsValue) => {
    if (!v || typeof v.value !== "number" || !(v.value > 0) || !v.unit) return;
    const u = v.unit.trim().split(/\s+/)[0].toUpperCase();
    if (u === "LTR") contents.L ??= v.value;
    else if (u === "MLT") contents.L ??= v.value / 1000;
    else if (u === "CLT") contents.L ??= v.value / 100;
    else if (u === "DLT") contents.L ??= v.value / 10;
    else if (u === "KGM") contents.kg ??= v.value;
    else if (u === "GRM") contents.kg ??= v.value / 1000;
    else if (u === "H87") pieces = v.value;
  };
  // Net weight first: some records put a weight in the volume field, sometimes with the wrong unit.
  put(level?.netWeight);
  put(level?.volume);
  return { contents, pieces };
}

type Candidate = { value: number; source: string; exact: boolean };

/** Tolerance when comparing contents from different sources: nominal 1 kg vs GS1 net weight 1,025 g and the like. */
const TOL: Record<Measure, number> = { L: 0.03, kg: 0.06 };

/**
 * Work out what one sales unit holds. The name is the main source; the packaging hierarchy (a ZML unit is one litre,
 * a KG unit one kilogram) and the GS1 measurements confirm or contradict it.
 */
export function derivePackContent(f: PackFacts): PackContent {
  const issues = new Set<PackIssue>();
  const unitSize = (id: string) => f.units.find((u) => u.unitId === id && u.sizeInBaseUnits > 0)?.sizeInBaseUnits;
  const factor = f.salesUnit === f.baseUnit ? 1 : (unitSize(f.salesUnit) ?? null);
  if (factor === null) issues.add("sales_unit_not_in_hierarchy");
  const baseIsCase = CASE_UNITS.has(f.baseUnit);
  const hasUnitOfSize = (n: number) => f.units.some((u) => u.unitId !== f.baseUnit && Math.abs(u.sizeInBaseUnits - n) < 1e-9);

  // Names: parse each language, take the first that has a size, note disagreement.
  const parses = f.names.filter(Boolean).map(parsePackName);
  const withSize = parses.filter((p) => Object.keys(p.total).length > 0);
  const name = withSize[0];
  if (withSize.length > 1) {
    for (const other of withSize.slice(1)) {
      for (const m of ["L", "kg"] as Measure[]) {
        // "24 x water 0,5 l" vs "24 water 0,5 l": same item, different totals. Only both differing counts.
        const totals = [name.total[m], other.total[m]];
        const items = [name.item[m], other.item[m]];
        const differs = (xs: (number | undefined)[]) => xs[0] !== undefined && xs[1] !== undefined && !near(xs[0], xs[1], TOL[m]);
        if (differs(totals) && (differs(items) || items.includes(undefined))) issues.add("names_disagree");
      }
    }
  }
  if (name?.approximate || (f.variableWeight && f.salesUnit !== "KG")) issues.add("approximate");

  const cands: Record<Measure, Candidate[]> = { L: [], kg: [] };
  const each = gsContents(f.each);
  const kase = gsContents(f.case);
  let itemsPerBase: number | undefined;

  // 1. What the name says, mapped onto the base unit.
  if (name) {
    for (const m of ["L", "kg"] as Measure[]) {
      const total = name.total[m];
      const item = name.item[m];
      if (total === undefined) continue;
      const n = name.count;
      if (n !== undefined && n > 1 && name.countKind !== "pieces") {
        if (!baseIsCase && item !== undefined && hasUnitOfSize(n)) {
          // "12 x 1 l" sold from a hierarchy that has a unit of 12: the base unit is one item.
          cands[m].push({ value: item, source: "name", exact: true });
        } else if (baseIsCase || factor === 1 || !hasUnitOfSize(n)) {
          // The base unit is itself the multipack: "100x2 cl" portion box, "22 x 45 g" bag.
          if (!baseIsCase && factor !== 1 && !hasUnitOfSize(n)) issues.add("count_mismatch");
          cands[m].push({ value: total, source: "name", exact: true });
          itemsPerBase = n;
        }
      } else if (n !== undefined && name.countKind === "pieces") {
        // "24 pcs 100 g": per item or in total? Offer both; packaging data must decide.
        cands[m].push({ value: total, source: "name?", exact: false });
        if (item !== undefined) cands[m].push({ value: roundQty(item * n), source: "name?", exact: false });
        itemsPerBase = baseIsCase ? n : undefined;
      } else if (baseIsCase) {
        // "Black currant purée 2 kg" sold by the case: is that the case or one item in it?
        cands[m].push({ value: total, source: "name?", exact: false });
      } else {
        cands[m].push({ value: total, source: "name", exact: true });
      }
    }
  }

  // 2. Units in the packaging hierarchy that are measures themselves.
  if (f.baseUnit === "KG") cands.kg.push({ value: 1, source: "base.KG", exact: true });
  const zml = unitSize("ZML"); // one litre, expressed in base units
  if (zml) cands.L.push({ value: roundQty(1 / zml), source: "units.ZML", exact: true });
  const kgUnit = f.baseUnit === "KG" ? undefined : unitSize("KG");
  if (kgUnit) cands.kg.push({ value: roundQty(1 / kgUnit), source: "units.KG", exact: true });

  // 3. GS1 measurements of the consumer unit and of the case.
  for (const m of ["L", "kg"] as Measure[]) {
    const v = each.contents[m];
    if (v !== undefined) cands[m].push({ value: v, source: "gs1.each", exact: !baseIsCase });
    const c = kase.contents[m];
    if (c !== undefined) {
      const ki = unitSize("KI");
      if (baseIsCase && (f.baseUnit === "KI" || !ki)) cands[m].push({ value: c, source: "gs1.case", exact: true });
      else if (ki && !baseIsCase) cands[m].push({ value: roundQty(c / ki), source: "gs1.case", exact: true });
    }
  }
  if (each.pieces && baseIsCase && itemsPerBase === undefined) itemsPerBase = each.pieces;

  // Resolve each measure on its own: a milk can be certain in litres and only estimated in kilograms.
  const confirmedCount = baseIsCase && name?.count !== undefined && each.pieces !== undefined && name.count === each.pieces;
  const perBase: Contents = {};
  const res: Record<Measure, { certain: boolean; sources: string[]; issues: Set<PackIssue> }> = {
    L: { certain: false, sources: [], issues: new Set() },
    kg: { certain: false, sources: [], issues: new Set() },
  };
  for (const m of MEASURES) {
    const list = cands[m];
    const r = res[m];
    if (list.length === 0) continue;
    const exact = list.filter((c) => c.exact);
    const loose = list.filter((c) => !c.exact);
    if (exact.length > 0) {
      const ref = exact.find((c) => c.source === "name") ?? exact[0];
      perBase[m] = ref.value;
      const agreeing = exact.filter((c) => near(c.value, ref.value, TOL[m]));
      r.sources = unique(agreeing.map((c) => c.source));
      r.certain = agreeing.length === exact.length;
      if (!r.certain) r.issues.add("sources_disagree");
      // A loose figure must match the base content or one item of it; otherwise something is off.
      for (const c of loose) {
        const fitsBase = near(c.value, ref.value, TOL[m]);
        const fitsItem = itemsPerBase !== undefined && near(c.value * itemsPerBase, ref.value, TOL[m]);
        if (!fitsBase && !fitsItem && c.source !== "name?") {
          r.issues.add("sources_disagree");
          r.certain = false;
        }
      }
      // An ambiguous name is trusted only when the packaging data confirms the figure.
      if (name?.ambiguous && ref.source === "name" && r.sources.length < 2) {
        r.issues.add("name_ambiguous");
        r.certain = false;
      }
    } else {
      // Only figures that may describe either the base unit or one item in it.
      const decided = loose.filter((c) => c.source !== "name?").map((c) => c.value);
      const values = loose.map((c) => c.value).filter((v, i, all) => all.findIndex((w) => near(v, w, TOL[m])) === i);
      const pick = values.length === 1 ? values[0] : values.find((v) => decided.length > 0 && decided.every((d) => near(d, v, TOL[m])));
      perBase[m] = pick ?? loose[0].value;
      r.sources = unique(loose.map((c) => c.source.replace("?", "")));
      const item = name?.item[m];
      if (pick !== undefined && confirmedCount && item !== undefined && near(item * name!.count!, pick, TOL[m]) && decided.length > 0) {
        // "24 pcs 100 g" in a case GS1 lists as 24 pieces weighing 2.4 kg: name and packaging data agree.
        r.certain = true;
        r.sources.push("gs1.pieces");
      } else {
        r.certain = false;
        r.issues.add(pick === undefined ? "name_ambiguous" : baseIsCase ? "case_content_unclear" : "name_ambiguous");
      }
    }
  }

  let primary: Measure | null =
    name?.total.L !== undefined ? "L" : name?.total.kg !== undefined ? "kg" : f.baseUnit === "KG" ? "kg" : perBase.L !== undefined ? "L" : perBase.kg !== undefined ? "kg" : null;

  // A KG sales unit holds exactly one kilogram, whatever the name or the piece weight says.
  if (f.salesUnit === "KG") {
    primary = "kg";
    if (factor !== null) perBase.kg = roundQty(1 / factor);
    res.kg = { certain: factor !== null, sources: ["sales.KG"], issues: new Set() };
    for (const i of ["approximate", "names_disagree", "count_mismatch"] as PackIssue[]) issues.delete(i);
  }
  if (perBase.L === undefined && perBase.kg === undefined) issues.add("no_content_data");

  const perSales: Contents = {};
  if (factor !== null) for (const m of MEASURES) if (perBase[m] !== undefined) perSales[m] = roundQty(perBase[m]! * factor);

  // Any issue about the product as a whole blocks every measure.
  const blocked = issues.size > 0;
  const certainMeasures = MEASURES.filter((m) => perSales[m] !== undefined && res[m].certain && !blocked);
  const allIssues = unique([...issues, ...(primary ? res[primary].issues : [])]);

  return {
    salesUnit: f.salesUnit,
    baseUnit: f.baseUnit,
    baseUnitsPerSalesUnit: factor,
    perBaseUnit: perBase,
    perSalesUnit: perSales,
    primary,
    certain: primary !== null && certainMeasures.includes(primary),
    certainMeasures,
    issues: allIssues,
    sources: primary ? unique(res[primary].sources) : [],
    label: describePack(f.salesUnit, f.baseUnit, factor, perBase, perSales, primary),
  };
}

const MEASURES: Measure[] = ["L", "kg"];
const unique = <T,>(xs: T[]): T[] => [...new Set(xs)];

export function formatAmount(amount: number, unit: Measure): string {
  if (unit === "L" && amount < 1) {
    const dl = amount * 10;
    if (Number.isInteger(roundQty(dl))) return `${roundQty(dl)} dl`;
    return `${roundQty(amount * 1000)} ml`;
  }
  if (unit === "kg" && amount < 1) return `${roundQty(amount * 1000)} g`;
  return `${roundQty(amount)} ${unit === "L" ? "l" : "kg"}`;
}

/** "2 x 10 l = 20 l per KI": what one sales unit holds, in words. */
export function describePack(salesUnit: string, baseUnit: string, factor: number | null, perBase: Contents, perSales: Contents, primary: Measure | null): string {
  if (!primary || perBase[primary] === undefined) return `content of one ${salesUnit} unknown`;
  const base = formatAmount(perBase[primary]!, primary);
  if (factor === null) return `${base} per ${baseUnit}; ${salesUnit} size unknown`;
  if (factor === 1) return `${base} per ${salesUnit}`;
  return `${roundQty(factor)} x ${base} = ${formatAmount(perSales[primary]!, primary)} per ${salesUnit}`;
}

// ---------- conversion ----------

/** The facts the conversion needs: the derived content plus the order step. */
export type PackInfo = Pick<PackContent, "salesUnit" | "perSalesUnit" | "certainMeasures" | "issues" | "label"> & {
  /** Order step in sales units (the partner's allowedLotSize, read by partner.ts lotOf: 0.01 or none is 1). */
  lotSize?: number;
};

export type ConversionOptions = {
  /** "up" (default) never delivers less than asked; "down" never more; "nearest" the closest whole step. */
  rounding?: "up" | "down" | "nearest";
  /**
   * Whole sales units even when the lot is fractional (the step becomes the least common multiple of the lot and 1).
   * Default false: the step is the lot, which is a whole number of sales units unless the data gives a fractional
   * lot (1.5 kg).
   */
  wholeUnits?: boolean;
  /** Warn when rounding adds more than this share on top of the request. Default 0.1 (10 %). */
  maxOvershoot?: number;
};

export type ConversionRefusal = "invalid_amount" | "content_unknown" | "content_uncertain" | "measure_not_known" | "below_one_step";

export type Conversion =
  | {
      ok: true;
      requested: Amount;
      salesUnits: number;
      salesUnit: string;
      /** What those sales units hold. */
      delivered: Amount;
      /** delivered - requested, in the requested unit (negative when rounding down). */
      difference: number;
      /** Order step used, in sales units. */
      step: number;
      perSalesUnit: Amount;
      warnings: string[];
      explanation: string;
    }
  | { ok: false; reason: ConversionRefusal; message: string; requested: Amount; estimate?: { salesUnits: number; delivered: Amount } };

/** Hundredths, to keep decimal lot sizes (0.01, 1.5, 2.5) exact in integer arithmetic. */
const SCALE = 100;

function orderStep(salesUnit: string, lotSize: number | undefined, wholeUnits: boolean): number {
  // The partner's 0.01 (or no lot) is 1 sales unit: "0.01 crates is not possible". A real fractional lot is kept.
  const lot = lotSize && lotSize > 0.01 + 1e-9 ? lotSize : 1;
  void salesUnit;
  let stepH = Math.round(lot * SCALE);
  if (wholeUnits) {
    const one = SCALE;
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    stepH = (stepH * one) / gcd(stepH, one); // least common multiple of the lot and one whole unit
    if (stepH < one) stepH = one;
  }
  return stepH / SCALE;
}

/**
 * How many sales units to order for an amount in litres or kilograms. Refuses (ok: false) rather than guess when the
 * pack content is not certain; the refusal carries an estimate so a human can confirm it.
 */
export function amountToSalesUnits(pack: PackInfo, requested: Amount, opts: ConversionOptions = {}): Conversion {
  const rounding = opts.rounding ?? "up";
  const wholeUnits = opts.wholeUnits ?? false;
  const maxOvershoot = opts.maxOvershoot ?? 0.1;
  if (!Number.isFinite(requested.amount) || requested.amount <= 0) {
    return { ok: false, reason: "invalid_amount", message: `Requested amount must be a positive number; got ${requested.amount}.`, requested };
  }
  const per = pack.perSalesUnit[requested.unit];
  if (per === undefined || !(per > 0)) {
    const other = requested.unit === "L" ? "kg" : "L";
    const reason = pack.perSalesUnit[other] !== undefined ? "measure_not_known" : "content_unknown";
    return {
      ok: false,
      reason,
      requested,
      message:
        reason === "measure_not_known"
          ? `One ${pack.salesUnit} is known in ${other}, not in ${requested.unit}; converting would need a density. Ask a human.`
          : `The content of one ${pack.salesUnit} is not known (${pack.label}). Ask a human.`,
    };
  }
  const step = orderStep(pack.salesUnit, pack.lotSize, wholeUnits);
  const exactUnits = requested.amount / per;
  const steps = exactUnits / step;
  const near1 = Math.abs(steps - Math.round(steps)) < 1e-9;
  const n = near1 ? Math.round(steps) : rounding === "up" ? Math.ceil(steps) : rounding === "down" ? Math.floor(steps) : Math.round(steps);
  const salesUnits = roundQty(n * step);
  const delivered = roundQty(salesUnits * per);
  const estimate = { salesUnits, delivered: { amount: delivered, unit: requested.unit } };

  if (!pack.certainMeasures.includes(requested.unit)) {
    return {
      ok: false,
      reason: "content_uncertain",
      requested,
      estimate,
      message: `Not sure what one ${pack.salesUnit} holds (${pack.label}; ${pack.issues.join(", ") || "unconfirmed"}). Estimate: ${salesUnits} ${pack.salesUnit} = ${formatAmount(delivered, requested.unit)}. Ask a human to confirm.`,
    };
  }
  if (salesUnits <= 0) {
    return {
      ok: false,
      reason: "below_one_step",
      requested,
      estimate: { salesUnits: step, delivered: { amount: roundQty(step * per), unit: requested.unit } },
      message: `${formatAmount(requested.amount, requested.unit)} is less than one order step (${step} ${pack.salesUnit} = ${formatAmount(roundQty(step * per), requested.unit)}).`,
    };
  }
  const difference = roundQty(delivered - requested.amount);
  const warnings: string[] = [];
  if (difference > 0 && difference / requested.amount > maxOvershoot) {
    warnings.push(`Rounding to whole ${pack.salesUnit} adds ${formatAmount(difference, requested.unit)} (+${Math.round((difference / requested.amount) * 100)} %).`);
  }
  if (difference < 0) warnings.push(`Delivers ${formatAmount(-difference, requested.unit)} less than asked.`);
  if (step > 1) warnings.push(`Orderable in steps of ${step} ${pack.salesUnit}.`);
  return {
    ok: true,
    requested,
    salesUnits,
    salesUnit: pack.salesUnit,
    delivered: { amount: delivered, unit: requested.unit },
    difference,
    step,
    perSalesUnit: { amount: per, unit: requested.unit },
    warnings,
    explanation: `${formatAmount(requested.amount, requested.unit)} = ${salesUnits} ${pack.salesUnit} x ${formatAmount(per, requested.unit)} (${pack.label})${difference ? `, ${formatAmount(delivered, requested.unit)} in total` : ""}.`,
  };
}

export type BackConversion = { ok: true; amount: Amount; explanation: string } | { ok: false; reason: ConversionRefusal | "invalid_quantity"; message: string; estimate?: Amount };

/** What a number of sales units holds, in litres or kilograms. Also checks the quantity against the order step. */
export function salesUnitsToAmount(pack: PackInfo, salesUnits: number, unit: Measure, opts: { wholeUnits?: boolean } = {}): BackConversion {
  if (!Number.isFinite(salesUnits) || salesUnits <= 0) return { ok: false, reason: "invalid_quantity", message: `Quantity must be positive; got ${salesUnits}.` };
  const step = orderStep(pack.salesUnit, pack.lotSize, opts.wholeUnits ?? false);
  const steps = salesUnits / step;
  if (Math.abs(steps - Math.round(steps)) > 1e-9) {
    return { ok: false, reason: "invalid_quantity", message: `${salesUnits} ${pack.salesUnit} is not a multiple of the order step ${step} ${pack.salesUnit}.` };
  }
  const per = pack.perSalesUnit[unit];
  if (per === undefined) return { ok: false, reason: pack.perSalesUnit[unit === "L" ? "kg" : "L"] !== undefined ? "measure_not_known" : "content_unknown", message: `The content of one ${pack.salesUnit} in ${unit} is not known.` };
  const amount = { amount: roundQty(salesUnits * per), unit };
  if (!pack.certainMeasures.includes(unit)) return { ok: false, reason: "content_uncertain", estimate: amount, message: `Not sure what one ${pack.salesUnit} holds (${pack.label}).` };
  return { ok: true, amount, explanation: `${salesUnits} ${pack.salesUnit} x ${formatAmount(per, unit)} = ${formatAmount(amount.amount, unit)}.` };
}
