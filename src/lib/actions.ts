import "server-only";
import { bazarr } from "@/lib/clients/bazarr";
import { plex } from "@/lib/clients/plex";
import { tautulli } from "@/lib/clients/tautulli";
import { radarr } from "@/lib/clients/radarr";
import { sonarr } from "@/lib/clients/sonarr";
import { invalidateMedia } from "@/lib/aggregate/media-cache";
import { refreshNow, refreshSoon } from "@/lib/collect/collector";
import { sendTestAlert } from "@/lib/alerts";
import { runNewsletterIfDue } from "@/lib/newsletter/schedule";
import { sendIssue } from "@/lib/newsletter/send";
import { latestIssue } from "@/lib/newsletter/store";
import { writeMailSettings } from "@/lib/settings";
import { BAZARR_TASKS } from "@/lib/bazarr-tasks";
import { runGapFillIfDue } from "@/lib/collect/gap-schedule";
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

  /**
   * Runs one of Bazarr's own scheduled tasks now.
   *
   * The task id comes from a fixed allowlist, not from the browser, for the
   * same reason every other action here takes a name rather than a URL.
   *
   * `update_bazarr` is deliberately NOT on it. It is a real Bazarr task, and
   * it updates Bazarr itself — which is a privileged action wearing the same
   * clothes as a library sync. Upgrades happen through the package manager
   * where they can be reviewed, not from a button on a dashboard.
   */
  "bazarr.runTask": async ({ params }) => {
    const id = typeof params.task === "string" ? params.task : "";
    const task = BAZARR_TASKS.find((entry) => entry.id === id);
    if (!task) throw new Error(`Unknown Bazarr task "${id}".`);

    const result = await bazarr.runTask(task.id);
    if (!result.ok) return { ok: false, message: result.message };

    refreshSoon("subtitles", 4_000);
    // Bazarr queues rather than blocks, so this says started, not finished.
    return { ok: true, message: `${task.label} started.` };
  },

  /**
   * Fills library gaps now, instead of waiting for the daily run.
   *
   * Honours IMPORT_FILL_GAPS exactly as the schedule does: with it unset this
   * reports what it would do and writes nothing. A manual button that is more
   * powerful than the scheduled job would be a nasty surprise.
   */
  "library.fillGaps": async () => {
    const runs = await runGapFillIfDue(true);
    if (!runs) return { ok: false, message: "Nothing to do." };

    const imported = runs.reduce((sum, run) => sum + run.imported.length, 0);
    const skipped = runs.reduce((sum, run) => sum + run.skipped.length, 0);
    const failed = runs.reduce((sum, run) => sum + run.failed.length, 0);
    const dry = runs.some((run) => run.dryRun);

    refreshSoon("library", 3_000);
    return {
      ok: failed === 0,
      message: dry
        ? `Would import ${imported}, skip ${skipped}. Set IMPORT_FILL_GAPS=1 to apply.`
        : `Imported ${imported}, skipped ${skipped}${failed ? `, ${failed} failed` : ""}.`,
    };
  },

  /* --- Alerts ------------------------------------------------------- */
  /** Delivery test. Sends only to endpoints you configured yourself. */
  "alerts.test": async () => sendTestAlert(),

  /* --- Newsletter --------------------------------------------------- */
  /** Build an issue now, regardless of the weekly schedule. Read-only over
      the media clients; it only writes its own archive file. */
  "newsletter.generate": async () => {
    const result = await runNewsletterIfDue(true);
    if (!result.issue) return { ok: false, message: "Couldn't build an issue." };
    const { counts } = result.issue.shared;
    // Series are named here too. Reporting only films and episodes meant a
    // week of intact seasons read back as "7 films, 0 episodes", which is the
    // same blind spot the issue itself used to have.
    const summary =
      [
        counts.movies > 0 ? `${counts.movies} films` : null,
        counts.shows > 0 ? `${counts.shows} series` : null,
        counts.episodes > 0 ? `${counts.episodes} episodes` : null,
      ]
        .filter(Boolean)
        .join(", ") || "nothing new";

    return {
      ok: true,
      message: `Issue ${result.issue.id}: ${summary}. ${result.delivery.join(" ")}`,
    };
  },

  /** Sends the latest issue to ONE address, so a test can't reach the list. */
  "newsletter.sendTest": async ({ params }) => {
    const to = typeof params.to === "string" ? params.to.trim() : "";
    if (!to.includes("@")) throw new Error('Missing or invalid "to" address');

    const edition = params.edition === "viewer" ? "viewer" : "admin";
    const issue = (await latestIssue()) ?? (await runNewsletterIfDue(true)).issue;
    if (!issue) return { ok: false, message: "No issue to send." };

    const result = await sendIssue(issue, edition, [to]);
    return { ok: result.ok, message: result.message };
  },

  /* --- Settings ----------------------------------------------------- */
  /**
   * Saves mail settings.
   *
   * Writes a config file, nothing else — it cannot touch media. The password
   * only travels inbound: an omitted `pass` keeps whatever is stored, so the
   * form never has to receive a secret in order to re-save the other fields.
   */
  "settings.mail": async ({ params }) => {
    const text = (key: string): string | null | undefined => {
      const value = params[key];
      if (value === undefined) return undefined;
      if (typeof value !== "string") return undefined;
      const trimmed = value.trim();
      return trimmed === "" ? null : trimmed;
    };

    const from = text("from");
    const host = text("host");
    if (from && !from.includes("@")) throw new Error('"from" must be an email address');

    let port: number | null | undefined;
    if (params.port !== undefined) {
      const parsed = Number(params.port);
      if (params.port === "" || params.port === null) port = null;
      else if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error('"port" must be between 1 and 65535');
      } else port = parsed;
    }

    await writeMailSettings({
      host,
      port,
      user: text("user"),
      // Only overwritten when a non-empty value is supplied.
      ...(typeof params.pass === "string" && params.pass.trim() !== ""
        ? { pass: params.pass.trim() }
        : {}),
      from,
      viewerRecipients: text("viewerRecipients"),
      adminRecipients: text("adminRecipients"),
      ...(params.enabled !== undefined ? { enabled: Boolean(params.enabled) } : {}),
      ...(params.secure !== undefined ? { secure: Boolean(params.secure) } : {}),
    });

    return {
      ok: true,
      message: host
        ? "Saved. Send a test to confirm it works."
        : "Saved. Set a host before anything can send.",
    };
  },

  /* --- Plex --------------------------------------------------------- */
  /** Disruptive but not destructive — it stops a playback session, it does
      not touch any data. Confirmed in the UI before it fires. */
  "plex.terminateStream": async ({ params }) => {
    const reason =
      typeof params.reason === "string" && params.reason.trim()
        ? params.reason.trim().slice(0, 200)
        : "Stopped from the dashboard.";

    const sessionId = typeof params.sessionId === "string" ? params.sessionId.trim() : "";
    const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey.trim() : "";

    if (!sessionId && !sessionKey) {
      throw new Error('Missing both "sessionId" and "sessionKey"');
    }

    // Plex first, using Session.id. Note this needs Plex Pass and a token
    // belonging to the server owner.
    if (sessionId) {
      const result = await plex.terminateSession(sessionId, reason);
      if (result.ok) {
        refreshNow("activity");
        return { ok: true, message: "Stream stopped." };
      }

      // A 404 here means "no session with that id" — it has already ended, or
      // the id is stale. It does NOT mean the URL is wrong, so the generic
      // transport message would be actively misleading.
      if (result.kind !== "not-found" || !sessionKey) {
        return {
          ok: false,
          message:
            result.kind === "not-found"
              ? "Plex has no such session — it may have already stopped."
              : result.kind === "auth"
                ? "Plex refused the request. Stopping a stream needs Plex Pass and the server owner's token."
                : result.message,
        };
      }
    }

    // Fallback: Tautulli terminates by session_key, which is always present.
    if (sessionKey && tautulli.available) {
      const result = await tautulli.terminateSession(sessionKey, reason);
      if (result.ok) {
        refreshNow("activity");
        return { ok: true, message: "Stream stopped." };
      }
      return { ok: false, message: result.message };
    }

    return { ok: false, message: "Plex has no such session — it may have already stopped." };
  },
};

export type ActionName = keyof typeof ACTIONS;

export function isKnownAction(name: string): name is string {
  return Object.prototype.hasOwnProperty.call(ACTIONS, name);
}
