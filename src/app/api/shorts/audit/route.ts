import { listAudit } from "@/lib/aggregate/shorts";
import { shortsAvailable } from "@/lib/clients/shorts";

/** The full subtitle audit table. Same on-demand reasoning as /clips. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!shortsAvailable()) {
    return Response.json({ rows: [], error: "Shorts database not found." }, { status: 503 });
  }
  try {
    return Response.json(
      { rows: listAudit(), error: null },
      { headers: { "Cache-Control": "private, max-age=15" } },
    );
  } catch (error) {
    return Response.json(
      { rows: [], error: error instanceof Error ? error.message : "Failed to load audit." },
      { status: 502 },
    );
  }
}
