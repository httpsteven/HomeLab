import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { enqueueJob, setSubtitleOverride, shortsAvailable, shortsDbPath } from "@/lib/clients/shorts";

/**
 * Add a caption source for one media item.
 *
 * This is the answer to "this file has no usable subtitles" that doesn't
 * require transcription: upload an .srt and the pipeline uses it at tier 0 of
 * the acquisition ladder, ahead of anything embedded in the file.
 *
 * The upload is still VALIDATED like any other track — an uploaded file that
 * turns out to be junk is rejected with the same reason codes, rather than
 * being trusted because a human chose it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".srt", ".ass", ".ssa", ".vtt"]);

/** Uploads live beside the database, which is already a mounted volume. */
function uploadDir(): string {
  return path.join(path.dirname(shortsDbPath()), "caption-sources");
}

export async function POST(request: Request) {
  if (!shortsAvailable()) {
    return Response.json({ error: "Shorts database not found." }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected a multipart form." }, { status: 400 });
  }

  const mediaPath = String(form.get("path") ?? "");
  if (!mediaPath) {
    return Response.json({ error: "Missing media path." }, { status: 400 });
  }

  // "Always transcribe this one" — no file, just a flag.
  if (form.get("forceWhisper") === "true") {
    setSubtitleOverride(mediaPath, { forceWhisper: true, note: "forced from dashboard" });
    enqueueJob("transcribe", { path: mediaPath });
    return Response.json({ error: null, queued: "transcribe" }, { status: 202 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (file.size === 0) {
    return Response.json({ error: "That file is empty." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `Subtitle files should be well under ${MAX_BYTES / 1024 / 1024}MB.` },
      { status: 413 },
    );
  }

  const extension = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return Response.json(
      { error: `Expected one of: ${[...ALLOWED_EXTENSIONS].join(", ")}` },
      { status: 415 },
    );
  }

  // Named from the media path, so re-uploading for the same item replaces the
  // previous file rather than accumulating orphans.
  const stem = createHash("sha1").update(mediaPath).digest("hex").slice(0, 16);
  const destination = path.join(uploadDir(), `${stem}${extension}`);

  try {
    await mkdir(uploadDir(), { recursive: true });
    await writeFile(destination, Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not save the file." },
      { status: 502 },
    );
  }

  setSubtitleOverride(mediaPath, { srtPath: destination, note: `uploaded ${file.name}` });
  enqueueJob("audit", { path: mediaPath, deep: true });

  return Response.json({ error: null, path: destination }, { status: 201 });
}
