import { z } from "zod";

/**
 * Next.js can load this module more than once in one server process (one copy per route or page bundle). The
 * shared runtime on globalThis is built by whichever bundle came first, so an error thrown inside it can come
 * from a different copy of the class than the one a route handler imports, and a plain `instanceof` is false.
 * Errors therefore carry a process-wide brand (`Symbol.for`), and `instanceof` checks the brand.
 */
const DOCK_ERROR = Symbol.for("dock.error.DockError");

/** True for a DockError from any copy of this module. Prefer this over `instanceof` in new code. */
export function isDockError(err: unknown): err is DockError {
  return typeof err === "object" && err !== null && (err as Record<symbol, unknown>)[DOCK_ERROR] === true;
}

/** A refusal with an HTTP status, a machine-readable code and, where one fired, the rule that refused. */
export class DockError extends Error {
  static [Symbol.hasInstance](value: unknown): value is DockError {
    return isDockError(value);
  }

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly rule?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DockError";
    Object.defineProperty(this, DOCK_ERROR, { value: true });
  }
}

/** Validate input with zod; a failure becomes a 400 DockError listing the issues. */
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new DockError(400, "invalid_request", z.prettifyError(r.error), undefined, { issues: r.error.issues });
  return r.data;
}
