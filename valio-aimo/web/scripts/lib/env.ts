import { existsSync } from "node:fs";
import path from "node:path";

/** Scripts run outside Next.js, which is what normally reads .env.local. Values already set in the shell win. */
export function loadLocalEnv(): void {
  for (const file of [".env.local", ".env"]) {
    const p = path.resolve(process.cwd(), file);
    if (!existsSync(p)) continue;
    try {
      process.loadEnvFile(p); // does not override variables that are already set
    } catch {
      // unreadable env file: carry on with the shell environment
    }
  }
}

/** An env var, with empty strings treated as unset (the example files list every name with an empty value). */
export function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}
