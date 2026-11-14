import { z } from "zod";
import { DockError, parse } from "@/core/errors";
import type { IntakeView } from "@/core/intake";
import { NEED_UNITS, type NeedInput } from "@/core/need";
import type { PublicOrder } from "@/core/orders";
import { answer, asProblem, choose, getOrder, getStep, kitchenAgent, openNeed, place, readNeed, respond, type KitchenAgent, type Via } from "../flow";
import { scanLimit } from "../limits";
import { guard, readCapped } from "./guard";
import { checkSize, lineRequest, MAX_TEXT_CHARS, sniff } from "./lines";
import { readDocument, type ScanResult } from "./read";

/**
 * The photo door: read a document (POST /ui-api/scan/{kitchen}), then turn each reviewed line into a request
 * through the same intake as typing (POST /ui-api/scan/{kitchen}/step).
 */

export async function scan(kitchen: string, req: Request): Promise<ScanResult> {
  guard(req, "read");
  await kitchenAgent(kitchen, req, "photo"); // the kitchen must exist, and a visitor's only from their own phone
  const type = req.headers.get("content-type") ?? "";
  const body = await readCapped(req, 11 * 1024 * 1024);
  let input: Parameters<typeof readDocument>[0];
  if (type.startsWith("multipart/form-data")) {
    const form = await new Response(new Blob([body as Uint8Array<ArrayBuffer>]), { headers: { "content-type": type } }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new DockError(400, "invalid_request", "Send the photo or PDF as the form field \"file\".");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { kind, mediaType } = sniff(bytes);
    checkSize(kind, bytes);
    input = { kind, bytes, mediaType };
  } else {
    let json: { text?: unknown } | null = null;
    try {
      json = JSON.parse(new TextDecoder().decode(body)) as { text?: unknown };
    } catch {
      json = null;
    }
    const text = typeof json?.text === "string" ? json.text.trim() : "";
    if (!text) throw new DockError(400, "invalid_request", "Send a file, or { text } with the pasted list or email.");
    if (text.length > MAX_TEXT_CHARS) throw new DockError(413, "scan_too_large", `Pasted text is limited to ${MAX_TEXT_CHARS} characters.`);
    input = { kind: "text", text };
  }
  scanLimit().take(kitchen);
  return readDocument(input);
}

const Line = z.object({
  id: z.string().max(20),
  read: z.string().max(300),
  item: z.string().min(1).max(200),
  amount: z.number().positive().max(1_000_000),
  unit: z.enum(NEED_UNITS),
  confidence: z.enum(["high", "medium", "low"]),
  edited: z.boolean(),
});

export const StepBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), line: Line, deliverBy: z.string().max(60).optional(), source: z.enum(["image", "pdf", "text"]), scanModel: z.string().max(80).optional() }),
  z.object({ action: z.literal("respond"), requestId: z.string(), key: z.string().max(200), choice: z.string().max(100) }),
  z.object({ action: z.literal("answer"), requestId: z.string(), questionId: z.string().max(100), optionId: z.string().max(100) }),
  z.object({ action: z.literal("choose"), requestId: z.string(), optionId: z.string().max(100) }),
  z.object({ action: z.literal("place"), requestId: z.string() }),
  z.object({ action: z.literal("get"), requestId: z.string() }),
  z.object({ action: z.literal("order"), orderId: z.string() }),
]);

export type StepReply = { step?: IntakeView; order?: PublicOrder; problem?: { code: string; message: string } };

const viaOf = (s: "image" | "pdf" | "text"): Via => s;

export async function scanStep(kitchen: string, req: Request): Promise<StepReply> {
  guard(req, "step");
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder().decode(await readCapped(req, 64 * 1024)));
  } catch (err) {
    if (err instanceof DockError) throw err;
    throw new DockError(400, "invalid_json", "Request body must be JSON.");
  }
  const body = parse(StepBody, input);
  const a = await kitchenAgent(kitchen, req, "photo");
  try {
    switch (body.action) {
      case "open":
        return { step: await openLine(a, body) };
      case "respond":
        return { step: await respond(a, body.requestId, body.key, body.choice, "photo", "image") };
      case "answer":
        return { step: await answer(a, body.requestId, body.questionId, body.optionId, "photo", "image") };
      case "choose":
        return { step: await choose(a, body.requestId, body.optionId, "photo", "image") };
      case "place": {
        const order = await place(a, body.requestId, "photo");
        return { order, step: await getStep(a, body.requestId) };
      }
      case "get":
        return { step: await getStep(a, body.requestId) };
      case "order":
        return { order: await getOrder(a, body.orderId) };
    }
  } catch (err) {
    return { problem: asProblem(err) };
  }
}

async function openLine(a: KitchenAgent, body: Extract<z.output<typeof StepBody>, { action: "open" }>): Promise<IntakeView> {
  const { line } = body;
  const words = lineRequest(line, body.deliverBy);
  let need: NeedInput;
  let interpretModel: string | undefined;
  try {
    const r = await readNeed(a, words);
    need = r.need;
    interpretModel = r.model;
  } catch (err) {
    const p = asProblem(err);
    if (!["need_incomplete", "not_a_purchase_request", "interpret_failed", "interpret_timeout", "model_unavailable", "interpret_invalid_output"].includes(p.code)) throw err;
    need = { text: words, item: { text: line.item } };
  }
  // The amount the buyer reviewed is the amount: the reader of the words may not change it.
  need = { ...need, text: words, quantity: { amount: line.amount, unit: line.unit } };
  return openNeed(a, need, "photo", viaOf(body.source), {
    words,
    summary: `The request came in through the photo door (${body.source === "text" ? "pasted text" : body.source === "pdf" ? "a PDF" : "a photo"}): the line "${line.read.slice(0, 120)}" was read with ${line.confidence} confidence${line.edited ? " and corrected by the buyer" : ""}, and reviewed as ${line.amount} ${line.unit} ${line.item}.`,
    data: { read: line.read, confidence: line.confidence, edited: line.edited, lineId: line.id, scanModel: body.scanModel, interpretModel },
  });
}
