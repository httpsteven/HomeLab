import "server-only";
import { tautulli, type RecentlyAddedItem } from "@/lib/clients/tautulli";
import { getState } from "@/lib/collect/store";
import { readHistory } from "@/lib/history";
import { demoNewsletter, isDemoMode } from "@/lib/demo";
import type { AddedItem, Issue, WatchRow } from "./types";

/**
 * Gathers one issue for a window.
 *
 * Reads only what the dashboard already collects, plus Tautulli's
 * recently-added list. Nothing here throws: a missing section renders as
 * empty rather than failing the whole issue, because a newsletter with no
 * watch stats is still worth sending and a crashed one isn't.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Rolls episodes up under their show.
 *
 * Plex reports every episode separately. A newsletter listing "The Bear S03E01,
 * S03E02, S03E03…" as eight entries is noise; one entry saying the show got
 * eight episodes is the information.
 */
function groupAdded(items: RecentlyAddedItem[], since: number): AddedItem[] {
  const movies: AddedItem[] = [];
  const shows = new Map<string, AddedItem>();

  for (const item of items) {
    const addedAt = Number(item.added_at) * 1000;
    if (!Number.isFinite(addedAt) || addedAt < since) continue;

    if (item.media_type === "movie") {
      movies.push({
        key: item.rating_key,
        kind: "movie",
        title: item.title,
        subtitle: item.year ?? null,
        year: item.year ? Number(item.year) : null,
        summary: item.summary?.trim() || null,
        thumb: item.thumb ?? null,
        addedAt,
        episodeCount: 0,
      });
      continue;
    }

    // Episodes and seasons both roll up to the show.
    const showTitle = item.grandparent_title ?? item.parent_title ?? item.title;
    const showKey = item.grandparent_rating_key ?? item.parent_rating_key ?? item.rating_key;
    if (!showTitle) continue;

    const existing = shows.get(showKey);
    if (existing) {
      existing.episodeCount += 1;
      // Keep the most recent timestamp so ordering reflects the latest episode.
      existing.addedAt = Math.max(existing.addedAt, addedAt);
      continue;
    }

    shows.set(showKey, {
      key: showKey,
      kind: "show",
      title: showTitle,
      subtitle: null,
      year: item.year ? Number(item.year) : null,
      summary: item.summary?.trim() || null,
      // The show's own art, not the episode still — a grid of episode stills
      // reads as a mess where a grid of posters reads as a shelf.
      thumb: item.grandparent_thumb ?? item.parent_thumb ?? item.thumb ?? null,
      addedAt,
      episodeCount: 1,
    });
  }

  for (const show of shows.values()) {
    show.subtitle = `${show.episodeCount} ${show.episodeCount === 1 ? "episode" : "episodes"}`;
  }

  return [...movies, ...shows.values()].sort((a, b) => b.addedAt - a.addedAt);
}

function statRows(
  stats: { stat_id: string; rows: { title?: string; friendly_name?: string; user?: string; total_plays?: number }[] }[],
  ids: string[],
  label: (row: { title?: string; friendly_name?: string; user?: string }) => string,
): WatchRow[] {
  return ids
    .flatMap((id) => stats.find((stat) => stat.stat_id === id)?.rows ?? [])
    .map((row) => ({ label: label(row) || "Unknown", plays: row.total_plays ?? 0 }))
    .filter((row) => row.plays > 0)
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 6);
}

export async function buildIssue(windowMs = WEEK_MS): Promise<Issue> {
  const to = Date.now();
  const from = to - windowMs;
  const days = Math.max(Math.round(windowMs / 86_400_000), 1);

  // Demo mode substitutes the Tautulli-sourced sections, exactly as the
  // collector substitutes its sources, so the page and the email can be
  // reviewed without live services.
  const demo = isDemoMode() ? demoNewsletter(from, to) : null;

  const [recent, home, plays, history] = await Promise.all([
    tautulli.available ? tautulli.recentlyAdded(100) : null,
    tautulli.available ? tautulli.homeStats(days, 6) : null,
    tautulli.available ? tautulli.playsByDate(days) : null,
    readHistory(),
  ]);

  const added =
    demo?.added ??
    (recent?.ok && Array.isArray(recent.data?.recently_added)
      ? groupAdded(recent.data.recently_added, from)
      : []);

  const stats = home?.ok && Array.isArray(home.data) ? home.data : [];

  /* --- Plays over the window ----------------------------------------- */
  const playsByDay: { date: string; plays: number }[] = demo?.playsByDay ?? [];
  if (!demo && plays?.ok && plays.data?.categories) {
    plays.data.categories.forEach((date, index) => {
      const total = (plays.data?.series ?? []).reduce(
        (sum, series) => sum + (series.data[index] ?? 0),
        0,
      );
      playsByDay.push({ date, plays: total });
    });
  }

  /* --- Growth over the window ----------------------------------------
     Subtract the snapshot nearest the window start. Null rather than zero
     when there isn't one old enough — "no data yet" and "nothing was added"
     are different claims and shouldn't look identical. */
  const state = getState();
  const libraryBytesNow = state.storage.data?.libraryBytes.total ?? null;

  let bytesAdded: number | null = null;
  if (history.length > 0 && libraryBytesNow !== null) {
    const older = history.filter((snapshot) => snapshot.t <= from);
    const baseline = older[older.length - 1];
    if (baseline) bytesAdded = libraryBytesNow - baseline.libraryBytes.total;
  }

  const services = state.services.data?.services ?? [];

  return {
    id: new Date(to).toISOString().slice(0, 10),
    generatedAt: to,
    from,
    to,
    shared: {
      added,
      counts: {
        movies: added.filter((item) => item.kind === "movie").length,
        shows: added.filter((item) => item.kind === "show").length,
        episodes: added.reduce((sum, item) => sum + item.episodeCount, 0),
      },
      topTitles: demo?.topTitles ?? statRows(stats, ["top_movies", "top_tv"], (row) => row.title ?? ""),
      totalPlays: playsByDay.reduce((sum, day) => sum + day.plays, 0),
    },
    admin: {
      bytesAdded,
      libraryBytesNow,
      topUsers: demo?.topUsers ?? statRows(stats, ["top_users"], (row) => row.friendly_name ?? row.user ?? ""),
      playsByDay,
      storage: (state.storage.data?.mounts ?? [])
        // Pool members would double-count the same bytes, exactly as on the
        // storage page.
        .filter((mount) => !mount.partOfPool)
        .map((mount) => ({
          label: mount.label,
          path: mount.path,
          usedFraction: mount.usedFraction,
          free: mount.free,
          total: mount.total,
        })),
      issues: services.flatMap((service) =>
        service.issues.map((issue) => ({
          service: service.label,
          level: issue.level,
          message: issue.message,
        })),
      ),
      servicesDown: services
        .filter((service) => service.configured && !service.reachable)
        .map((service) => service.label),
    },
  };
}
