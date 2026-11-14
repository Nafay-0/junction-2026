import { adminEmail } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/server";
import { capFor } from "@/lib/db/cap";
import type { CapStatus } from "@/lib/usage-cap";

export const dynamic = "force-dynamic";

/**
 * Where the signed-in account stands against its usage limit. The interface asks when it loads
 * and after each answer, so it can stop offering what the server would refuse. The amounts go
 * only to an account that may see its usage; the others learn only whether the limit is reached.
 */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const cap = await capFor(user);
  const status: CapStatus = {
    reached: cap.reached,
    capUsd: user.showUsage ? cap.capUsd : null,
    spentUsd: user.showUsage && cap.capUsd !== null ? cap.spentUsd : null,
    adminEmail: cap.reached ? adminEmail() : null,
  };
  return Response.json(status);
}
