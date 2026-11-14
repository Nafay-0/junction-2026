// Package the desktop app as a real application.
//
//   pnpm desktop:pack       the app for this computer only, to try it:
//                             desktop/release/build/Beryl-<platform>-<arch>/
//                           (with `--keep`, `pnpm desktop:release` leaves all three apps there too)
//   pnpm desktop:release    everything the website offers, in desktop/release/downloads/:
//                             Beryl-mac-apple-silicon.dmg   Macs with Apple silicon
//                             Beryl-mac-intel.dmg           Macs with an Intel processor
//                             Beryl-windows.zip             Windows 10 and 11, 64-bit
//                             manifest.json                 for each: size, SHA-256, when it was built, the server it points at
//                           `--only=mac-arm64,windows-x64` builds some of them (the ids are in src/lib/downloads.ts).
//
// The app holds only the shell (window, bridge, engine) and the two packages the engine needs.
// The interface is not inside it: the app loads it from Beryl's server, so a new version of the
// interface needs no new download.
//
// WHERE THE SERVER IS. Say it when packaging, and it is written into the app (config.json):
//
//   BERYL_SERVER_URL=https://beryl.example.com pnpm desktop:release
//
// That is how the real downloads are made, by hand or in CI. Without it the app looks for a
// server on the same computer (http://localhost:3000), which is only right for trying a build
// here. Whatever was baked in, a person can change it on the app's own "cannot reach the server"
// page, and BERYL_URL in the environment overrides both for one run.
//
// WHAT RUNS WHERE. All three are made from a Mac: the Windows app needs no Windows tool, because
// the packager writes the icon and the version into Beryl.exe with its own code. The two disk
// images need macOS (hdiutil, iconutil), so on another system only the Windows app is built.
//
// The result is not signed with a developer certificate and not notarised. macOS and Windows both
// warn about that the first time the app is opened; what a person does then is written down in
// src/lib/downloads.ts, and the website shows it.
import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEngine } from "./build.mjs";
// The names of the files are decided in one place, where the website reads them too.
import { DOWNLOADS } from "../src/lib/downloads.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, "..");
const release = path.join(here, "release");
/*
 * The apps are put together in a temporary folder of the system's, not in this one, for two
 * reasons. Packaging then never touches a copy of the app that is open from here. And a project
 * kept in a synced folder (Documents with iCloud, for one) has marks attached to its folders by
 * the system; on an app bundle such a mark breaks its signature ("detritus not allowed"), and a
 * Mac refuses a downloaded app whose signature does not hold.
 */
const work = mkdtempSync(path.join(os.tmpdir(), "beryl-pack-"));
const built = path.join(work, "build");
const kept = path.join(release, "build");
const downloads = path.join(release, "downloads");
const stage = path.join(work, "stage");
process.on("exit", () => rmSync(work, { recursive: true, force: true }));
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(path.join(web, "package.json"), "utf8"));
const electronVersion = JSON.parse(readFileSync(require.resolve("electron/package.json"), "utf8")).version;

/** What each download is built for. */
const TARGETS = {
  "mac-arm64": { platform: "darwin", arch: "arm64" },
  "mac-x64": { platform: "darwin", arch: "x64" },
  "windows-x64": { platform: "win32", arch: "x64" },
};

/** The address to bake in: an http(s) origin, or nothing. A typo here would ship an app that cannot find its server. */
function serverAddress() {
  const given = process.env.BERYL_SERVER_URL?.trim();
  if (!given) return "";
  let url;
  try {
    url = new URL(given);
  } catch {
    throw new Error(`BERYL_SERVER_URL is not an address: ${given}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`BERYL_SERVER_URL must start with https:// (or http:// for a server on this network): ${given}`);
  if (url.protocol === "http:" && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)) console.warn(`Note: ${url.origin} is not https. Sign-ins would travel unprotected; use it only on a network you trust.`);
  return url.origin;
}

/** The files the app is made of, in one folder the packager copies from. */
function makeStage(serverUrl) {
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(path.join(stage, "dist"), { recursive: true });
  for (const file of ["main.cjs", "preload.cjs", "relay.cjs", "offline.html", "icon.png"]) cpSync(path.join(here, file), path.join(stage, file));
  cpSync(path.join(here, "dist/engine.cjs"), path.join(stage, "dist/engine.cjs"));
  writeFileSync(path.join(stage, "config.json"), JSON.stringify({ serverUrl }, null, 2));
  writeFileSync(path.join(stage, "package.json"), JSON.stringify({ name: "beryl", productName: "Beryl", version: pkg.version, description: "Beryl, your internet butler", main: "main.cjs" }, null, 2));
  // The engine loads these two at run time (Playwright ships files it reads from disk; ws is the bridge's socket).
  for (const name of ["playwright-core", "ws"]) {
    cpSync(realpathSync(path.dirname(require.resolve(`${name}/package.json`))), path.join(stage, "node_modules", name), { recursive: true, dereference: true });
  }
}

/** macOS wants its own icon format, made from the same picture. Needs macOS's own tools. */
function macIcon() {
  const set = path.join(work, "Beryl.iconset");
  const icns = path.join(work, "Beryl.icns");
  rmSync(set, { recursive: true, force: true });
  mkdirSync(set, { recursive: true });
  const picture = path.join(here, "icon.png");
  for (const size of [16, 32, 128, 256, 512]) {
    execFileSync("sips", ["-z", String(size), String(size), picture, "--out", path.join(set, `icon_${size}x${size}.png`)], { stdio: "ignore" });
    execFileSync("sips", ["-z", String(size * 2), String(size * 2), picture, "--out", path.join(set, `icon_${size}x${size}@2x.png`)], { stdio: "ignore" });
  }
  execFileSync("iconutil", ["-c", "icns", set, "-o", icns]);
  rmSync(set, { recursive: true, force: true });
  return icns;
}

/** The app for one kind of computer, as a folder under desktop/release/build/. */
async function packageFor({ platform, arch }) {
  const icon = platform === "darwin" ? macIcon() : platform === "win32" ? path.join(here, "icon.ico") : path.join(here, "icon.png");
  const [out] = await packager({
    dir: stage,
    name: "Beryl",
    out: built,
    overwrite: true,
    platform,
    arch,
    icon,
    appVersion: pkg.version,
    buildVersion: pkg.version,
    appBundleId: "app.beryl.desktop",
    appCategoryType: "public.app-category.productivity",
    // macOS asks the user before an app may listen: this is what the question says.
    extendInfo: { NSMicrophoneUsageDescription: "Beryl listens when you use voice input or start a live call, so you can talk to it instead of typing." },
    // What Windows shows for the file: its name and who it is from.
    win32metadata: { CompanyName: "Beryl", FileDescription: "Beryl", ProductName: "Beryl", InternalName: "Beryl", OriginalFilename: "Beryl.exe" },
    electronVersion,
    asar: false,
    prune: false,
    quiet: true,
  });
  if (platform === "darwin") sealMac(path.join(out, "Beryl.app"));
  return out;
}

/**
 * A Mac app has to carry a signature that matches its contents, or macOS calls it damaged and an
 * Apple silicon Mac will not start it at all. Without a developer certificate that is an "ad hoc"
 * signature: it says nothing about who made the app, only that it is whole. The packager leaves
 * one in place; if it ever does not, one is made here.
 */
function sealMac(appPath) {
  // Nothing may be attached to the bundle itself (see above); what the system will not let go of, it ignores.
  try {
    execFileSync("xattr", ["-c", appPath], { stdio: "ignore" });
  } catch {
    /* nothing to clear */
  }
  try {
    execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "ignore" });
  } catch {
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "ignore" });
    execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "ignore" });
  }
}

/** Leave a packaged app where it can be tried: desktop/release/build/. An app that is open from there is not replaced. */
function keep(appFolder) {
  const target = path.join(kept, path.basename(appFolder));
  mkdirSync(kept, { recursive: true });
  rmSync(target, { recursive: true, force: true });
  if (process.platform === "darwin") execFileSync("ditto", [appFolder, target]);
  else cpSync(appFolder, target, { recursive: true, verbatimSymlinks: true });
  return target;
}

/** A disk image that opens to the app and a shortcut to Applications: drag one onto the other. */
function makeDmg(appFolder, target) {
  const tray = path.join(work, "dmg");
  rmSync(tray, { recursive: true, force: true });
  mkdirSync(tray, { recursive: true });
  // ditto keeps everything a Mac app is made of (links inside its frameworks, its signature) as it is.
  execFileSync("ditto", [path.join(appFolder, "Beryl.app"), path.join(tray, "Beryl.app")]);
  symlinkSync("/Applications", path.join(tray, "Applications"));
  rmSync(target, { force: true });
  execFileSync("hdiutil", ["create", "-volname", "Beryl", "-srcfolder", tray, "-fs", "HFS+", "-format", "UDZO", "-imagekey", "zlib-level=9", "-ov", target], { stdio: "ignore" });
  rmSync(tray, { recursive: true, force: true });
}

/** A zip that unpacks to one folder, Beryl, with Beryl.exe in it. */
function makeZip(appFolder, target) {
  const tray = path.join(work, "zip");
  rmSync(tray, { recursive: true, force: true });
  mkdirSync(tray, { recursive: true });
  renameSync(appFolder, path.join(tray, "Beryl"));
  rmSync(target, { force: true });
  try {
    // Windows has no zip command, but its tar writes zip files; everywhere else zip is there.
    if (process.platform === "win32") execFileSync("tar", ["-a", "-c", "-f", target, "Beryl"], { cwd: tray, stdio: "ignore" });
    else execFileSync("zip", ["-r", "-X", "-q", target, "Beryl"], { cwd: tray, stdio: "ignore" });
  } finally {
    renameSync(path.join(tray, "Beryl"), appFolder);
    rmSync(tray, { recursive: true, force: true });
  }
}

const sha256 = (file) =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/* ───────────── Run ───────────── */

const all = process.argv.includes("--all");
const keepApps = process.argv.includes("--keep");
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length).split(",").filter(Boolean);
const serverUrl = serverAddress();
const pointsAt = serverUrl || "this computer (http://localhost:3000), unless changed in the app";

await buildEngine();
makeStage(serverUrl);

if (!all && !only) {
  // Just this computer.
  const out = keep(await packageFor({ platform: process.platform, arch: process.arch }));
  console.log(`Packaged: ${path.relative(web, out)}  (server: ${pointsAt})`);
} else {
  const wanted = DOWNLOADS.filter((d) => !only || only.includes(d.id));
  const unknown = (only ?? []).filter((id) => !DOWNLOADS.some((d) => d.id === id));
  if (unknown.length) throw new Error(`No such download: ${unknown.join(", ")}. The ids are ${DOWNLOADS.map((d) => d.id).join(", ")}.`);
  mkdirSync(downloads, { recursive: true });
  const made = [];
  for (const download of wanted) {
    const target = TARGETS[download.id];
    if (target.platform === "darwin" && process.platform !== "darwin") {
      console.log(`Skipped ${download.file}: a Mac disk image can only be made on a Mac.`);
      continue;
    }
    const folder = await packageFor(target);
    const file = path.join(downloads, download.file);
    if (target.platform === "darwin") makeDmg(folder, file);
    else makeZip(folder, file);
    const size = statSync(file).size;
    if (keepApps) keep(folder);
    made.push({ id: download.id, file: download.file, os: download.os, arch: target.arch, size, sha256: await sha256(file), builtAt: new Date().toISOString(), serverUrl: serverUrl || null });
    console.log(`Built ${download.file}  ${megabytes(size)}`);
  }
  // What was built before and not this time stays listed, as long as the file is still there.
  const manifestFile = path.join(downloads, "manifest.json");
  let earlier = [];
  try {
    earlier = JSON.parse(readFileSync(manifestFile, "utf8")).files.filter((f) => !made.some((b) => b.id === f.id) && existsSync(path.join(downloads, f.file)));
  } catch {
    /* no manifest yet */
  }
  const files = [...earlier, ...made].sort((a, b) => DOWNLOADS.findIndex((d) => d.id === a.id) - DOWNLOADS.findIndex((d) => d.id === b.id));
  // Each file says when it was built and which server it points at: a later run may rebuild only some of them.
  writeFileSync(manifestFile, JSON.stringify({ name: "Beryl", version: pkg.version, electron: electronVersion, files }, null, 2));
  console.log(`\n${made.length} of ${wanted.length} built, in ${path.relative(web, downloads)}  (server: ${pointsAt})`);
}
