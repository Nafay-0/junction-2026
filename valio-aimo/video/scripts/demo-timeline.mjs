// The demo's timeline from the narration (src/demo/vo.json) and the edit's spacing (src/demo/edit.json).
// Mirrored in src/demo/timeline.ts (same arithmetic); used by demo-export.mjs for the captions and the script files.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const script = JSON.parse(readFileSync(join(root, "src/demo/script.json"), "utf8"));
export const vo = JSON.parse(readFileSync(join(root, "src/demo/vo.json"), "utf8"));
export const edit = JSON.parse(readFileSync(join(root, "src/demo/edit.json"), "utf8"));
export function timeline() {
  const F = edit.fps;
  let at = 0;
  const chapters = script.map((c, ci) => {
    const start = at;
    let t = start + (ci === 0 ? edit.openLead : edit.lead);
    const parts = c.parts.map((text, i) => {
      const id = `${c.id}-${i + 1}`;
      const len = Math.ceil(vo[id].seconds * F);
      const p = { id, text, start: t, len, words: vo[id].words };
      t += len + (i < c.parts.length - 1 ? edit.gap : 0) + (edit.pad[id] ?? 0);
      return p;
    });
    const end = t + edit.tail + (ci === script.length - 1 ? edit.endCard : 0);
    at = end;
    return { id: c.id, title: c.title, start, end, parts };
  });
  return { chapters, total: at };
}
