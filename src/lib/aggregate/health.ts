import "server-only";
import { bazarr } from "@/lib/clients/bazarr";
import { glances } from "@/lib/clients/glances";
import { plex } from "@/lib/clients/plex";
import { radarr } from "@/lib/clients/radarr";
import { sonarr } from "@/lib/clients/sonarr";
import { tautulli } from "@/lib/clients/tautulli";
import { allServices, isConfigured, type ServiceId } from "@/lib/config";
import type { ArrClient } from "@/lib/clients/arr";
import type {
  QueueItemView,
  QueueState,
  ServiceHealthView,
  ServicesState,
  SubtitleState,
} from "@/lib/types";
import { getPushMode } from "@/lib/collect/push-state";
import { healthMuteRules, isMuted, type MuteRule } from "@/lib/health-mute";

/**
 * Service reachability + each tool's own health checks + queue + subtitles.
 *
 * "Reachable" here means a real API call succeeded, not that a TCP port is
 * open — a service that answers but rejects the key is a different problem
 * from one that's down, and the UI needs to say which.
 */

async function arrHealth(
  client: ArrClient,
  id: ServiceId,
  label: string,
  muteRules: MuteRule[],
): Promise<ServiceHealthView> {
  const configured = isConfigured(client.config);
  if (!configured) {
    return {
      id, label, configured: false, reachable: false, version: null,
      responseMs: null, error: null, issues: [], mutedIssues: 0, mode: "idle",
    };
  }

  const [status, health] = await Promise.all([client.systemStatus(), client.health()]);

  const all =
    health.ok && Array.isArray(health.data)
      ? health.data
          .filter((issue) => issue.type === "warning" || issue.type === "error")
          .map((issue) => ({
            level: issue.type === "error" ? ("critical" as const) : ("warning" as const),
            message: issue.message,
            source: issue.source,
          }))
      : [];

  const issues = all.filter((issue) => !isMuted(muteRules, id, issue.source, issue.message));

  return {
    id,
    label,
    configured: true,
    reachable: status.ok,
    version: status.ok ? (status.data?.version ?? null) : null,
    responseMs: status.durationMs,
    error: status.ok ? null : status.message,
    issues,
    mutedIssues: all.length - issues.length,
    mode: getPushMode(id),
  };
}

export async function buildServicesState(): Promise<ServicesState> {
  const configs = new Map(allServices().map((service) => [service.id, service]));
  const muteRules = healthMuteRules();

  const [sonarrHealth, radarrHealth, plexHealth, tautulliHealth, bazarrHealth, glancesHealth] =
    await Promise.all([
      arrHealth(sonarr, "sonarr", "Sonarr", muteRules),
      arrHealth(radarr, "radarr", "Radarr", muteRules),

      (async (): Promise<ServiceHealthView> => {
        const config = configs.get("plex")!;
        if (!isConfigured(config)) {
          return { id: "plex", label: "Plex", configured: false, reachable: false, version: null, responseMs: null, error: null, issues: [], mutedIssues: 0, mode: "idle" };
        }
        const identity = await plex.identity();
        return {
          id: "plex",
          label: "Plex",
          configured: true,
          reachable: identity.ok,
          version: identity.ok ? (identity.data?.version ?? null) : null,
          responseMs: identity.durationMs,
          error: identity.ok ? null : identity.message,
          issues: [],
          mutedIssues: 0,
          mode: getPushMode("plex"),
        };
      })(),

      (async (): Promise<ServiceHealthView> => {
        const config = configs.get("tautulli")!;
        if (!isConfigured(config)) {
          return { id: "tautulli", label: "Tautulli", configured: false, reachable: false, version: null, responseMs: null, error: null, issues: [], mutedIssues: 0, mode: "idle" };
        }
        const info = await tautulli.serverInfo();
        return {
          id: "tautulli",
          label: "Tautulli",
          configured: true,
          reachable: info.ok,
          version: info.ok ? (info.data?.pms_version ?? null) : null,
          responseMs: info.durationMs,
          error: info.ok ? null : info.message,
          issues: [],
          mutedIssues: 0,
          mode: "poll",
        };
      })(),

      (async (): Promise<ServiceHealthView> => {
        const config = configs.get("bazarr")!;
        if (!isConfigured(config)) {
          return { id: "bazarr", label: "Bazarr", configured: false, reachable: false, version: null, responseMs: null, error: null, issues: [], mutedIssues: 0, mode: "idle" };
        }
        const [status, health] = await Promise.all([bazarr.status(), bazarr.health()]);
        const bazarrIssues =
          health.ok && Array.isArray(health.data?.data)
            ? health.data.data.map((issue) => ({
                level: "warning" as const,
                message: issue.issue,
                source: issue.object,
              }))
            : [];
        return {
          id: "bazarr",
          label: "Bazarr",
          configured: true,
          reachable: status.ok,
          version: status.ok ? (status.data?.data?.bazarr_version ?? null) : null,
          responseMs: status.durationMs,
          error: status.ok ? null : status.message,
          issues: bazarrIssues.filter(
            (issue) => !isMuted(muteRules, "bazarr", issue.source, issue.message),
          ),
          mutedIssues: bazarrIssues.filter((issue) =>
            isMuted(muteRules, "bazarr", issue.source, issue.message),
          ).length,
          mode: getPushMode("bazarr"),
        };
      })(),

      (async (): Promise<ServiceHealthView> => {
        const config = configs.get("glances")!;
        if (!isConfigured(config)) {
          return { id: "glances", label: "Glances", configured: false, reachable: false, version: null, responseMs: null, error: null, issues: [], mutedIssues: 0, mode: "idle" };
        }
        const system = await glances.system();
        return {
          id: "glances",
          label: "Glances",
          configured: true,
          reachable: system.ok,
          version: system.ok ? `API v${glances.apiVersion ?? "?"}` : null,
          responseMs: system.durationMs,
          error: system.ok ? null : system.message,
          issues: [],
          mutedIssues: 0,
          mode: "poll",
        };
      })(),
    ]);

  return {
    services: [plexHealth, tautulliHealth, sonarrHealth, radarrHealth, bazarrHealth, glancesHealth],
  };
}

/* ------------------------------------------------------------------ *
 * Queue
 * ------------------------------------------------------------------ */

export async function buildQueueState(): Promise<QueueState> {
  const [sonarrQueue, radarrQueue] = await Promise.all([
    sonarr.available ? sonarr.queue() : null,
    radarr.available ? radarr.queue() : null,
  ]);

  const items: QueueItemView[] = [];

  const collect = (
    result: typeof sonarrQueue,
    source: "sonarr" | "radarr",
  ) => {
    if (!result?.ok || !result.data?.records) return;
    for (const record of result.data.records) {
      const size = record.size || 0;
      const left = record.sizeleft || 0;
      // A tracked-download "warning" state is how Servarr reports a stalled
      // or failed import — that's the thing worth surfacing, not the raw status.
      const hasError =
        record.trackedDownloadStatus === "warning" ||
        record.trackedDownloadStatus === "error" ||
        Boolean(record.errorMessage);

      items.push({
        id: record.id,
        source,
        title: record.title,
        status: record.status,
        state: record.trackedDownloadState ?? null,
        size,
        sizeLeft: left,
        progress: size > 0 ? (size - left) / size : 0,
        timeLeft: record.timeleft ?? null,
        errorMessage:
          record.errorMessage ??
          record.statusMessages?.flatMap((message) => message.messages ?? [])[0] ??
          null,
        hasError,
        downloadClient: record.downloadClient ?? null,
        indexer: record.indexer ?? null,
      });
    }
  };

  collect(sonarrQueue, "sonarr");
  collect(radarrQueue, "radarr");

  // Problems first — a failed import is why you opened this page.
  items.sort((a, b) => {
    if (a.hasError !== b.hasError) return a.hasError ? -1 : 1;
    return b.progress - a.progress;
  });

  return {
    items,
    counts: {
      total: items.length,
      downloading: items.filter((item) => item.status === "downloading").length,
      failed: items.filter((item) => item.hasError).length,
      queued: items.filter((item) => item.status === "queued" || item.status === "delay").length,
    },
    totalBytesLeft: items.reduce((sum, item) => sum + item.sizeLeft, 0),
  };
}

/* ------------------------------------------------------------------ *
 * Subtitles
 * ------------------------------------------------------------------ */

export async function buildSubtitleState(): Promise<SubtitleState> {
  const empty: SubtitleState = {
    wantedEpisodes: 0,
    wantedMovies: 0,
    unhealthyProviders: 0,
    providers: [],
  };

  if (!bazarr.available) return empty;

  const [badges, providers] = await Promise.all([bazarr.badges(), bazarr.providers()]);

  const providerRows =
    providers.ok && Array.isArray(providers.data?.data)
      ? providers.data.data.map((provider) => ({
          name: provider.name,
          status: provider.status,
          healthy: /good|ok/i.test(provider.status),
        }))
      : [];

  return {
    wantedEpisodes: badges.ok ? (badges.data?.episodes ?? 0) : 0,
    wantedMovies: badges.ok ? (badges.data?.movies ?? 0) : 0,
    unhealthyProviders: badges.ok
      ? (badges.data?.providers ?? 0)
      : providerRows.filter((provider) => !provider.healthy).length,
    providers: providerRows,
  };
}
