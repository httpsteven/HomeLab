import "server-only";
import { bazarr } from "@/lib/clients/bazarr";
import { plex } from "@/lib/clients/plex";
import { radarr } from "@/lib/clients/radarr";
import { sonarr } from "@/lib/clients/sonarr";
import { invalidateMedia } from "@/lib/aggregate/media-cache";
import { refreshNow, refreshSoon } from "@/lib/collect/collector";
import type { ArrClient } from "@/lib/clients/arr";

/**
 * The complete set of actions this dashboard can take. There is no other way
 * to reach a service with a write.
 *
 * Two rules, enforced structurally rather than by convention:
 *
 * 1. **Allowlist only.** The browser sends an action NAME which is looked up
 *    in this table. It never sends a URL, an endpoint, or a Servarr command
 *    string — so there is no path from a client to an arbitrary API call.
 * 2. **Nothing destructive.** No delete, no remove, no blocklist, no file
 *    removal. Every action here either refreshes metadata, asks for a search,
 *    or flips a monitored flag — all trivially reversible. The one exception
 *    is terminating a Plex stream, which is disruptive but not destructive,
 *    and is confirmed in the UI before it fires.
 */

export interface ActionContext {
  params: Record<string, unknown>;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

type Handler = (context: ActionContext) => Promise<ActionResult>;

function num(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Missing or invalid "${field}"`);
  return parsed;
}

function str(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing or invalid "${field}"`);
  return value.trim();
}

/** Shared implementation for a Servarr command that targets one item. */
function arrCommand(
  client: ArrClient,
  commandName: string,
  buildPayload: (id: number) => Record<string, unknown>,
  successMessage: (id: number) => string,
): Handler {
  return async ({ params }) => {
    const id = num(params.id, "id");
    const result = await client.command(commandName, buildPayload(id));
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, message: successMessage(id) };
  };
}

/**
 * Toggling `monitored` needs a read-modify-write: Servarr's PUT replaces the
 * whole resource, so we fetch the current object and change one field rather
 * than constructing a partial one, which would silently wipe settings.
 */
function toggleMonitored(kind: "sonarr" | "radarr"): Handler {
  return async ({ params }) => {
    const id = num(params.id, "id");
    const monitored = Boolean(params.monitored);
    const client = kind === "sonarr" ? sonarr : radarr;
    const path = kind === "sonarr" ? `/series/${id}` : `/movie/${id}`;

    const current = await client.call<Record<string, unknown>>(path);
    if (!current.ok) return { ok: false, message: current.message };
    if (!current.data) return { ok: false, message: "Item not found." };

    const updated = await client.call(path, {
      method: "PUT",
      body: { ...current.data, monitored },
    });
    if (!updated.ok) return { ok: false, message: updated.message };

    invalidateMedia(kind === "sonarr" ? "series" : "movies");
    refreshSoon("library", 500);

    return {
      ok: true,
      message: monitored ? "Now monitored." : "No longer monitored.",
    };
  };
}

export const ACTIONS: Record<string, Handler> = {
  /* --- Sonarr ------------------------------------------------------- */
  "sonarr.refresh": arrCommand(
    sonarr,
    "RefreshSeries",
    (id) => ({ seriesId: id }),
    () => "Refreshing series metadata.",
  ),
  "sonarr.rescan": arrCommand(
    sonarr,
    "RescanSeries",
    (id) => ({ seriesId: id }),
    () => "Rescanning files on disk.",
  ),
  "sonarr.search": arrCommand(
    sonarr,
    "SeriesSearch",
    (id) => ({ seriesId: id }),
    () => "Searching for missing episodes.",
  ),
  "sonarr.searchMissing": async () => {
    const result = await sonarr.command("MissingEpisodeSearch");
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, message: "Searching for all missing episodes." };
  },
  "sonarr.toggleMonitored": toggleMonitored("sonarr"),

  /* --- Radarr ------------------------------------------------------- */
  "radarr.refresh": arrCommand(
    radarr,
    "RefreshMovie",
    (id) => ({ movieIds: [id] }),
    () => "Refreshing movie metadata.",
  ),
  "radarr.rescan": arrCommand(
    radarr,
    "RescanMovie",
    (id) => ({ movieIds: [id] }),
    () => "Rescanning files on disk.",
  ),
  "radarr.search": arrCommand(
    radarr,
    "MoviesSearch",
    (id) => ({ movieIds: [id] }),
    () => "Searching for a release.",
  ),
  "radarr.toggleMonitored": toggleMonitored("radarr"),

  /* --- Queue -------------------------------------------------------- */
  /** Re-attempts an import that Servarr couldn't complete. Non-destructive:
      it doesn't remove or blocklist anything, it just tries again. */
  "queue.retry": async ({ params }) => {
    const service = str(params.service, "service");
    const id = num(params.id, "id");
    if (service !== "sonarr" && service !== "radarr") {
      throw new Error('"service" must be sonarr or radarr');
    }
    const client = service === "sonarr" ? sonarr : radarr;
    const result = await client.call(`/queue/grab/${id}`, { method: "POST" });
    if (!result.ok) return { ok: false, message: result.message };
    refreshNow("queue");
    return { ok: true, message: "Retrying the import." };
  },

  /* --- Bazarr ------------------------------------------------------- */
  "bazarr.searchEpisode": async ({ params }) => {
    const seriesId = num(params.seriesId, "seriesId");
    const episodeId = num(params.episodeId, "episodeId");
    const result = await bazarr.searchEpisodeSubtitles(seriesId, episodeId);
    if (!result.ok) return { ok: false, message: result.message };
    refreshSoon("subtitles", 2_000);
    return { ok: true, message: "Searching for subtitles." };
  },
  "bazarr.searchMovie": async ({ params }) => {
    const radarrId = num(params.radarrId, "radarrId");
    const result = await bazarr.searchMovieSubtitles(radarrId);
    if (!result.ok) return { ok: false, message: result.message };
    refreshSoon("subtitles", 2_000);
    return { ok: true, message: "Searching for subtitles." };
  },

  /* --- Plex --------------------------------------------------------- */
  /** Disruptive but not destructive — it stops a playback session, it does
      not touch any data. Confirmed in the UI before it fires. */
  "plex.terminateStream": async ({ params }) => {
    const sessionId = str(params.sessionId, "sessionId");
    const reason = typeof params.reason === "string" && params.reason.trim()
      ? params.reason.trim().slice(0, 200)
      : "Stopped from the dashboard.";
    const result = await plex.terminateSession(sessionId, reason);
    if (!result.ok) return { ok: false, message: result.message };
    refreshNow("activity");
    return { ok: true, message: "Stream stopped." };
  },
};

export type ActionName = keyof typeof ACTIONS;

export function isKnownAction(name: string): name is string {
  return Object.prototype.hasOwnProperty.call(ACTIONS, name);
}
