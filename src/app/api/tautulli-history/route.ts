import { tautulli } from "@/lib/clients/tautulli";
import { isDemoMode } from "@/lib/demo";

/**
 * Watch history for the Activity page.
 *
 * Not part of the SSE stream: it's slow-moving and only one page needs it, so
 * it's fetched on demand rather than kept in the live snapshot everyone
 * receives.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface WatchHistoryResponse {
  configured: boolean;
  playsByDate: { date: string; tv: number; movies: number }[];
  topTitles: { title: string; plays: number }[];
  topUsers: { user: string; plays: number }[];
  recent: {
    date: number;
    user: string;
    title: string;
    player: string;
    transcode: string;
    completed: boolean;
  }[];
  error: string | null;
}

function demoResponse(): WatchHistoryResponse {
  const days = 30;
  const playsByDate = Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.now() - (days - 1 - index) * 86400000);
    const weekend = [0, 6].includes(date.getDay());
    return {
      date: date.toISOString().slice(0, 10),
      tv: Math.round(3 + Math.random() * (weekend ? 14 : 7)),
      movies: Math.round(Math.random() * (weekend ? 5 : 2)),
    };
  });

  return {
    configured: true,
    playsByDate,
    topTitles: [
      { title: "Severance", plays: 42 },
      { title: "The Bear", plays: 31 },
      { title: "Andor", plays: 24 },
      { title: "Better Call Saul", plays: 19 },
      { title: "Blade Runner 2049", plays: 6 },
    ],
    topUsers: [
      { user: "steven", plays: 118 },
      { user: "guest", plays: 41 },
      { user: "family", plays: 27 },
    ],
    recent: Array.from({ length: 12 }, (_, index) => ({
      date: Date.now() / 1000 - index * 9400,
      user: ["steven", "guest", "family"][index % 3],
      title: ["Severance — S02E04", "The Bear — S03E02", "Dune", "Andor — S02E01"][index % 4],
      player: ["Apple TV", "Chrome", "iPhone", "Shield"][index % 4],
      transcode: index % 3 === 0 ? "transcode" : "direct play",
      completed: index % 5 !== 0,
    })),
    error: null,
  };
}

export async function GET() {
  if (isDemoMode()) {
    return Response.json(demoResponse());
  }

  if (!tautulli.available) {
    return Response.json({
      configured: false,
      playsByDate: [],
      topTitles: [],
      topUsers: [],
      recent: [],
      error: null,
    } satisfies WatchHistoryResponse);
  }

  const [plays, home, history] = await Promise.all([
    tautulli.playsByDate(30),
    tautulli.homeStats(30, 6),
    tautulli.history(20),
  ]);

  // Tautulli returns plays-by-date as parallel arrays keyed by series name.
  const playsByDate: WatchHistoryResponse["playsByDate"] = [];
  if (plays.ok && plays.data?.categories) {
    const tvSeries = plays.data.series?.find((entry) => /tv/i.test(entry.name));
    const movieSeries = plays.data.series?.find((entry) => /movie/i.test(entry.name));
    plays.data.categories.forEach((date, index) => {
      playsByDate.push({
        date,
        tv: tvSeries?.data[index] ?? 0,
        movies: movieSeries?.data[index] ?? 0,
      });
    });
  }

  const findStat = (id: string) =>
    home.ok && Array.isArray(home.data)
      ? home.data.find((stat) => stat.stat_id === id)?.rows ?? []
      : [];

  return Response.json({
    configured: true,
    playsByDate,
    topTitles: [...findStat("top_tv"), ...findStat("top_movies")]
      .map((row) => ({ title: row.title ?? "Unknown", plays: row.total_plays ?? 0 }))
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 6),
    topUsers: findStat("top_users")
      .map((row) => ({ user: row.friendly_name ?? row.user ?? "Unknown", plays: row.total_plays ?? 0 }))
      .slice(0, 6),
    recent:
      history.ok && Array.isArray(history.data?.data)
        ? history.data.data.slice(0, 20).map((row) => ({
            date: row.date,
            user: row.user,
            title: row.full_title,
            player: row.player,
            transcode: row.transcode_decision,
            completed: row.watched_status === 1,
          }))
        : [],
    error: plays.ok ? null : plays.message,
  } satisfies WatchHistoryResponse);
}
