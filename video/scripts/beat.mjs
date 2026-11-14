// Estimates a track's tempo and the time of its beats from its onset envelope, and prints its loudness shape.
// node scripts/beat.mjs public/music/bed-1.mp3
import { execFileSync } from "node:child_process";
const SR = 11025;
const HOP = 128; // 11.6 ms
export function analyse(file) {
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-i", file, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  const x = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const n = Math.floor(x.length / HOP);
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < HOP; k++) { const v = x[i * HOP + k]; s += v * v; } e[i] = Math.sqrt(s / HOP); }
  const flux = new Float32Array(n);
  for (let i = 1; i < n; i++) flux[i] = Math.max(0, e[i] - e[i - 1]);
  const fps = SR / HOP;
  let best = { bpm: 0, score: -1 };
  for (let bpm = 70; bpm <= 140; bpm += 0.25) {
    const lag = (60 / bpm) * fps;
    let s = 0;
    for (let i = 0; i + 4 * lag < n; i++) { const a = flux[i]; if (a === 0) continue; s += a * (flux[Math.round(i + lag)] + flux[Math.round(i + 2 * lag)] + 0.5 * flux[Math.round(i + 4 * lag)]); }
    if (s > best.score) best = { bpm, score: s };
  }
  const period = (60 / best.bpm) * fps;
  let phase = 0, top = -1;
  for (let p = 0; p < period; p += 0.5) { let s = 0; for (let t = p; t < n; t += period) s += flux[Math.round(t)] ?? 0; if (s > top) (top = s), (phase = p); }
  const rms = [];
  for (let t = 0; t < n; t += Math.round(5 * fps)) { let s = 0, c = 0; for (let i = t; i < Math.min(n, t + Math.round(5 * fps)); i++) (s += e[i] * e[i]), c++; rms.push(Math.round(20 * Math.log10(Math.sqrt(s / c) + 1e-9))); }
  const tail = [];
  for (let k = 6; k >= 1; k--) { const a = n - Math.round(k * 0.5 * fps), b = n - Math.round((k - 1) * 0.5 * fps); let s = 0; for (let i = a; i < b; i++) s += e[i] * e[i]; tail.push(Math.round(20 * Math.log10(Math.sqrt(s / (b - a)) + 1e-9))); }
  return { bpm: best.bpm, firstBeat: phase / fps, seconds: x.length / SR, rmsPer5s: rms, lastThreeSeconds: tail };
}
if (process.argv[2]) for (const f of process.argv.slice(2)) { const a = analyse(f); console.log(f.split("/").pop(), "bpm", a.bpm, "first beat", a.firstBeat.toFixed(3), "s | dB per 5 s:", a.rmsPer5s.join(" "), "| last 3 s (0.5 s steps):", a.lastThreeSeconds.join(" ")); }
