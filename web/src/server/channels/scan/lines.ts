import { z } from "zod";
import { DockError } from "@/core/errors";
import type { NeedUnit } from "@/core/need";

/**
 * Plain code around the document reader: what may be uploaded, and what is kept of what the model read.
 * The model transcribes; these rules decide. An amount the writing does not contain is removed, a unit
 * that is not written is left empty, text that addresses the system is kept as content and never becomes a
 * need, and a line the model was unsure of is marked for the buyer to check.
 */

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 5;
export const MAX_TEXT_CHARS = 20_000;
export const MAX_LINES = 40;

export type SourceKind = "image" | "pdf" | "text";

/** Check the bytes really are what the upload says, by their first bytes. Returns the media type to send. */
export function sniff(bytes: Uint8Array): { kind: "image" | "pdf"; mediaType: string } {
  const b = bytes;
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "image", mediaType: "image/jpeg" };
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return { kind: "image", mediaType: "image/png" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { kind: "image", mediaType: "image/webp" };
  if (ascii(0, 5) === "%PDF-") return { kind: "pdf", mediaType: "application/pdf" };
  throw new DockError(415, "scan_unsupported", "Send a photo (JPEG, PNG or WebP), a PDF, or pasted text.");
}

export function checkSize(kind: "image" | "pdf", bytes: Uint8Array) {
  const max = kind === "pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
  if (bytes.byteLength > max) throw new DockError(413, "scan_too_large", `That file is ${(bytes.byteLength / 1048576).toFixed(1)} MB; the limit is ${max / 1048576} MB.`);
  if (kind === "pdf") {
    const pages = (new TextDecoder("latin1").decode(bytes).match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
    if (pages > MAX_PDF_PAGES) throw new DockError(413, "scan_too_many_pages", `That PDF has ${pages} pages; send at most ${MAX_PDF_PAGES}.`);
  }
}

/** What the model returns: every field required, empty when not written (all providers' structured output accepts this). */
export const RawScan = z.object({
  isOrderList: z.boolean(),
  deliverByAsWritten: z.string().nullable(),
  lines: z.array(
    z.object({
      text: z.string(),
      item: z.string().nullable(),
      amountAsWritten: z.string().nullable(),
      amount: z.number().nullable(),
      unit: z.enum(["L", "kg", "pcs", "pack"]).nullable(),
      legibility: z.enum(["clear", "unsure", "illegible"]),
      kind: z.enum(["item", "heading", "note", "instruction"]),
      why: z.string().nullable(),
      box: z.array(z.number()).nullable(),
      page: z.number().nullable(),
    }),
  ),
});
export type RawScan = z.infer<typeof RawScan>;

export type LineStatus = "ready" | "check" | "needs_amount" | "illegible" | "instruction" | "not_an_item";

export type ScanLine = {
  id: string;
  /** Exactly as written (the model's transcription). */
  read: string;
  item: string | null;
  amount: number | null;
  unit: NeedUnit | null;
  confidence: "high" | "medium" | "low";
  status: LineStatus;
  /** Why the line is not ready, in words for the buyer. */
  notes: string[];
  /** Where on the image: fractions 0..1 of width and height. Absent for text and when the model gave none. */
  box?: { x: number; y: number; w: number; h: number; page: number };
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20, dozen: 12, half: 0.5,
  yksi: 1, kaksi: 2, kolme: 3, neljä: 4, viisi: 5, kuusi: 6, seitsemän: 7, kahdeksan: 8, yhdeksän: 9, kymmenen: 10, puoli: 0.5,
  en: 1, ett: 1, två: 2, tre: 3, fyra: 4, fem: 5, sex: 6, sju: 7, åtta: 8, nio: 9, tio: 10, halv: 0.5,
};

/** Numbers actually present in a piece of writing: digits ("20", "2,5", "1 000") and small number words. */
export function writtenNumbers(s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(/\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g)) out.push(Number(m[0].replace(/[  ]/g, "").replace(",", ".")));
  for (const w of s.toLowerCase().split(/[^a-zåäö]+/)) if (w in NUMBER_WORDS) out.push(NUMBER_WORDS[w]);
  return out;
}

const UNIT_TOKENS: [NeedUnit, RegExp][] = [
  ["L", /(?<![\p{L}])(l|ltr|lt|litra[a-z]*|liter[a-z]*|litre[s]?|dl)(?![\p{L}])/iu],
  ["kg", /(?<![\p{L}])(kg|kilo[a-z]*|kiloa)(?![\p{L}])/iu],
  ["pcs", /(?<![\p{L}])(kpl|st|stk|pcs|pc|pieces?|kappale[a-z]*|styck[a-z]*)(?![\p{L}])/iu],
  ["pack", /(?<![\p{L}])(ltk|laatik[a-zä]*|box(es)?|cases?|pack[s]?|pkt|paketti[a-z]*|back[a]?|låd[a-z]*|kartong[a-z]*|ps|pussi[a-z]*|säck[a-z]*|tray[s]?|crate[s]?|kenno[a-z]*|ras[a-z]*)(?![\p{L}])/iu],
];

const INSTRUCTION = /(?<![\p{L}\p{N}])(ignore|disregard|forget|override|bypass|approve|auto-?approve|without (approval|sign[- ]?off|asking)|system( prompt)?|assistant|you are|as an ai|ai agent|the agent|prompt|jailbreak|unohda|ohita|hyväksy|älä kysy|ilman hyväksyntää|ignorera|glöm|godkänn|utan godkännande)(?![\p{L}\p{N}])/iu;

/** Model output to lines the buyer reviews. Pure; `sourceText` is the pasted text, when that is the source. */
export function toLines(raw: RawScan, kind: SourceKind): ScanLine[] {
  return raw.lines.slice(0, MAX_LINES).map((l, i) => {
    const notes: string[] = [];
    const read = l.text.trim().slice(0, 300);
    const written = `${l.amountAsWritten ?? ""} ${read}`;
    let amount = l.amount;
    let unit = l.unit as NeedUnit | null;
    // Quantities are never invented: the number must be in the writing.
    if (amount !== null && !writtenNumbers(written).some((n) => Math.abs(n - amount!) < 1e-9)) {
      notes.push(`The reader gave ${amount}, which is not written on the line; enter the amount.`);
      amount = null;
    }
    if (amount !== null && (amount <= 0 || amount > 1_000_000)) {
      notes.push("The amount is out of range; check it.");
      amount = null;
    }
    if (unit && !UNIT_TOKENS.find(([u]) => u === unit)![1].test(written)) {
      notes.push(`No unit is written for ${unit}; choose the unit.`);
      unit = null;
    }
    const instruction = l.kind === "instruction" || INSTRUCTION.test(read);
    let status: LineStatus;
    if (instruction) {
      status = "instruction";
      notes.unshift("This text speaks to the ordering system. It is shown as written and never acted on.");
    } else if (l.kind !== "item" || !l.item?.trim()) status = "not_an_item";
    else if (l.legibility === "illegible") {
      status = "illegible";
      notes.unshift(l.why?.trim() ? `Could not be read: ${l.why.trim()}` : "Could not be read. Type what it says, or leave it out.");
    } else if (amount === null || unit === null) status = "needs_amount";
    else if (l.legibility === "unsure") {
      status = "check";
      notes.unshift(l.why?.trim() ? `Check this: ${l.why.trim()}` : "The reader was not sure; check it.");
    } else status = "ready";
    if ((amount === null || unit === null) && status !== "instruction" && status !== "not_an_item" && !notes.some((n) => n.includes("amount") || n.includes("unit"))) notes.push(amount === null ? "No amount is written; enter it." : "No unit is written; choose it.");
    const confidence = l.legibility === "clear" && status === "ready" ? "high" : l.legibility === "illegible" || instruction ? "low" : l.legibility === "unsure" || status !== "ready" ? (status === "needs_amount" && l.legibility === "clear" ? "medium" : "low") : "medium";
    return { id: `l${i + 1}`, read, item: l.item?.trim().slice(0, 200) || null, amount, unit, confidence, status, notes, ...(kind === "text" ? {} : boxOf(l.box, l.page)) };
  });
}

function boxOf(b: number[] | null, page: number | null): { box?: ScanLine["box"] } {
  if (!b || b.length !== 4 || b.some((n) => !Number.isFinite(n))) return {};
  const [ymin, xmin, ymax, xmax] = b.map((n) => Math.max(0, Math.min(1000, n)) / 1000);
  if (ymax <= ymin || xmax <= xmin) return {};
  const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
  return { box: { x: r4(xmin), y: r4(ymin), w: r4(xmax - xmin), h: r4(ymax - ymin), page: page && page > 0 ? Math.round(page) : 1 } };
}

/** The words a reviewed line is read as by the same interpret step as typed text. */
export function lineRequest(line: { item: string; amount: number; unit: NeedUnit }, deliverBy?: string): string {
  const u = line.unit === "pack" ? (line.amount === 1 ? "pack" : "packs") : line.unit === "pcs" ? "pieces" : line.unit;
  return `${line.amount} ${u} ${line.item}${deliverBy ? `, delivery ${deliverBy}` : ""}`;
}
