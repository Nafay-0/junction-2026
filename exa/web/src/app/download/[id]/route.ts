import { openAsBlob } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { DOWNLOADS, isDownloadId, type DownloadManifest } from "@/lib/downloads";

export const dynamic = "force-dynamic";

/*
 * The desktop app's downloads. Anyone may fetch them, signed in or not.
 *
 *   /download/mac-arm64   /download/mac-x64   /download/windows-x64   the files
 *   /download/manifest                                                  what was built: version, sizes, checksums
 *
 * Where the files are: if BERYL_DOWNLOADS_URL is set (a public bucket, say), the visitor is sent
 * on to `<that address>/<file name>`. Otherwise they are served from this server's own
 * desktop/release/downloads/, where `pnpm desktop:release` puts them.
 *
 * Only the files named in src/lib/downloads.ts can be reached. The id in the address is looked
 * up in that list and never used as a path, so nothing else on the disk can be asked for.
 */

/** Looked up when a request comes in, not when the server is built, so a build does not carry the installers with it. */
const folder = () => path.join(/* turbopackIgnore: true */ process.cwd(), "desktop", "release", "downloads");

const TYPES: Record<string, string> = { ".dmg": "application/x-apple-diskimage", ".zip": "application/zip" };

const plain = (status: number, text: string) => new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** The public address the files are kept at, if there is one: an http(s) address without a trailing slash. */
function elsewhere(): string | null {
  const base = process.env.BERYL_DOWNLOADS_URL?.trim().replace(/\/+$/, "");
  return base && /^https?:\/\/[^\s]+$/i.test(base) ? base : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const base = elsewhere();

  if (id === "manifest") {
    if (base) return Response.redirect(`${base}/manifest.json`, 302);
    try {
      const built = JSON.parse(await readFile(path.join(folder(), "manifest.json"), "utf8")) as { version?: string; files?: Array<Record<string, unknown>> };
      // Only what a visitor needs: not which server a build points at.
      const manifest: DownloadManifest = {
        version: String(built.version ?? ""),
        files: (built.files ?? [])
          .filter((f) => isDownloadId(f.id))
          .map((f) => ({ id: f.id as DownloadManifest["files"][number]["id"], file: String(f.file), size: Number(f.size) || 0, sha256: String(f.sha256 ?? ""), builtAt: String(f.builtAt ?? "") })),
      };
      return Response.json(manifest, { headers: { "cache-control": "no-store" } });
    } catch {
      return plain(404, "Nothing has been built for download yet.");
    }
  }

  if (!isDownloadId(id)) return plain(404, "There is no such download.");
  const download = DOWNLOADS.find((d) => d.id === id)!;
  if (base) return Response.redirect(`${base}/${encodeURIComponent(download.file)}`, 302);

  const file = path.join(folder(), download.file);
  let size: number;
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    size = info.size;
  } catch {
    return plain(404, "This download is not available yet. Check back soon.");
  }

  // A blob backed by the file: it is read from disk as it is sent, not loaded into memory first.
  // The length is given, though the development server sends the file in pieces and leaves it out;
  // the size a visitor is shown comes from /download/manifest.
  return new Response(await openAsBlob(file), {
    headers: {
      "content-type": TYPES[path.extname(download.file)] ?? "application/octet-stream",
      "content-length": String(size),
      "content-disposition": `attachment; filename="${download.file}"`,
      // The same address serves the next build too: ask again each time.
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    },
  });
}
