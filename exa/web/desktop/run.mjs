// Start Baton as a desktop app: pnpm desktop
//
// Makes sure the interface's server is running (starting it if it is not), then opens the app
// window on it. BATON_PORT picks the port (default 3000); BATON_URL points at a server that is
// already running somewhere on this computer.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, "..");
const port = process.env.BATON_PORT || "3000";
const url = process.env.BATON_URL || `http://localhost:${port}`;
const up = async () => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
};

let server;
if (!(await up())) {
  if (process.env.BATON_URL) {
    console.error(`Nothing answers at ${url}. Start the app's server first, or leave BATON_URL unset to have it started for you.`);
    process.exit(1);
  }
  console.log(`Starting the interface on ${url} ...`);
  server = spawn("pnpm", ["exec", "next", "dev", "--port", port], { cwd: web, stdio: "inherit" });
  const deadline = Date.now() + 90_000;
  while (!(await up())) {
    if (Date.now() > deadline || server.exitCode !== null) {
      console.error("The interface did not start.");
      server.kill();
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

const electron = createRequire(import.meta.url)("electron");
const app = spawn(electron, [path.join(here, "main.cjs")], { stdio: "inherit", env: { ...process.env, BATON_URL: url } });
const stop = () => {
  app.kill();
  server?.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
app.on("exit", (code) => {
  server?.kill();
  process.exit(code ?? 0);
});
