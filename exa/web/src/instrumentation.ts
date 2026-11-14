/**
 * Runs once when the server starts, before it takes requests: bring the database's tables up to
 * date and make sure the admin account from the environment exists. If the database is missing
 * or away, the reason is logged once and the server still starts: the sign-in page then says
 * what is wrong, and the next request tries again.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { databaseReady } = await import("@/lib/db/start");
  await databaseReady();
}
