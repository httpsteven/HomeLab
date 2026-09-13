import { listClips } from "@/lib/aggregate/shorts";
import { shortsAvailable } from "@/lib/clients/shorts";
import { demoShorts, isDemoMode } from "@/lib/demo";

/**
 * The full clip list, on demand.
 *
 * Kept out of the SSE stream for the same reason the library items are: the
 * store broadcasts a whole slot whenever it refreshes, and only one page needs
 * this array. Streaming it would re-send every clip to every connected client
 * on every tick.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (isDemoMode()) {
    return Response.json({ clips: demoShorts().recentClips, error: null });
  }
  if (!shortsAvailable()) {
    return Response.json({ clips: [], error: "Shorts database not found." }, { status: 503 });
  }

  try {
    return Response.json(
      { clips: listClips(), error: null },
      { headers: { "Cache-Control": "private, max-age=5" } },
    );
  } catch (error) {
    return Response.json(
      { clips: [], error: error instanceof Error ? error.message : "Failed to load clips." },
      { status: 502 },
    );
  }
}
