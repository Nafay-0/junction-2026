// Solves the holds in src/extra.json: each scene holds after its last word for at least its `min` frames, and as
// many more as put the middle of the camera move (or cut) into the next scene on a beat of the music (beats on film
// frames 1, 19, 37…: 18 frames a beat). The last scene takes what remains of the track's length (TOTAL).
// Usage: node scripts/holds.mjs
import fs from "node:fs";
const cfgPath = new URL("../src/extra.json", import.meta.url);
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const vo = JSON.parse(fs.readFileSync(new URL("../src/vo.json", import.meta.url), "utf8"));
const TOTAL = 3541;
const ids = Object.keys(cfg.min);
const base = (id) => cfg.lead + Math.ceil(vo[id].seconds * 30) + cfg.tail;
const mod = (a, n) => ((a % n) + n) % n;
let start = 0;
const extra = {};
for (let i = 0; i < ids.length - 1; i++) {
  const id = ids[i];
  const into = cfg.into[ids[i + 1]];
  // A camera move may land its middle on the half beat (9 frames); a cut lands on the beat.
  const grid = into > 12 ? 9 : 18;
  const want = mod(1 - into / 2, grid);
  let e = cfg.min[id];
  while (mod(start + base(id) + e - into, grid) !== want) e++;
  extra[id] = e;
  console.log(id.padEnd(8), "start", start, "length", base(id) + e, "hold", e);
  start += base(id) + e - into;
}
const last = ids[ids.length - 1];
extra[last] = TOTAL - start - base(last);
console.log(last.padEnd(8), "start", start, "length", base(last) + extra[last], "hold", extra[last]);
if (extra[last] < cfg.min[last]) console.log(`!! ${last} holds ${extra[last]}, under its minimum ${cfg.min[last]}`);
cfg.extra = extra;
fs.writeFileSync(cfgPath, JSON.stringify(cfg) + "\n");
