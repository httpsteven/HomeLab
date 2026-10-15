import "server-only";

/**
 * Service configuration, read from the environment.
 *
 * Every service is optional. A service with no URL or no key is "not
 * configured" rather than broken — the dashboard renders a neutral empty
 * state for it and everything else keeps working. That means you can wire
 * services up one at a time and always have a usable dashboard.
 */

export type ServiceId =
  | "plex"
  | "tautulli"
  | "sonarr"
  | "radarr"
  | "bazarr"
  | "glances"
  | "shorts";

export interface ServiceConfig {
  id: ServiceId;
  label: string;
  url: string | null;
  apiKey: string | null;
  /** Glances has no auth, so a URL alone is enough to be configured. */
  requiresKey: boolean;
  /**
   * A file on disk rather than an endpoint.
   *
   * `url` then holds a path, which must not be run through normalizeUrl —
   * that would turn /app/data/shorts.db into http:///app/data/shorts.db.
   */
  local?: boolean;
}

/**
 * Where the shorts pipeline's database lives.
 *
 * Defined here rather than in the client so the service registry and the
 * client cannot disagree about it — a disagreement would show as "not
 * configured" on /setup while the page itself worked perfectly.
 */
export function shortsDatabasePath(): string {
  const configured = process.env.SHORTS_DB_PATH?.trim();
  return configured || `${process.cwd()}/data/shorts.db`;
}

/** Strip trailing slashes so we can always join with a leading-slash path. */
function normalizeUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const withProtocol = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  return withProtocol.replace(/\/+$/, "");
}

function clean(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value ? value : null;
}

export const SERVICE_LABELS: Record<ServiceId, string> = {
  plex: "Plex",
  tautulli: "Tautulli",
  sonarr: "Sonarr",
  radarr: "Radarr",
  bazarr: "Bazarr",
  glances: "Glances",
  shorts: "Shorts",
};

export function getServiceConfig(id: ServiceId): ServiceConfig {
  const env = process.env;
  const map: Record<ServiceId, { url?: string; key?: string; requiresKey: boolean }> = {
    plex: { url: env.PLEX_URL, key: env.PLEX_TOKEN, requiresKey: true },
    tautulli: { url: env.TAUTULLI_URL, key: env.TAUTULLI_API_KEY, requiresKey: true },
    sonarr: { url: env.SONARR_URL, key: env.SONARR_API_KEY, requiresKey: true },
    radarr: { url: env.RADARR_URL, key: env.RADARR_API_KEY, requiresKey: true },
    bazarr: { url: env.BAZARR_URL, key: env.BAZARR_API_KEY, requiresKey: true },
    glances: { url: env.GLANCES_URL, key: undefined, requiresKey: false },
    // Shorts is a local SQLite file, not a network service. It has no URL
    // and no key; `isConfigured` for it is "does the file exist", which
    // lives in the client. The entry exists so /setup and /api/diag list it
    // alongside everything else.
    shorts: { url: shortsDatabasePath(), key: undefined, requiresKey: false },
  };

  const entry = map[id];
  const local = id === "shorts";
  return {
    id,
    label: SERVICE_LABELS[id],
    url: local ? (clean(entry.url) ?? null) : normalizeUrl(entry.url),
    apiKey: clean(entry.key),
    requiresKey: entry.requiresKey,
    local,
  };
}

export function isConfigured(config: ServiceConfig): boolean {
  if (!config.url) return false;
  if (config.requiresKey && !config.apiKey) return false;
  // A local service is configured once it has a path. Whether the file opens
  // is the PROBE's job to report — "configured but failing, here's why" is
  // actionable, where "not configured" sends you looking for a setting that is
  // already set.
  return true;
}

export function allServices(): ServiceConfig[] {
  return (Object.keys(SERVICE_LABELS) as ServiceId[]).map(getServiceConfig);
}

/** Glances API version — v4 is current, v3 is still common in the wild. */
export function glancesApiVersion(): number {
  const raw = Number(process.env.GLANCES_API_VERSION);
  return Number.isFinite(raw) && raw > 0 ? raw : 4;
}

/**
 * Filename for the library-size history, inside the fixed `data/` directory.
 *
 * Deliberately a bare filename rather than a full path: a dynamic path built
 * from cwd makes the bundler trace the entire project into the server output.
 * Keeping the directory static and only the filename configurable avoids that
 * and stops the setting from being able to point anywhere on disk.
 */
export function historyFileName(): string {
  const raw = process.env.HISTORY_FILE?.trim();
  if (!raw) return "history.jsonl";
  // Strip any directory component — this names a file in data/, nothing else.
  const base = raw.split("/").pop() ?? "history.jsonl";
  return /^[\w.-]+$/.test(base) ? base : "history.jsonl";
}

/** Capacity thresholds for storage warnings, as a fraction used. */
export const CAPACITY_THRESHOLDS = {
  warning: 0.8,
  critical: 0.9,
} as const;

/**
 * Which services are worth waking someone for when they stop responding.
 *
 * Plex only, by default, because it is the only one whose absence anybody
 * notices: if Plex is down nobody can watch anything. Sonarr, Radarr and
 * Bazarr automate acquisition, which on a rip-based library is a convenience
 * rather than the service itself — and Tautulli and Glances only observe. A
 * restart of any of those produces an alert that needs no action, and alerts
 * that need no action are how people learn to ignore alerts.
 *
 * They all still appear on the Health page with their real status. This
 * governs who gets woken up, not what gets shown.
 *
 * Override with ALERT_SERVICES=plex,sonarr — or ALERT_SERVICES=none to stop
 * unreachability alerting entirely.
 */
export function alertingServices(): Set<string> {
  const raw = process.env.ALERT_SERVICES?.trim();
  if (!raw) return new Set(["plex"]);
  if (raw.toLowerCase() === "none") return new Set();
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean),
  );
}
