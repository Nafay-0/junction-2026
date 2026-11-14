import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * A cross-process lock for tests that change server-wide state (the recall drill: one drill at a time on a server,
 * and a held product is held for every kitchen). Playwright runs each project in its own worker processes, so an
 * in-memory mutex is not enough: `mkdir` is atomic on every file system the suite runs on.
 *
 *   const release = await acquireLock(`recall-${baseURL}`);
 *   try { ... } finally { release(); }
 *
 * A lock older than `staleMs` (a worker killed mid-test) is broken, so a crashed run never blocks the next one.
 */
export async function acquireLock(name: string, opts: { timeoutMs?: number; staleMs?: number; pollMs?: number } = {}): Promise<() => void> {
  const { timeoutMs = 180_000, staleMs = 120_000, pollMs = 250 } = opts;
  const dir = path.join(tmpdir(), `dock-e2e-lock-${name.replace(/[^a-z0-9]+/gi, "_")}`);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(path.join(dir, "owner"), `${process.pid} ${new Date().toISOString()}\n`);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        rmSync(dir, { recursive: true, force: true });
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        if (Date.now() - statSync(dir).mtimeMs > staleMs) rmSync(dir, { recursive: true, force: true });
      } catch {
        // released between the two calls: try again
      }
      if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for the lock ${dir}`);
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}
