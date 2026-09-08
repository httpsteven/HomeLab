/**
 * Formatting helpers. Shared by server and client, so no server-only import.
 *
 * Storage sizes use binary units (TiB) but the conventional labels (TB),
 * matching what Sonarr, Radarr and every NAS UI report — consistency with
 * the tools being aggregated matters more here than SI pedantry.
 */

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

export function formatBytes(bytes: number | null | undefined, decimals?: number): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  if (bytes === 0) return "0 B";

  const exponent = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)), SIZE_UNITS.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  // Larger units earn more precision; bytes and KB never need decimals.
  const places = decimals ?? (exponent >= 3 ? 2 : exponent >= 2 ? 1 : 0);
  return `${value.toFixed(places)} ${SIZE_UNITS[exponent]}`;
}

/** Split form, for when the unit is styled separately from the number. */
export function splitBytes(bytes: number | null | undefined, decimals?: number): {
  value: string;
  unit: string;
} {
  const formatted = formatBytes(bytes, decimals);
  if (formatted === "—") return { value: "—", unit: "" };
  const [value, unit] = formatted.split(" ");
  return { value, unit };
}

export function formatBitrate(kbps: number | null | undefined): string {
  if (!kbps || !Number.isFinite(kbps)) return "—";
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US");
}

export function formatPercent(fraction: number | null | undefined, decimals = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/** Compact duration from milliseconds: 2d 4h, 3h 12m, 45s. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/** Runtime in minutes → 2h 14m. */
export function formatRuntime(minutes: number | null | undefined): string {
  if (!minutes || !Number.isFinite(minutes)) return "—";
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

/**
 * Freshness label. Every live value carries one of these — a silently stale
 * number is worse than an obviously stale one.
 */
export function formatRelativeTime(timestamp: number | null | undefined, now = Date.now()): string {
  if (!timestamp || !Number.isFinite(timestamp)) return "never";

  const delta = now - timestamp;
  if (delta < 0) return "just now";
  if (delta < 3_000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

export function formatDate(input: string | number | Date | null | undefined): string {
  if (!input) return "—";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatTime(input: string | number | Date | null | undefined): string {
  if (!input) return "—";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Human title for a mount path: /mnt/media/movies → media/movies */
export function shortenPath(path: string, maxSegments = 2): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= maxSegments) return path;
  return `…/${segments.slice(-maxSegments).join("/")}`;
}
