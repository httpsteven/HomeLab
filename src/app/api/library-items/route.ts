import { buildLibraryItems } from "@/lib/aggregate/library";
import { demoLibraryItems, isDemoMode } from "@/lib/demo";
import type { LibraryItem } from "@/lib/types";

/**
 * The full library item list, on demand.
 *
 * Kept out of the SSE stream on purpose: it's hundreds of KB on a real
 * library, the store broadcasts a whole slot whenever it refreshes, and only
 * one page ever needs the array. Streaming it would have meant re-sending the
 * entire library to every connected client every ten minutes.
 *
 * Costs nothing extra upstream — it reads the same 10-minute media cache the
 * live counts come from.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items: LibraryItem[] = isDemoMode()
      ? demoLibraryItems()
      : await buildLibraryItems();

    return Response.json(
      { items, error: null },
      // The underlying data only moves every 10 minutes; let the browser
      // reuse it briefly rather than re-downloading on every navigation.
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  } catch (error) {
    return Response.json(
      { items: [], error: error instanceof Error ? error.message : "Failed to load library." },
      { status: 502 },
    );
  }
}
