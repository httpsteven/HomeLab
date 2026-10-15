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
 * Tautulli returns ABSENT FIELDS AS EMPTY STRINGS, not null.
 *
 * This is the whole reason series were missing from the newsletter: `??` only
 * falls through on null and undefined, so `grandparent_title ?? parent_title`
 * returned "" for a season — whose show name is in `parent_title` — and the
 * empty title then failed the guard below and dropped the item. Every season
 * and every newly added show went in the bin; only episodes, which do carry a
 * grandparent, survived.
 */
function text(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/**
 * Rolls what Plex added up under its show.
 *
 * Three shapes arrive for television and they mean different things:
 *
 *   - `episode` — one episode of an existing show. Counted.
 *   - `season`  — a whole season landed at once, which is what a rip of a box
 *                 set looks like. Reported as the season, not as "1 episode".
 *   - `show`    — a series that wasn't here before.
 *
 * All three collapse to one entry per show, because a newsletter listing
 * "The Bear S03E01, S03E02, S03E03…" as eight rows is noise where one row
 * saying the show got eight episodes is the information.
 */
interface ShowAccumulator extends AddedItem {
  /** Seasons that arrived whole, by their label. */
  seasons: Set<string>;
  /** The series itself is new, not just new to this week. */
  isNew: boolean;
}

function groupAdded(items: RecentlyAddedItem[], since: number): AddedItem[] {
  const movies: AddedItem[] = [];
  const shows = new Map<string, ShowAccumulator>();

  for (const item of items) {
    const addedAt = Number(item.added_at) * 1000;
    if (!Number.isFinite(addedAt) || addedAt < since) continue;

    if (item.media_type === "movie") {
      movies.push({
        key: item.rating_key,
        kind: "movie",
        title: item.title,
        subtitle: text(item.year) ?? null,
        year: item.year ? Number(item.year) : null,
        summary: text(item.summary) ?? null,
        thumb: text(item.thumb) ?? null,
        addedAt,
        episodeCount: 0,
      });
      continue;
    }

    // Where the show's name and key live depends on which shape this is: a
    // show is itself, a season hangs off its show, an episode off its season.
    const showTitle =
      item.media_type === "show"
        ? text(item.title)
        : text(item.grandparent_title, item.parent_title);
    const showKey =
      item.media_type === "show"
        ? text(item.rating_key)
        : text(item.grandparent_rating_key, item.parent_rating_key, item.rating_key);

    if (!showTitle || !showKey) continue;

    // The show's own art, not the episode still — a grid of episode stills
    // reads as a mess where a grid of posters reads as a shelf.
    const thumb = text(item.grandparent_thumb, item.parent_thumb, item.thumb) ?? null;

    const existing = shows.get(showKey);
    const entry: ShowAccumulator =
      existing ??
      ({
        key: showKey,
        kind: "show",
        title: showTitle,
        subtitle: null,
        year: item.year ? Number(item.year) : null,
        summary: text(item.summary) ?? null,
        thumb,
        addedAt,
        episodeCount: 0,
        seasons: new Set<string>(),
        isNew: false,
      } satisfies ShowAccumulator);

    if (existing) {
      // Keep the most recent timestamp so ordering reflects the latest arrival.
      entry.addedAt = Math.max(entry.addedAt, addedAt);
      entry.thumb ??= thumb;
      entry.summary ??= text(item.summary) ?? null;
    }

    if (item.media_type === "episode") entry.episodeCount += 1;
    else if (item.media_type === "season") {
      entry.seasons.add(
        text(item.title) ??
          (item.parent_media_index ? `Season ${item.parent_media_index}` : "a season"),
      );
    } else entry.isNew = true;

    shows.set(showKey, entry);
  }

  const grouped: AddedItem[] = [...shows.values()].map((show) => {
    const { seasons, isNew, ...rest } = show;

    // Most specific true statement first. "New series" beats a season count,
    // because that's the part a reader cares about.
    const parts: string[] = [];
    if (isNew) parts.push("New series");
    if (seasons.size === 1) parts.push([...seasons][0]);
    else if (seasons.size > 1) parts.push(`${seasons.size} seasons`);
    if (show.episodeCount > 0) {
      parts.push(`${show.episodeCount} ${show.episodeCount === 1 ? "episode" : "episodes"}`);
    }

    return { ...rest, subtitle: parts.join(" · ") || "Updated" };
  });

  return [...movies, ...grouped].sort((a, b) => b.addedAt - a.addedAt);
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
