// Draw the app's icons from the logo's shapes (src/lib/brand.ts), so they cannot drift:
//   desktop/icon.png        the desktop app's icon (1024 px, with the margin macOS icons have)
//   public/icon-192.png     the installed web app's icons
//   public/icon-512.png
//   public/icon-maskable.png  the same on a full square, for phones that cut their own shape
//   desktop/icon.ico        the Windows app's icon, made from public/icon-512.png (no margin: Windows icons fill their square)
// Run after changing the logo: pnpm icons   (it uses Electron to draw them)
// `pnpm icons ico` only remakes desktop/icon.ico from the picture that is already there.
const { app, BrowserWindow, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const web = path.join(__dirname, "..");

/**
 * A Windows icon file. It is a small table of sizes followed by the pictures themselves, and each
 * picture may simply be a PNG, so nothing but the sizes has to be worked out here.
 */
function writeIco() {
  const source = nativeImage.createFromPath(path.join(web, "public/icon-512.png"));
  if (source.isEmpty()) throw new Error("public/icon-512.png is missing: draw the icons first (pnpm icons).");
  const pictures = [16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: source.resize({ width: size, height: size, quality: "best" }).toPNG() }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // an icon, not a cursor
  header.writeUInt16LE(pictures.length, 4);
  let offset = header.length + 16 * pictures.length;
  const table = pictures.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    // One byte each for width and height, where 0 stands for 256.
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  fs.writeFileSync(path.join(web, "desktop/icon.ico"), Buffer.concat([header, ...table, ...pictures.map((p) => p.png)]));
  console.log("made", "desktop/icon.ico", pictures.map((p) => p.size).join(", "), "px");
}
const brand = fs.readFileSync(path.join(web, "src/lib/brand.ts"), "utf8");
const facets = [...brand.matchAll(/\{ d: "([^"]+)", opacity: ([\d.]+) \}/g)].map((m) => ({ d: m[1], opacity: Number(m[2]) }));
const table = brand.match(/table: "([^"]+)"/)[1];
const tile = brand.match(/tile: "([^"]+)"/)[1];
const ink = brand.match(/ink: "([^"]+)"/)[1];
if (facets.length !== 6) throw new Error("Could not read the logo's shapes from src/lib/brand.ts");

const mark = facets.map((f) => `<path d="${f.d}" fill="${ink}" opacity="${f.opacity}"/>`).join("") + `<path d="${table}" fill="${ink}"/>`;
/** `inset`: the margin round the tile, as a share of the picture. `radius`: the tile's corners, in the logo's 32-unit box. `scale`: the mark's size inside the tile. */
const svg = ({ inset, radius, scale }) => {
  const side = 32 / (1 - 2 * inset);
  const offset = (side - 32) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}"><g transform="translate(${offset} ${offset})"><rect width="32" height="32" rx="${radius}" fill="${tile}"/><g transform="translate(16 16) scale(${scale}) translate(-16 -16)">${mark}</g></g></svg>`;
};

const ICONS = [
  { file: "desktop/icon.png", size: 1024, art: { inset: 0.1, radius: 7.2, scale: 1 } },
  { file: "public/icon-192.png", size: 192, art: { inset: 0, radius: 7.2, scale: 1 } },
  { file: "public/icon-512.png", size: 512, art: { inset: 0, radius: 7.2, scale: 1 } },
  { file: "public/icon-maskable.png", size: 512, art: { inset: 0, radius: 0, scale: 0.78 } },
];

app.whenReady().then(async () => {
  if (process.argv.includes("ico")) {
    writeIco();
    app.exit(0);
    return;
  }
  // Every icon is drawn large in one hidden window and scaled down to its size.
  const os = require("node:os");
  const sheet = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "beryl-icons-")), "icon.html");
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  for (const icon of ICONS) {
    fs.writeFileSync(sheet, `<!doctype html><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:100vw;height:100vh}</style>${svg(icon.art)}`);
    await win.loadFile(sheet);
    await new Promise((r) => setTimeout(r, 350));
    const image = (await win.webContents.capturePage()).resize({ width: icon.size, height: icon.size, quality: "best" });
    fs.writeFileSync(path.join(web, icon.file), image.toPNG());
    console.log("drew", icon.file, `${icon.size} px`);
  }
  fs.rmSync(path.dirname(sheet), { recursive: true, force: true });
  writeIco();
  app.exit(0);
});
