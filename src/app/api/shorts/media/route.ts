import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { queryOne, SHORTS_OUTPUT_DIR } from "@/lib/clients/shorts";

/**
 * Serves a generated clip or its thumbnail.
 *
 * Two things matter here:
 *
 * 1. RANGE SUPPORT. Without a 206 response the browser can't seek — the player
 *    will start at zero and dragging the scrubber does nothing. Video elements
 *    ask for ranges as a matter of course, so this isn't an optimisation.
 *
 * 2. PATH VALIDATION. The clip id is looked up in the database and the path
 *    comes from THERE, never from the query string, so this can't be turned
 *    into "read any file on the server". The resolved path is then checked to
 *    be inside the output directory as a second line of defence.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

/** Reject anything that escapes the configured output directory. */
function isInsideOutputDir(candidate: string): boolean {
  if (!SHORTS_OUTPUT_DIR) return true; // not configured: DB lookup is the guard
  const root = path.resolve(SHORTS_OUTPUT_DIR);
  const resolved = path.resolve(candidate);
  return resolved === root || resolved.startsWith(root + path.sep);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const clipId = url.searchParams.get("id");
  const kind = url.searchParams.get("kind") === "thumb" ? "thumb" : "video";

  if (!clipId) return new Response("Missing id", { status: 400 });

  const row = queryOne<{ output: string; thumbnail: string | null }>(
    "SELECT output, thumbnail FROM shorts WHERE clip_id = ? AND deleted_at IS NULL",
    [clipId],
  );
  if (!row) return new Response("Unknown clip", { status: 404 });

  const filePath = kind === "thumb" ? row.thumbnail : row.output;
  if (!filePath) return new Response("No file for that clip", { status: 404 });
  if (!isInsideOutputDir(filePath)) {
    return new Response("Refusing to serve a file outside the output directory", {
      status: 403,
    });
  }

  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    // The row exists but the file is gone — deleted by hand, or the output
    // directory moved. Say which, rather than a bare 404.
    return new Response("Clip file is missing on disk", { status: 410 });
  }

  const contentType =
    CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";

  const headers = new Headers({
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    // Generated clips never change in place — a new render is a new file.
    "Cache-Control": "private, max-age=3600",
  });

  const range = request.headers.get("range");
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : stats.size - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stats.size) {
        return new Response("Range not satisfiable", {
          status: 416,
          headers: { "Content-Range": `bytes */${stats.size}` },
        });
      }

      const clampedEnd = Math.min(end, stats.size - 1);
      headers.set("Content-Range", `bytes ${start}-${clampedEnd}/${stats.size}`);
      headers.set("Content-Length", String(clampedEnd - start + 1));

      const stream = createReadStream(filePath, { start, end: clampedEnd });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers,
      });
    }
  }

  headers.set("Content-Length", String(stats.size));
  return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
    status: 200,
    headers,
  });
}
