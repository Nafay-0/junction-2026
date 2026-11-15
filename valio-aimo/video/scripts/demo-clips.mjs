// Lists the capture session's clips (public/demo-clips -> the shared clips folder) into src/demo/clips.json:
// per clip its measured length, its line and its events (seconds in the clip's own time). Run before each render.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "public/demo-clips");
const out = {};
const files = (sub) => (existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).filter((x) => x.endsWith(".mp4")).sort().map((x) => (sub ? `${sub}/${x}` : x)) : []);
// Earlier takes the capture session moved aside stay usable as "previous/<name>".
for (const f of [...files(""), ...files("previous")]) {
  const name = f.replace(/\.mp4$/, "");
  const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", join(dir, f)], { encoding: "utf8" });
  let seconds = 0, size = "";
  try { const j = JSON.parse(probe.stdout); seconds = Number(j.format.duration); size = `${j.streams[0].width}x${j.streams[0].height}@${j.streams[0].r_frame_rate}`; } catch {}
  let meta = {};
  try { meta = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")); } catch {}
  const events = {};
  for (const e of meta.events ?? []) if (!(e.name in events)) events[e.name] = e.t;
  out[name] = { seconds: Math.round(seconds * 1000) / 1000, size, chapter: meta.chapter ?? name.slice(0, 3), what: meta.what ?? "", events };
}
writeFileSync(join(root, "src/demo/clips.json"), JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) console.log(k, v.seconds, v.size, Object.keys(v.events).length, "events", "|", v.what);
console.log(Object.keys(out).length, "clips");
