import { z } from "zod";
import { MODE_IDS, cleanModes, type ModeId } from "@/lib/agent/modes";

/*
 * What an account's details must look like. Used by the admin's API routes and, so the person
 * typing sees the same sentence before they press the button, by the admin's forms.
 */

export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;

const name = z.string().trim().min(1, "Give the account a name.").max(80, "That name is too long.");
const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "That email address is too long.")
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "That does not look like an email address.");
const password = z.string().min(MIN_PASSWORD, `A password needs at least ${MIN_PASSWORD} characters.`).max(MAX_PASSWORD, "That password is too long.");

/** The modes an account may use: known ones, at least one, kept in order from the quickest. */
const modes = z
  .array(z.enum(MODE_IDS as [ModeId, ...ModeId[]], "Choose the modes from the list."), "Choose the modes from the list.")
  .min(1, "An account needs at least one mode.")
  .max(MODE_IDS.length, "Choose the modes from the list.")
  .transform((list) => cleanModes(list));

export const MAX_USAGE_CAP = 100_000;

/** The most an account may spend in all, in US dollars: a positive amount, or null for no limit. */
const usageCapUsd = z
  .number("Give the limit as an amount in US dollars, or leave it empty for no limit.")
  .positive("A limit must be more than nothing. Leave it empty for no limit.")
  .max(MAX_USAGE_CAP, "A limit can be at most $100,000.")
  .nullable();

/**
 * What the admin typed into a limit field, as the value to send: null for an empty field (no
 * limit), undefined when it is not an amount. Cents are as fine as a limit gets.
 */
export function capFromText(text: string): number | null | undefined {
  const clean = text.trim().replace("$", "").replaceAll(",", "").trim();
  if (!clean) return null;
  const amount = Number(clean);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : undefined;
}

export const NewAccount = z.object({ name, email, password, modes: modes.optional(), showUsage: z.boolean().optional(), usageCapUsd: usageCapUsd.optional() });

export const AccountChange = z
  .object({
    name: name.optional(),
    status: z.enum(["active", "blocked"]).optional(),
    password: password.optional(),
    modes: modes.optional(),
    showUsage: z.boolean().optional(),
    usageCapUsd: usageCapUsd.optional(),
  })
  .strict()
  .refine((change) => Object.values(change).some((value) => value !== undefined), "There is nothing to change.");

/** The first thing wrong with what was sent, as a sentence. */
export function firstProblem(error: z.ZodError): string {
  return error.issues[0]?.message || "Something in that is not right.";
}
