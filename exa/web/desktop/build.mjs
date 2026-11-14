// Build the desktop app's browser engine: the TypeScript in src/lib/browser (the same guard and
// page reader the tests cover) bundled into one file the app's main process can load.
// Run by `pnpm desktop` and `pnpm test:desktop`; also: node desktop/build.mjs
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, "..");

export async function buildEngine() {
  await build({
    entryPoints: [path.join(web, "src/lib/browser/engine.ts")],
    outfile: path.join(here, "dist/engine.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    // Loaded from node_modules at run time: Playwright ships files it reads from disk.
    external: ["playwright-core", "electron"],
    tsconfig: path.join(web, "tsconfig.json"),
    logLevel: "warning",
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildEngine();
