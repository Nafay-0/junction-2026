import { existsSync } from "node:fs";
import { join } from "node:path";

/** Load web/.env.local (then .env) into process.env without overriding what is already set. Values are never printed. */
export function loadLocalEnv(dir = process.cwd()): void {
  for (const f of [".env.local", ".env"]) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    try {
      process.loadEnvFile(p);
    } catch {
      // a malformed file is skipped; the scripts say which key is missing instead
    }
  }
}

/** The value after a flag, e.g. flag(args, "--model"). */
export function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
