import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

// The database address lives with the other keys, one level up in exa/.env.local.
const sharedEnv = resolve(process.cwd(), "../.env.local");
if (!process.env.DATABASE_URL && existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

/**
 * The tables are described in src/lib/db/schema.ts. After changing them, run `pnpm db:generate`:
 * it writes the next SQL file into drizzle/, which is committed. The files are applied by
 * `pnpm db:migrate` and by the server itself when it starts.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
});
