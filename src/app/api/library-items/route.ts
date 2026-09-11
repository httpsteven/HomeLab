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

/** Just enough to search and route to an item. */
export interface CompactLibraryItem {
  id: number;
  kind: LibraryItem["kind"];
  title: string;
  year: number | null;
}

export async function GET(request: Request) {
  // ?compact=1 drops everything the command palette doesn't need. The full
  // payload is ~435 KB on a real library; the palette only searches titles and
  // routes by id, so shipping quality, codec, path and genres to it is waste.
  const compact = new URL(request.url).searchParams.get("compact") === "1";

  try {
    const items: LibraryItem[] = isDemoMode()
      ? demoLibraryItems()
      : await buildLibraryItems();

    if (compact) {
      const slim: CompactLibraryItem[] = items.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        year: item.year,
      }));
      return Response.json(
        { items: slim, error: null },
        { headers: { "Cache-Control": "private, max-age=60" } },
      );
    }

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
