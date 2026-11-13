import { z } from "zod";

/** A refusal with an HTTP status, a machine-readable code and, where one fired, the rule that refused. */
export class DockError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly rule?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DockError";
  }
}

/** Validate input with zod; a failure becomes a 400 DockError listing the issues. */
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new DockError(400, "invalid_request", z.prettifyError(r.error), undefined, { issues: r.error.issues });
  return r.data;
}
