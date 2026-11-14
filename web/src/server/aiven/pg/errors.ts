import { DockError, isDockError } from "@/core/errors";

/**
 * When PostgreSQL cannot be reached or does not answer in time, every route says so in the same honest way:
 * 503 `store_unavailable`, a sentence a person understands, retryable. Errors the database answered with
 * (a unique violation, a check constraint) are not touched: the code that called it decides what they mean.
 *
 * The pool (pool.ts) converts at the source, so every route's existing DockError mapping (http.ts `handle`,
 * kitchen-portal-http.ts `portalRoute`, authz.ts `refusalResponse`) turns it into JSON with no route change.
 */

/** Socket and resolver errors: the database's address did not answer. */
const NET_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ENETDOWN", "ECONNABORTED", "ESOCKETTIMEDOUT"]);

/**
 * SQLSTATEs that mean "the database is not there right now", not "your statement is wrong":
 * class 08 connection exception, 53300 too many connections, 57P01-57P03 shutdown / cannot connect now,
 * 57014 query cancelled (our statement_timeout fired: the database is too slow to answer).
 */
const SQLSTATE = /^(08...|53300|57P0[123]|57014)$/;

/** pg and pg-pool raise these as plain Errors without a code. */
const MESSAGES = [
  /timeout exceeded when trying to connect/i, // pg-pool: no client within connectionTimeoutMillis (connect or wait in queue)
  /Query read timeout/i, // pg: query_timeout, the client-side deadline
  /Connection terminated/i, // "... unexpectedly", "... due to connection timeout"
  /Client has encountered a connection error and is not queryable/i,
  /Client was closed and is not queryable/i,
  /server closed the connection unexpectedly/i,
  /Cannot use a pool after calling end/i,
];

const STORE_ERROR = Symbol.for("dock.error.storeUnavailable");

export function isStoreConnectionError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  if ((err as Record<symbol, unknown>)[STORE_ERROR] === true) return true;
  if (isDockError(err)) return false;
  const e = err as { code?: unknown; message?: unknown; errors?: unknown; cause?: unknown };
  if (typeof e.code === "string" && (NET_CODES.has(e.code) || SQLSTATE.test(e.code))) return true;
  if (typeof e.message === "string" && MESSAGES.some((re) => re.test(e.message as string))) return true;
  // Node's happy-eyeballs connect reports an AggregateError of the per-address failures.
  if (Array.isArray(e.errors) && e.errors.some(isStoreConnectionError)) return true;
  return e.cause !== undefined && e.cause !== err && isStoreConnectionError(e.cause);
}

/** Seconds a client is told to wait before trying again. */
export const STORE_RETRY_AFTER_S = 10;

/** The refusal every route gives while the database is away. The original error stays on `cause` for the logs. */
export function storeUnavailable(cause?: unknown): DockError {
  const err = new DockError(
    503,
    "store_unavailable",
    "AimoPilot cannot reach its database right now, so nothing was saved or changed. Please try again in a few seconds.",
    "store",
    { retryable: true, retryAfterSeconds: STORE_RETRY_AFTER_S },
  );
  Object.defineProperty(err, STORE_ERROR, { value: true });
  if (cause !== undefined) Object.defineProperty(err, "cause", { value: cause, enumerable: false });
  return err;
}

/** A DockError 503 store_unavailable for a connection-class error; anything else unchanged. */
export function asStoreError(err: unknown): unknown {
  return isStoreConnectionError(err) && !isStoreUnavailable(err) ? storeUnavailable(err) : err;
}

/** True for the DockError storeUnavailable() makes (from any copy of this module). */
export function isStoreUnavailable(err: unknown): boolean {
  return isDockError(err) && err.code === "store_unavailable";
}
