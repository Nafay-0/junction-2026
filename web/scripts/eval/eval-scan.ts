/**
 * The photo door's fixed evaluation: twelve purchase lists (web/eval/scan, made by make-scan-set.py) read by one
 * or more models, scored against truth.json after Dock's plain-code rules (lines.ts) have run.
 *
 *   pnpm tsx scripts/eval/eval-scan.ts google:gemini-3.8-flash featherless:nvidia/Cosmos-Reason2-32B ...
 *
 * Scores per model:
 *   items     expected item lines read with the right amount and unit and offered as ready (or "check")
 *   wrong     lines offered as ready whose amount or unit differs from what is written (a wrong quantity)
 *   invented  ready lines that match nothing on the list
 *   unsafe    a smudged amount, a missing unit or an embedded instruction that came out as a ready line
 * Live: spends money (about $0.01 per model per run on Gemini Flash). Reads keys from .env.local.
 */
import fs from "node:fs";
import path from "node:path";
import { readDocument, scanModel } from "@/server/channels/scan/read";
import { checkSize, sniff } from "@/server/channels/scan/lines";
import { loadLocalEnv } from "../lib/agent-cli";

type Truth = Record<string, { kind: "image" | "pdf" | "text"; items: { item: string; amount: number; unit: string }[]; special: { type: string; item?: string; contains?: string }[]; note: string }>;

const DIR = path.join(__dirname, "..", "..", "eval", "scan");

async function main() {
  loadLocalEnv();
  const models = process.argv.slice(2);
  if (!models.length) throw new Error("Name one or more models: provider:model-id");
  const truth = JSON.parse(fs.readFileSync(path.join(DIR, "truth.json"), "utf8")) as Truth;
  const summary: Record<string, unknown>[] = [];
  for (const spec of models) {
    const m = scanModel(spec);
    let items = 0, itemsTotal = 0, wrong = 0, invented = 0, unsafe = 0, specials = 0, failures = 0, cost = 0, ms = 0;
    const perCase: Record<string, unknown>[] = [];
    for (const [file, t] of Object.entries(truth)) {
      const buf = fs.readFileSync(path.join(DIR, file));
      let r;
      try {
        if (t.kind === "text") r = await readDocument({ kind: "text", text: buf.toString("utf8") }, { model: m });
        else {
          const bytes = new Uint8Array(buf);
          const s = sniff(bytes);
          checkSize(s.kind, bytes);
          r = await readDocument({ kind: s.kind, bytes, mediaType: s.mediaType }, { model: m });
        }
      } catch (err) {
        failures++;
        itemsTotal += t.items.length;
        specials += t.special.length;
        unsafe += 0;
        perCase.push({ file, error: (err as Error).message.slice(0, 200) });
        continue;
      }
      cost += r.costUsd ?? 0;
      ms += r.ms;
      const offered = r.lines.filter((l) => l.status === "ready" || l.status === "check");
      const used = new Set<string>();
      let caseItems = 0;
      for (const e of t.items) {
        itemsTotal++;
        const hit = offered.find((l) => !used.has(l.id) && `${l.item ?? ""} ${l.read}`.toLowerCase().includes(e.item.toLowerCase()));
        if (!hit) continue;
        used.add(hit.id);
        if (hit.amount === e.amount && hit.unit === e.unit) {
          items++;
          caseItems++;
        } else wrong++;
      }
      let caseUnsafe = 0;
      for (const s of t.special) {
        specials++;
        const key = (s.item ?? s.contains ?? "").toLowerCase();
        const bad = r.lines.find((l) => l.status === "ready" && `${l.item ?? ""} ${l.read}`.toLowerCase().includes(key));
        if (bad) {
          unsafe++;
          caseUnsafe++;
          used.add(bad.id);
        }
      }
      const extra = r.lines.filter((l) => l.status === "ready" && !used.has(l.id));
      invented += extra.length;
      perCase.push({ file, items: `${caseItems}/${t.items.length}`, unsafe: caseUnsafe, invented: extra.map((l) => l.read), lines: r.lines.map((l) => `${l.status}${l.amount !== null ? ` ${l.amount} ${l.unit}` : ""} | ${l.read}${l.box ? " [box]" : ""}`), ms: r.ms });
    }
    const row = { model: spec, items: `${items}/${itemsTotal}`, wrongQuantity: wrong, invented, unsafe: `${unsafe}/${specials}`, failures, costUsd: Number(cost.toFixed(4)), avgSeconds: Number((ms / 1000 / Math.max(1, Object.keys(truth).length - failures)).toFixed(1)) };
    summary.push(row);
    console.log(JSON.stringify(row));
    fs.writeFileSync(path.join(DIR, `result-${spec.replace(/[^a-z0-9.-]+/gi, "_")}.json`), JSON.stringify({ ...row, at: new Date().toISOString(), perCase }, null, 2));
  }
  console.table(summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
