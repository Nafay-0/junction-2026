// Package the desktop app as a real application: pnpm desktop:pack
//
//   desktop/release/Beryl-<platform>-<arch>/Beryl.app (or Beryl.exe, or the Linux folder)
//
// The app holds only the shell (window, bridge, engine) and the two packages the engine needs.
// The interface is not inside it: the app loads it from Beryl's server. Say where that is with
// BERYL_SERVER_URL when packaging (`BERYL_SERVER_URL=https://beryl.example.com pnpm desktop:pack`);
// without it the app looks for a server on the same computer, and anyone can change the address
// on the app's own "cannot reach the server" page.
//
// The result is not signed or notarised: on another Mac it opens with right-click, Open, the first time.
import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEngine } from "./build.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, "..");
const release = path.join(here, "release");
const stage = path.join(release, "stage");
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(path.join(web, "package.json"), "utf8"));

await buildEngine();

rmSync(stage, { recursive: true, force: true });
mkdirSync(path.join(stage, "dist"), { recursive: true });
for (const file of ["main.cjs", "preload.cjs", "relay.cjs", "offline.html", "icon.png"]) cpSync(path.join(here, file), path.join(stage, file));
cpSync(path.join(here, "dist/engine.cjs"), path.join(stage, "dist/engine.cjs"));
writeFileSync(path.join(stage, "config.json"), JSON.stringify({ serverUrl: process.env.BERYL_SERVER_URL ?? "" }, null, 2));
writeFileSync(path.join(stage, "package.json"), JSON.stringify({ name: "beryl", productName: "Beryl", version: pkg.version, description: "Beryl, your internet butler", main: "main.cjs" }, null, 2));
// The engine loads these two at run time (Playwright ships files it reads from disk; ws is the bridge's socket).
for (const name of ["playwright-core", "ws"]) {
  cpSync(realpathSync(path.dirname(require.resolve(`${name}/package.json`))), path.join(stage, "node_modules", name), { recursive: true, dereference: true });
}

// macOS wants its own icon format, made from the same picture.
let icon = path.join(here, "icon.png");
if (process.platform === "darwin") {
  const set = path.join(release, "Beryl.iconset");
  rmSync(set, { recursive: true, force: true });
  mkdirSync(set, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    execFileSync("sips", ["-z", String(size), String(size), icon, "--out", path.join(set, `icon_${size}x${size}.png`)], { stdio: "ignore" });
    execFileSync("sips", ["-z", String(size * 2), String(size * 2), icon, "--out", path.join(set, `icon_${size}x${size}@2x.png`)], { stdio: "ignore" });
  }
  execFileSync("iconutil", ["-c", "icns", set, "-o", path.join(release, "Beryl.icns")]);
  rmSync(set, { recursive: true, force: true });
  icon = path.join(release, "Beryl.icns");
}

const [out] = await packager({
  dir: stage,
  name: "Beryl",
  out: release,
  overwrite: true,
  platform: process.platform,
  arch: process.arch,
  icon,
  appBundleId: "app.beryl.desktop",
  appCategoryType: "public.app-category.productivity",
  electronVersion: JSON.parse(readFileSync(require.resolve("electron/package.json"), "utf8")).version,
  asar: false,
  prune: false,
  quiet: true,
});
rmSync(stage, { recursive: true, force: true });
console.log(`Packaged: ${path.relative(web, out)}${process.env.BERYL_SERVER_URL ? `  (server: ${process.env.BERYL_SERVER_URL})` : "  (server: this computer, port 3000, unless changed in the app)"}`);
