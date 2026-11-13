import { z } from "zod";
import { DockError } from "@/core/errors";
import { consoleKitchen } from "@/server/authz";
import type { resolveKitchen } from "@/server/console-kitchens";
import { handle, readJson } from "@/server/http";
import { getMemoryService } from "./runtime";
import type { MemoryService } from "./service";
import { staffFromRequest } from "./staff";

/**
 * The memory routes' plumbing. A kitchen route resolves the kitchen from the URL the way the kitchen console does
 * (its own mandate, held server side) and passes ONLY that kitchen's org id on: no body field can name another
 * kitchen. A wholesaler route needs an operations session and gets read access to shared items only.
 */
export type ResolvedKitchen = NonNullable<Awaited<ReturnType<typeof resolveKitchen>>>;
const noStore = { "cache-control": "no-store" };

/**
 * Who may read or change a kitchen's memory is the console rule (server/authz.ts): a built-in demo kitchen's open
 * console, or a visitor's kitchen only from their own phone. `k.info.by` is replaced by who actually answered: the
 * visitor's name when their passkey-backed session is present, else the console's relayed name marked unverified.
 */
export function kitchenMemoryRoute(req: Request, params: Promise<{ kitchen: string }>, fn: (k: ResolvedKitchen, memory: MemoryService) => Promise<unknown>): Promise<Response> {
  return handle(async (rt) => {
    const { kitchen } = await params;
    const found = await consoleKitchen(req, rt, kitchen);
    if (!found) throw new DockError(404, "kitchen_not_found", "This kitchen does not exist or its demo time is over.");
    const person = found.console.person;
    const k: ResolvedKitchen = { ...found, info: { ...found.info, by: person ? `${person.name} (signed in)` : `${found.info.by} (open demo console, not verified)` } };
    return Response.json(await fn(k, await getMemoryService()), { headers: noStore });
  });
}

export function staffMemoryRoute(req: Request, fn: (staff: { name: string }, memory: MemoryService) => Promise<unknown>): Promise<Response> {
  return handle(async () => {
    const staff = staffFromRequest(req);
    return Response.json(await fn(staff, await getMemoryService()), { headers: noStore });
  });
}

export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.output<T>> {
  const raw = await readJson(req);
  const r = schema.safeParse(raw);
  if (!r.success) throw new DockError(400, "invalid_request", z.prettifyError(r.error));
  return r.data;
}

const id = z.string().min(1).max(80);
const text = z.string().trim().min(1).max(500);

/** POST /ui-api/memory/kitchens/{kitchen}: the memory page's changes. `by` is always the person the console relays for. */
export const MemoryAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), itemId: id, answer: z.enum(["yes", "no"]) }),
  z.object({ action: z.literal("correct"), itemId: id, text: text.optional(), fact: z.record(z.string(), z.unknown()).optional(), family: z.string().max(60).nullable().optional(), strength: z.enum(["rule", "habit", "one_off"]).optional(), site: z.string().max(80).nullable().optional() }),
  z.object({ action: z.literal("forget"), itemId: id }),
  z.object({ action: z.literal("audience"), itemId: id, audience: z.enum(["shared", "private"]) }),
  z.object({ action: z.literal("state"), fact: z.record(z.string(), z.unknown()), family: z.string().max(60).optional(), text: text.optional(), strength: z.enum(["rule", "habit", "one_off"]).optional(), site: z.string().max(80).optional() }),
  z.object({ action: z.literal("note"), text }),
  z.object({ action: z.literal("proposal"), proposalId: id, accept: z.boolean() }),
  z.object({ action: z.literal("mandate"), itemId: id, decision: z.enum(["added", "declined"]) }),
]);
