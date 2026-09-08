import "server-only";
import { sonarr } from "@/lib/clients/sonarr";
import { radarr } from "@/lib/clients/radarr";
import { tautulli } from "@/lib/clients/tautulli";
import type { LibraryItem, LibraryState, QualityBucket } from "@/lib/types";
import { getMovies, getSeries } from "./media-cache";

/**
 * Library aggregation — "the current database of movies I have, numbers".
 *
 * Counts and sizes come from Sonarr/Radarr (they know file sizes); Plex's own
 * counts come via Tautulli and are shown alongside rather than merged, so a
 * mismatch between them stays visible. A gap between "Radarr says 1,284" and
 * "Plex says 1,279" is a real signal — five films Plex hasn't scanned — and
 * silently reconciling it would hide that.
 */

function bucketAdd(map: Map<string, QualityBucket>, name: string, bytes: number) {
  const key = name || "Unknown";
  const existing = map.get(key);
  if (existing) {
    existing.count += 1;
    existing.bytes += bytes;
  } else {
    map.set(key, { name: key, count: 1, bytes });
  }
}

/** Normalize codec names: "x265", "HEVC", "hevc" all mean the same thing. */
function normalizeCodec(codec: string | null | undefined): string {
  if (!codec) return "Unknown";
  const value = codec.toLowerCase();
  if (value.includes("hevc") || value.includes("265")) return "HEVC / H.265";
  if (value.includes("avc") || value.includes("264")) return "H.264";
  if (value.includes("av1")) return "AV1";
  if (value.includes("vc1") || value.includes("vc-1")) return "VC-1";
  if (value.includes("mpeg2")) return "MPEG-2";
  if (value.includes("xvid") || value.includes("divx")) return "XviD / DivX";
  if (value.includes("vp9")) return "VP9";
  return codec.toUpperCase();
}

export async function buildLibraryState(): Promise<LibraryState> {
  const [movies, series, profilesMovies, profilesSeries, plexLibs] = await Promise.all([
    getMovies(),
    getSeries(),
    radarr.available ? radarr.qualityProfiles() : null,
    sonarr.available ? sonarr.qualityProfiles() : null,
    tautulli.available ? tautulli.libraries() : null,
  ]);

  const profileNames = new Map<string, string>();
  if (profilesMovies?.ok) {
    for (const profile of profilesMovies.data ?? []) profileNames.set(`radarr:${profile.id}`, profile.name);
  }
  if (profilesSeries?.ok) {
    for (const profile of profilesSeries.data ?? []) profileNames.set(`sonarr:${profile.id}`, profile.name);
  }

  const byQuality = new Map<string, QualityBucket>();
  const byCodec = new Map<string, QualityBucket>();
  const items: LibraryItem[] = [];

  /* --- Movies --------------------------------------------------------- */
  let movieBytes = 0;
  let moviesWithFile = 0;
  let moviesUnmonitored = 0;

  for (const movie of movies.items) {
    const size = movie.sizeOnDisk || 0;
    movieBytes += size;
    if (movie.hasFile) moviesWithFile += 1;
    if (!movie.monitored) moviesUnmonitored += 1;

    const quality = movie.movieFile?.quality?.quality?.name ?? null;
    const codec = movie.movieFile?.mediaInfo?.videoCodec ?? null;

    if (movie.hasFile) {
      bucketAdd(byQuality, quality ?? "Unknown", size);
      bucketAdd(byCodec, normalizeCodec(codec), size);
    }

    items.push({
      id: movie.id,
      kind: "movie",
      title: movie.title,
      year: movie.year ?? null,
      size,
      monitored: movie.monitored,
      completeness: movie.hasFile ? 1 : 0,
      quality,
      codec: codec ? normalizeCodec(codec) : null,
      resolution: movie.movieFile?.mediaInfo?.resolution ?? null,
      added: movie.added ?? null,
      episodeCount: null,
      episodeFileCount: null,
      path: movie.path,
      genres: movie.genres ?? [],
    });
  }

  /* --- Series --------------------------------------------------------- */
  let seriesBytes = 0;
  let episodeCount = 0;
  let episodeFileCount = 0;
  let seriesUnmonitored = 0;
  let ended = 0;
  let continuing = 0;

  for (const item of series.items) {
    const stats = item.statistics;
    const size = stats?.sizeOnDisk ?? 0;
    seriesBytes += size;
    episodeCount += stats?.episodeCount ?? 0;
    episodeFileCount += stats?.episodeFileCount ?? 0;
    if (!item.monitored) seriesUnmonitored += 1;
    if (item.status === "ended" || item.ended) ended += 1;
    else continuing += 1;

    const profileName = profileNames.get(`sonarr:${item.qualityProfileId}`) ?? null;
    if (size > 0 && profileName) bucketAdd(byQuality, profileName, size);

    const episodes = stats?.episodeCount ?? 0;
    const files = stats?.episodeFileCount ?? 0;

    items.push({
      id: item.id,
      kind: "series",
      title: item.title,
      year: item.year ?? null,
      size,
      monitored: item.monitored,
      completeness: episodes > 0 ? files / episodes : 0,
      quality: profileName,
      codec: null,
      resolution: null,
      added: item.added ?? null,
      episodeCount: episodes,
      episodeFileCount: files,
      path: item.path,
      genres: item.genres ?? [],
    });
  }

  /* --- Plex's own counts, for cross-checking --------------------------- */
  const plexLibraries =
    plexLibs?.ok && Array.isArray(plexLibs.data)
      ? plexLibs.data.map((library) => ({
          name: library.section_name,
          type: library.section_type,
          count: Number(library.count) || 0,
          childCount: library.child_count ? Number(library.child_count) : null,
        }))
      : [];

  const sortBuckets = (map: Map<string, QualityBucket>) =>
    [...map.values()].sort((a, b) => b.bytes - a.bytes);

  return {
    movies: {
      total: movies.items.length,
      withFile: moviesWithFile,
      missing: movies.items.length - moviesWithFile,
      unmonitored: moviesUnmonitored,
      bytes: movieBytes,
    },
    series: {
      total: series.items.length,
      episodeCount,
      episodeFileCount,
      missingEpisodes: Math.max(episodeCount - episodeFileCount, 0),
      unmonitored: seriesUnmonitored,
      bytes: seriesBytes,
      ended,
      continuing,
    },
    plexLibraries,
    byQuality: sortBuckets(byQuality),
    byCodec: sortBuckets(byCodec),
    items: items.sort((a, b) => a.title.localeCompare(b.title)),
  };
}
