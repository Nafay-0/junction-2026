// Bring the database up to date: pnpm db:migrate
//
// Applies the SQL files in drizzle/ that the database has not seen yet. The server does the same
// when it starts; this is for doing it by hand, or as a step of a deployment. It reads
// DATABASE_URL from the environment, or from exa/.env.local when it is not set.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "../src/lib/db/migrate.ts";

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedEnv = path.join(web, "..", ".env.local");
if (!process.env.DATABASE_URL && existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is not set. Add it to exa/.env.local (see .env.example).");
  process.exit(1);
}

const where = (() => {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "the database";
  }
})();

try {
  await runMigrations(url, path.join(web, "drizzle"));
  console.log(`The database at ${where} is up to date.`);
} catch (err) {
  console.error(`Could not bring ${where} up to date: ${err?.cause?.message ?? err?.message ?? err}`);
  process.exit(1);
}
