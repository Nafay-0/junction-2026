/**
 * Turn raw model output (.art-raw/<key>.png) into web assets in public/art/:
 *   <key>-<width>.avif and <key>-<width>.webp
 * Tiles: 240, 480, 720 (square). Departments and hero: 768, 1152, 1536 wide, keeping the
 * generated aspect. Quality is searched per image so the reference size stays under budget
 * (480 px tile WebP <= 35 kB, 1536 px header <= 140 kB), then reused for the other widths.
 * Also writes src/app/_ui/art-manifest.json (kind, widths, aspect w/h, average colour).
 *
 *   pnpm tsx scripts/art/compress.ts [--only key1,key2]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..", "..");
const RAW_DIR = join(WEB, ".art-raw");
const OUT_DIR = join(WEB, "public", "art");
const MANIFEST = join(WEB, "src", "app", "_ui", "art-manifest.json");
const PROMPTS = join(HERE, "prompts.json");

type Kind = "tile" | "department" | "hero";
type ManifestEntry = { kind: Kind; widths: number[]; aspect: number; color: string };

const WIDTHS: Record<Kind, number[]> = {
  tile: [240, 480, 720],
  department: [768, 1152, 1536],
  hero: [768, 1152, 1536],
};
// Byte budget at the reference width (the middle tile size, the largest header size).
const REF: Record<Kind, { width: number; bytes: number }> = {
  tile: { width: 480, bytes: 34_000 },
  department: { width: 1536, bytes: 138_000 },
  hero: { width: 1536, bytes: 138_000 },
};
const WEBP_Q = [82, 78, 74, 70, 66, 62, 58, 54, 50];
const AVIF_Q = [62, 58, 54, 50, 46, 42, 38];

async function encode(src: Buffer, width: number, height: number, fmt: "webp" | "avif", q: number) {
  const img = sharp(src).resize(width, height, { fit: "cover", kernel: "lanczos3" });
  return fmt === "webp"
    ? img.webp({ quality: q, effort: 6, smartSubsample: true }).toBuffer()
    : img.avif({ quality: q, effort: 5, chromaSubsampling: "4:2:0" }).toBuffer();
}

async function pickQuality(src: Buffer, w: number, h: number, fmt: "webp" | "avif", budget: number) {
  const ladder = fmt === "webp" ? WEBP_Q : AVIF_Q;
  for (const q of ladder) {
    const buf = await encode(src, w, h, fmt, q);
    if (buf.length <= budget) return q;
  }
  return ladder[ladder.length - 1];
}

const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");

async function main() {
  const a = process.argv.slice(2);
  const onlyIdx = a.indexOf("--only");
  const only = onlyIdx >= 0 ? new Set(a[onlyIdx + 1].split(",").map((s) => s.trim())) : null;
  const prompts = JSON.parse(readFileSync(PROMPTS, "utf8")) as { images: Record<string, { kind: Kind }> };
  mkdirSync(OUT_DIR, { recursive: true });

  const manifest: Record<string, ManifestEntry> = existsSync(MANIFEST)
    ? JSON.parse(readFileSync(MANIFEST, "utf8"))
    : {};

  const raws = existsSync(RAW_DIR) ? readdirSync(RAW_DIR).filter((f) => /\.(png|webp|jpe?g)$/.test(f)) : [];
  for (const file of raws.sort()) {
    const key = file.replace(/\.[^.]+$/, "");
    if (only && !only.has(key)) continue;
    const kind = prompts.images[key]?.kind;
    if (!kind) {
      console.warn(`  skip ${file}: no entry in prompts.json`);
      continue;
    }
    const src = readFileSync(join(RAW_DIR, file));
    const meta = await sharp(src).metadata();
    const aspect = (meta.width ?? 1) / (meta.height ?? 1);
    const heightFor = (w: number) => Math.round(w / aspect);

    const ref = REF[kind];
    const qWebp = await pickQuality(src, ref.width, heightFor(ref.width), "webp", ref.bytes);
    const qAvif = await pickQuality(src, ref.width, heightFor(ref.width), "avif", Math.round(ref.bytes * 0.8));

    const sizes: string[] = [];
    for (const w of WIDTHS[kind]) {
      for (const [fmt, q] of [["avif", qAvif], ["webp", qWebp]] as const) {
        const buf = await encode(src, w, heightFor(w), fmt, q);
        writeFileSync(join(OUT_DIR, `${key}-${w}.${fmt}`), buf);
        sizes.push(`${w}.${fmt}=${(buf.length / 1024).toFixed(0)}k`);
      }
    }

    const { channels } = await sharp(src).removeAlpha().stats();
    const color = `#${hex(channels[0].mean)}${hex(channels[1].mean)}${hex(channels[2].mean)}`;
    manifest[key] = { kind, widths: WIDTHS[kind], aspect: Math.round(aspect * 10000) / 10000, color };
    console.log(`  ${key}  webp q${qWebp} avif q${qAvif}  ${color}  ${sizes.join(" ")}`);
  }

  const sorted = Object.fromEntries(Object.keys(manifest).sort().map((k) => [k, manifest[k]]));
  writeFileSync(MANIFEST, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`manifest: ${Object.keys(sorted).length} entries -> ${MANIFEST}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
