/**
 * The usage limit the admin can set on an account. Shared by the server and the browser: the
 * words the user reads, and the code a refusal carries so the interface can tell it from any
 * other error.
 */

export const USAGE_CAP_CODE = "usage_cap";

export const USAGE_CAP_SENTENCE = "You've hit your usage limit. Ask your admin to raise it.";

/** What `/api/usage` answers. The amounts are only sent to an account that may see its usage. */
export type CapStatus = {
  reached: boolean;
  capUsd: number | null;
  spentUsd: number | null;
  /** Who to ask for more, when the limit is reached. */
  adminEmail: string | null;
};
