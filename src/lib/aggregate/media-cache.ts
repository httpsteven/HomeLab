import "server-only";
import { radarr, type Movie } from "@/lib/clients/radarr";
import { sonarr, type Series } from "@/lib/clients/sonarr";
import { singleFlight } from "@/lib/http";

/**
 * Cache for the two expensive calls in the whole app.
 *
 * /api/v3/movie and /api/v3/series return EVERY item with full metadata —
 * multiple megabytes on a real library. These can't sit on a fast timer, so
 * they're cached with a TTL and shared by both the storage and library
 * aggregators.
 *
 * The important part is `invalidate`: when the SignalR push layer reports an
 * import or a delete, we drop the cache immediately instead of waiting out
 * the TTL. That's how the numbers stay fresh without polling for them.
 */

const TTL_MS = 10 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

interface MediaCacheShape {
  movies: CacheEntry<Movie[]> | null;
  series: CacheEntry<Series[]> | null;
}

// Survives hot reload in dev — otherwise every edit re-fetches the library.
const globalForCache = globalThis as unknown as { __mediaCache?: MediaCacheShape };
const cache: MediaCacheShape = (globalForCache.__mediaCache ??= { movies: null, series: null });

function isFresh<T>(entry: CacheEntry<T> | null): entry is CacheEntry<T> {
  return entry !== null && Date.now() - entry.fetchedAt < TTL_MS;
}

export interface MediaResult<T> {
  items: T[];
  fetchedAt: number | null;
  error: string | null;
  available: boolean;
}

export async function getMovies(force = false): Promise<MediaResult<Movie>> {
  if (!radarr.available) {
    return { items: [], fetchedAt: null, error: null, available: false };
  }
  if (!force && isFresh(cache.movies)) {
    return { items: cache.movies.data, fetchedAt: cache.movies.fetchedAt, error: null, available: true };
  }

  return singleFlight("media:movies", async () => {
    const result = await radarr.movies();
    if (!result.ok) {
      // Serve stale data rather than nothing — a brief Radarr restart
      // shouldn't blank out the library page.
      if (cache.movies) {
        return {
          items: cache.movies.data,
          fetchedAt: cache.movies.fetchedAt,
          error: result.message,
          available: true,
        };
      }
      return { items: [], fetchedAt: null, error: result.message, available: true };
    }
    cache.movies = { data: result.data ?? [], fetchedAt: result.fetchedAt };
    return { items: cache.movies.data, fetchedAt: cache.movies.fetchedAt, error: null, available: true };
  });
}

export async function getSeries(force = false): Promise<MediaResult<Series>> {
  if (!sonarr.available) {
    return { items: [], fetchedAt: null, error: null, available: false };
  }
  if (!force && isFresh(cache.series)) {
    return { items: cache.series.data, fetchedAt: cache.series.fetchedAt, error: null, available: true };
  }

  return singleFlight("media:series", async () => {
    const result = await sonarr.series();
    if (!result.ok) {
      if (cache.series) {
        return {
          items: cache.series.data,
          fetchedAt: cache.series.fetchedAt,
          error: result.message,
          available: true,
        };
      }
      return { items: [], fetchedAt: null, error: result.message, available: true };
    }
    cache.series = { data: result.data ?? [], fetchedAt: result.fetchedAt };
    return { items: cache.series.data, fetchedAt: cache.series.fetchedAt, error: null, available: true };
  });
}

/** Called by the push layer when an import/upgrade/delete event arrives. */
export function invalidateMedia(kind: "movies" | "series" | "all" = "all"): void {
  if (kind === "movies" || kind === "all") cache.movies = null;
  if (kind === "series" || kind === "all") cache.series = null;
}
