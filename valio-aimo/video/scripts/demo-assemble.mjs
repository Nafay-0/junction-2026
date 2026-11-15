// A fast re-render after a few chapters change: only those chapters are rendered again (video only); every other
// chapter is cut frame-exactly from an earlier full render whose timeline was saved beside it; the narration and the
// music are rendered as one audio pass (no frames); then video and audio are joined into out/demo-raw.mp4.
//   node scripts/demo-assemble.mjs save                    keep out/demo-raw.mp4 and its timeline as the base
//   node scripts/demo-assemble.mjs c02 c03 c04 c06         re-render those chapters, reuse the rest from the base
// A chapter whose length differs from the base, or whose clips changed, must be named (the script refuses otherwise).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { timeline } from "./demo-timeline.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "out");
const baseVideo = join(out, "base-raw.mp4");
const baseTimeline = join(out, "base-timeline.json");
const args = process.argv.slice(2);
const now = timeline();
const brief = (t) => t.chapters.map((c) => ({ id: c.id, start: c.start, end: c.end }));
const run = (cmd, a) => execFileSync(cmd, a, { stdio: ["ignore", "inherit", "inherit"], cwd: root });

if (args[0] === "save") {
  copyFileSync(join(out, "demo-raw.mp4"), baseVideo);
  writeFileSync(baseTimeline, JSON.stringify(brief(now), null, 1));
  console.log("base saved:", now.total, "frames");
  process.exit(0);
}

const base = JSON.parse(readFileSync(baseTimeline, "utf8"));
const redo = new Set(args);
for (const c of now.chapters) {
  const b = base.find((x) => x.id === c.id);
  if (!redo.has(c.id) && (!b || b.end - b.start !== c.end - c.start)) throw new Error(`${c.id} changed length (${b ? b.end - b.start : "?"} -> ${c.end - c.start} frames): name it`);
}
const dir = join(out, "assemble");
mkdirSync(dir, { recursive: true });
const bundle = join(dir, "bundle");
run("npx", ["remotion", "bundle", `--out-dir=${bundle}`, "--log=error"]);
const conc = process.env.CONCURRENCY ?? "4";

const segs = [];
for (const c of now.chapters) {
  const file = join(dir, `${c.id}.mp4`);
  if (redo.has(c.id)) {
    console.log("render", c.id, c.start, c.end - 1);
    run("npx", ["remotion", "render", bundle, "Demo", file, `--frames=${c.start}-${c.end - 1}`, "--muted", "--codec=h264", "--crf=16", "--jpeg-quality=92", `--concurrency=${conc}`, "--log=error"]);
  } else {
    const b = base.find((x) => x.id === c.id);
    console.log("reuse", c.id, "from base frames", b.start, b.end - 1);
    run("ffmpeg", ["-y", "-loglevel", "error", "-i", baseVideo, "-an", "-vf", `trim=start_frame=${b.start}:end_frame=${b.end},setpts=PTS-STARTPTS`, "-c:v", "libx264", "-preset", "fast", "-crf", "14", "-pix_fmt", "yuv420p", file]);
  }
  segs.push(file);
}
console.log("join video");
const video = join(dir, "video.mp4");
const inputs = segs.flatMap((f) => ["-i", f]);
run("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", `${segs.map((_, i) => `[${i}:v]`).join("")}concat=n=${segs.length}:v=1:a=0[v]`, "-map", "[v]", "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", "-r", "30", video]);
console.log("render audio");
const audio = join(dir, "audio.wav");
run("npx", ["remotion", "render", bundle, "Demo", audio, "--codec=wav", "--log=error"]);
run("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest", join(out, "demo-raw.mp4")]);
const frames = Number(execFileSync("ffprobe", ["-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", join(out, "demo-raw.mp4")], { encoding: "utf8" }));
console.log("assembled", frames, "frames; timeline", now.total);
if (!existsSync(join(out, "demo-raw.mp4")) || Math.abs(frames - now.total) > 2) throw new Error("frame count mismatch");
