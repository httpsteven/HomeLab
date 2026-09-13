import { enqueueJob, shortsAvailable } from "@/lib/clients/shorts";

/**
 * Queue work for the pipeline.
 *
 * Inserts a row and returns. The Python worker drains the queue on its own
 * schedule, and only when nobody is streaming — which is why this is a queue
 * and not a direct call. A Whisper pass can run for minutes; a request handler
 * is the wrong place to hold that, and holding it would also bypass the viewer
 * gate entirely.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set(["render", "audit", "transcribe", "delete"]);

export async function POST(request: Request) {
  if (!shortsAvailable()) {
    return Response.json({ error: "Shorts database not found." }, { status: 503 });
  }

  let body: { type?: string; payload?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const type = String(body.type ?? "");
  if (!ALLOWED_TYPES.has(type)) {
    return Response.json(
      { error: `Unknown job type. Expected one of: ${[...ALLOWED_TYPES].join(", ")}` },
      { status: 400 },
    );
  }

  // Deleting removes GENERATED artifacts only — the clip and its thumbnail.
  // The worker additionally refuses to unlink anything outside the pipeline's
  // output directory, so source media is never a delete target.
  if (type === "delete") {
    const ids = body.payload?.clip_ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return Response.json({ error: "delete needs clip_ids." }, { status: 400 });
    }
  }

  const jobId = enqueueJob(type, body.payload ?? {});
  if (jobId === null) {
    return Response.json({ error: "Could not queue the job." }, { status: 502 });
  }

  return Response.json({ jobId, error: null }, { status: 202 });
}
