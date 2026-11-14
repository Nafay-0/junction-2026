// Start Beryl as a desktop app: pnpm desktop
//
// Builds the app's browser engine, makes sure a server is running, then opens the app window on
// it. With nothing set, that is a server on this computer (started here if it is not up yet,
// BERYL_PORT picks the port, default 3000). BERYL_URL points the app at a server that is already
// running anywhere: `BERYL_URL=https://beryl.example.com pnpm desktop`.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEngine } from "./build.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, "..");
const port = process.env.BERYL_PORT || "3000";
const url = process.env.BERYL_URL || `http://localhost:${port}`;
const up = async () => {
  try {
    // Signed out, the server answers with the sign-in page: any answer means it is up.
    return (await fetch(url, { signal: AbortSignal.timeout(2500), redirect: "manual" })).status < 500;
  } catch {
    return false;
  }
};

await buildEngine();

let server;
if (!process.env.BERYL_URL && !(await up())) {
  console.log(`Starting Beryl's server on ${url} ...`);
  server = spawn("pnpm", ["exec", "next", "dev", "--port", port], { cwd: web, stdio: "inherit" });
  const deadline = Date.now() + 90_000;
  while (!(await up())) {
    if (Date.now() > deadline || server.exitCode !== null) {
      console.error("The server did not start.");
      server.kill();
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

const electron = createRequire(import.meta.url)("electron");
const app = spawn(electron, [path.join(here, "main.cjs")], { stdio: "inherit", env: { ...process.env, BERYL_URL: url } });
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
