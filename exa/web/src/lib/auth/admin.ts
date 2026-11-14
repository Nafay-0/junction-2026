import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { sessions, users } from "@/lib/db/schema";
import { MIN_PASSWORD, hashPassword, verifyPassword } from "./password";

/*
 * There is exactly one admin, and it is not made in the interface: it is the account named by
 * ADMIN_EMAIL and ADMIN_PASSWORD. Each time the server starts, that account is created if it is
 * missing, its password is brought in line with the variable, and any other account that was
 * admin (because ADMIN_EMAIL used to be something else) becomes an ordinary account.
 */

export const adminEmail = () => process.env.ADMIN_EMAIL?.trim().toLowerCase() || null;

export async function ensureAdmin(): Promise<void> {
  const email = adminEmail();
  const password = process.env.ADMIN_PASSWORD ?? "";
  const name = process.env.ADMIN_NAME?.trim() || "Admin";
  if (!email || !password) {
    console.warn("[accounts] ADMIN_EMAIL and ADMIN_PASSWORD are not both set: there is no admin account, and nobody can add accounts.");
    return;
  }
  if (password.length < MIN_PASSWORD) {
    console.warn(`[accounts] ADMIN_PASSWORD is shorter than ${MIN_PASSWORD} characters: the admin account was left as it is.`);
    return;
  }

  const db = database();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!existing) {
    await db.insert(users).values({ email, name, passwordHash: await hashPassword(password), role: "admin", status: "active" });
  } else {
    const samePassword = await verifyPassword(password, existing.passwordHash);
    await db
      .update(users)
      .set({
        role: "admin",
        status: "active",
        name: process.env.ADMIN_NAME?.trim() || existing.name,
        ...(samePassword ? {} : { passwordHash: await hashPassword(password) }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id));
    // A new password signs the old sessions out.
    if (!samePassword) await db.delete(sessions).where(eq(sessions.userId, existing.id));
  }
  await db
    .update(users)
    .set({ role: "user", updatedAt: new Date() })
    .where(and(eq(users.role, "admin"), ne(users.email, email)));
}
