import { setReview, shortsAvailable } from "@/lib/clients/shorts";

/** Triage a clip before uploading it. One of the three tables the dashboard owns. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set(["approved", "rejected", "favourite", "none"]);

export async function POST(request: Request) {
  if (!shortsAvailable()) {
    return Response.json({ error: "Shorts database not found." }, { status: 503 });
  }

  let body: { clipId?: string; status?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const clipId = String(body.clipId ?? "");
  const status = String(body.status ?? "");

  if (!clipId) return Response.json({ error: "Missing clipId." }, { status: 400 });
  if (!ALLOWED.has(status)) {
    return Response.json(
      { error: `Unknown status. Expected one of: ${[...ALLOWED].join(", ")}` },
      { status: 400 },
    );
  }

  const ok = setReview(clipId, status, body.note ?? null);
  return ok
    ? Response.json({ error: null })
    : Response.json({ error: "Could not save." }, { status: 502 });
}
