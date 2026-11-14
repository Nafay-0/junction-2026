import { z } from "zod";

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

export const NewAccount = z.object({ name, email, password });

export const AccountChange = z
  .object({ name: name.optional(), status: z.enum(["active", "blocked"]).optional(), password: password.optional() })
  .strict()
  .refine((change) => Object.values(change).some((value) => value !== undefined), "There is nothing to change.");

/** The first thing wrong with what was sent, as a sentence. */
export function firstProblem(error: z.ZodError): string {
  return error.issues[0]?.message || "Something in that is not right.";
}
