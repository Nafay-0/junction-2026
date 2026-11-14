/**
 * Start and stop a Dock production server (`pnpm exec next start`) from the existing `.next` build, with an
 * environment this harness controls completely:
 *
 *   - `__NEXT_PROCESSED_ENV=true` tells Next not to read `.env*` files, so `web/.env.local` (shared secrets) is NOT
 *     loaded into the app. Only what the scenario passes reaches it.
 *   - every variable name Dock knows (from `.env.example` and the source) is set to "" unless the scenario sets it,
 *     a second guard in case a future Next version ignores the flag.
 *
 * The server runs in its own process group; stop() signals that group only (never by name or port).
 * Logs go to tests-live/results/logs/<name>.log, with every value passed in the env of length >= 8 scrubbed.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, type WriteStream } from "node:fs";
import { connect } from "node:net";
import path from "node:path";

export const WEB = path.resolve(__dirname, "../../..");
export const RESULTS = path.join(WEB, "tests-live/results");
export const LOGS = path.join(RESULTS, "logs");

/** Variable names from .env.example plus ones the source reads that the example omits. Values are never read. */
export function knownVarNames(): string[] {
  const names = new Set<string>();
  try {
    for (const line of readFileSync(path.join(WEB, ".env.example"), "utf8").split("\n")) {
      const m = /^([A-Z][A-Z0-9_]*)=/.exec(line.trim());
      if (m) names.add(m[1]);
    }
  } catch {
    /* no example file */
  }
  for (const n of [
    "CONTEXT_DEV_API_KEY", "EXA_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "OPENSEARCH_URI", "DOCK_MENU_MODEL", "DOCK_MENU_PICK_MODEL",
    "DOCK_ASSISTANT_MODEL", "DOCK_INTERPRET_PER_HOUR", "DOCK_COPILOT_PG_URL", "DOCK_AIVEN_LAUNCH_TOKEN", "VALIO_LIVE", "DOCK_LIVE",
    "AIVEN_API_TOKEN", "AIVEN_READONLY_TOKEN", "DOCK_OPS_PASSCODE", "DOCK_CONNECTOR_SECRET",
  ])
    names.add(n);
  return [...names];
}

/** The base env every server gets: no secrets, no network side effects, nothing from .env.local. */
export function baseEnv(overrides: Record<string, string>): Record<string, string> {
  const keep = ["PATH", "HOME", "TMPDIR", "USER", "SHELL", "LANG", "PNPM_HOME", "NODE_PATH"];
  const env: Record<string, string> = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k]!;
  for (const n of knownVarNames()) env[n] = "";
  Object.assign(env, {
    __NEXT_PROCESSED_ENV: "true",
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    RADAR_POLL: "off",
    RADAR_STATE_FILE: "off",
    DOCK_VOICE: "off",
    DOCK_RATE_LIMITS: "off",
    DOCK_CATALOG: "seed",
    DOCK_GIT_COMMIT: "deps-test",
  });
  return Object.assign(env, overrides);
}

export type Dock = { name: string; port: number; base: string; child: ChildProcess; pid: number; logFile: string; startedMs: number; stop: () => Promise<void> };

function scrubber(env: Record<string, string>) {
  const secrets = Object.entries(env)
    .filter(([k, v]) => v && v.length >= 8 && !["PATH", "HOME", "TMPDIR", "SHELL", "NODE_OPTIONS", "PNPM_HOME"].includes(k) && !/^(DOCK_|NODE_ENV|__NEXT)/.test(k))
    .map(([, v]) => v)
    .sort((a, b) => b.length - a.length);
  return (s: string) => {
    let t = s;
    for (const v of secrets) t = t.split(v).join("***");
    return t.replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, "//***:***@").replace(/127\.0\.0\.1:\d{4,5}/g, "127.0.0.1:<port>").replace(/port: \d{4,5}/g, "port: <port>");
  };
}

export async function startDock(name: string, port: number, overrides: Record<string, string>, opts: { readyTimeoutMs?: number } = {}): Promise<Dock> {
  mkdirSync(LOGS, { recursive: true });
  if (!(await portFree(port))) throw new Error(`port ${port} is already in use; not starting ${name} (stop whatever you started there)`);
  const env = baseEnv(overrides);
  const logFile = path.join(LOGS, `${name}.log`);
  const out: WriteStream = createWriteStream(logFile, { flags: "w" });
  const scrub = scrubber(env);
  const t0 = Date.now();
  const child = spawn("pnpm", ["exec", "next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: WEB, env: env as NodeJS.ProcessEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (b) => out.write(scrub(String(b))));
  child.stderr!.on("data", (b) => out.write(scrub(String(b))));
  const base = `http://127.0.0.1:${port}`;
  let exited = false;
  child.on("exit", () => {
    exited = true;
    live.delete(child.pid!);
  });
  live.add(child.pid!);
  const stop = async () => {
    if (exited || !child.pid) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
    const deadline = Date.now() + 15_000;
    while (!exited && Date.now() < deadline) await sleep(100);
    if (!exited) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* gone */
      }
      await sleep(300);
    }
    out.end();
  };
  const deadline = Date.now() + (opts.readyTimeoutMs ?? 90_000);
  while (Date.now() < deadline) {
    if (exited) throw new Error(`server ${name} exited during start; see ${logFile}`);
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5_000) });
      if (r.status === 200 || r.status === 503) break;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  if (Date.now() >= deadline) {
    await stop();
    throw new Error(`server ${name} not ready on ${port}; see ${logFile}`);
  }
  return { name, port, base, child, pid: child.pid!, logFile, startedMs: Date.now() - t0, stop };
}

/** Process groups this harness started; killed if the runner exits or is interrupted. */
const live = new Set<number>();
const killAll = () => {
  for (const pid of live) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* gone */
    }
  }
};
process.on("exit", killAll);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.once(sig, () => {
    killAll();
    process.exit(130);
  });

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ host: "127.0.0.1", port });
    s.once("connect", () => {
      s.destroy();
      resolve(false);
    });
    s.once("error", () => resolve(true));
  });
}

export const sleep =(ms: number) => new Promise<void>((r) => setTimeout(r, ms));
