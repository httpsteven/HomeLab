/**
 * Normalized shapes shared by the server collector and the browser.
 *
 * Pages consume ONLY these — never a vendor payload. Five services with five
 * different ideas of how to name a byte is exactly the mess this layer exists
 * to absorb.
 */

import type { ServiceId } from "./config";

export type SlotStatus = "idle" | "loading" | "ok" | "error" | "not-configured";

/** How a slot's data is arriving right now. Surfaced in the UI. */
export type SlotMode = "push" | "poll" | "idle";

export interface Slot<T> {
  status: SlotStatus;
  data: T | null;
  error: string | null;
  /** When the data was last successfully refreshed. Drives freshness labels. */
  fetchedAt: number | null;
  /** When we last *tried*, successful or not. */
  attemptedAt: number | null;
  mode: SlotMode;
  /** Consecutive failures — drives backoff and the "degraded" label. */
  failures: number;
}

/* ------------------------------------------------------------------ *
 * Activity — who's watching what, right now
 * ------------------------------------------------------------------ */

export interface StreamView {
  id: string;
  title: string;
  /** "The Bear · S03E01" style secondary line. */
  subtitle: string | null;
  user: string;
  player: string;
  platform: string;
  state: "playing" | "paused" | "buffering";
  progress: number;
  durationMs: number;
  positionMs: number;
  /** Kilobits per second. */
  bandwidthKbps: number;
  transcode: "direct play" | "direct stream" | "transcode";
  videoDecision: string | null;
  audioDecision: string | null;
  /** Human summary: "4K HEVC → 1080p H.264". */
  qualitySummary: string | null;
  location: "lan" | "wan" | "unknown";
  isSecure: boolean;
  posterUrl: string | null;
  mediaType: string;
  ratingKey: string | null;
}

export interface ActivityState {
  streams: StreamView[];
  totalBandwidthKbps: number;
  lanBandwidthKbps: number;
  wanBandwidthKbps: number;
  counts: { total: number; directPlay: number; directStream: number; transcode: number };
  /** Dominant color sampled from the top stream's poster — ambient accent. */
  accent: string | null;
}

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

export interface MountView {
  path: string;
  label: string;
  total: number;
  free: number;
  used: number;
  usedFraction: number;
  /** Which services reported this mount — mounts are deduped by path. */
  sources: ServiceId[];
  /** True when Glances (not an *arr) reported it: covers non-media disks too. */
  fromMachine: boolean;
  fsType?: string;
  device?: string;
}

export interface LargestItem {
  id: number;
  kind: "movie" | "series";
  title: string;
  year: number | null;
  size: number;
  /** For series: size per episode, the useful outlier signal. */
  sizePerEpisode: number | null;
  episodeCount: number | null;
  quality: string | null;
  codec: string | null;
  path: string;
}

export interface StorageState {
  mounts: MountView[];
  totals: { capacity: number; used: number; free: number };
  /** Library bytes as reported by the *arr apps (not the same as disk used). */
  libraryBytes: { movies: number; series: number; total: number };
  largest: LargestItem[];
}

/* ------------------------------------------------------------------ *
 * Library
 * ------------------------------------------------------------------ */

export interface QualityBucket {
  name: string;
  count: number;
  bytes: number;
}

export interface LibraryItem {
  id: number;
  kind: "movie" | "series";
  title: string;
  year: number | null;
  size: number;
  monitored: boolean;
  /** Movies: hasFile. Series: fraction of episodes present. */
  completeness: number;
  quality: string | null;
  codec: string | null;
  resolution: string | null;
  added: string | null;
  episodeCount: number | null;
  episodeFileCount: number | null;
  path: string;
  genres: string[];
}

export interface LibraryState {
  movies: {
    total: number;
    withFile: number;
    missing: number;
    unmonitored: number;
    bytes: number;
  };
  series: {
    total: number;
    episodeCount: number;
    episodeFileCount: number;
    missingEpisodes: number;
    unmonitored: number;
    bytes: number;
    ended: number;
    continuing: number;
  };
  /** Plex's own view, via Tautulli — cross-checks the *arr numbers. */
  plexLibraries: { name: string; type: string; count: number; childCount: number | null }[];
  byQuality: QualityBucket[];
  byCodec: QualityBucket[];
  items: LibraryItem[];
}

/* ------------------------------------------------------------------ *
 * Machine (Glances)
 * ------------------------------------------------------------------ */

export interface MachineState {
  hostname: string | null;
  os: string | null;
  uptime: string | null;
  cpu: { total: number; user: number; system: number; iowait: number | null };
  perCore: number[];
  load: { min1: number; min5: number; min15: number; cores: number | null } | null;
  memory: { total: number; used: number; free: number; percent: number } | null;
  swap: { total: number; used: number; percent: number } | null;
  sensors: { label: string; value: number; unit: string; critical: number | null }[];
  network: { name: string; rxBytesPerSec: number; txBytesPerSec: number }[];
  diskIO: { name: string; readBytesPerSec: number; writeBytesPerSec: number }[];
  topProcesses: { name: string; cpu: number; memory: number; pid: number }[];
}

/* ------------------------------------------------------------------ *
 * Services & health
 * ------------------------------------------------------------------ */

export interface ServiceHealthView {
  id: ServiceId;
  label: string;
  configured: boolean;
  reachable: boolean;
  version: string | null;
  responseMs: number | null;
  error: string | null;
  /** The service's own health checks, where it publishes them. */
  issues: { level: "warning" | "critical" | "notice"; message: string; source: string }[];
  /** How this service's live data is arriving. */
  mode: SlotMode;
}

export interface ServicesState {
  services: ServiceHealthView[];
}

/* ------------------------------------------------------------------ *
 * Queue & subtitles
 * ------------------------------------------------------------------ */

export interface QueueItemView {
  id: number;
  source: "sonarr" | "radarr";
  title: string;
  status: string;
  state: string | null;
  size: number;
  sizeLeft: number;
  progress: number;
  timeLeft: string | null;
  errorMessage: string | null;
  hasError: boolean;
  downloadClient: string | null;
  indexer: string | null;
}

export interface QueueState {
  items: QueueItemView[];
  counts: { total: number; downloading: number; failed: number; queued: number };
  totalBytesLeft: number;
}

export interface SubtitleState {
  wantedEpisodes: number;
  wantedMovies: number;
  unhealthyProviders: number;
  providers: { name: string; status: string; healthy: boolean }[];
}

/* ------------------------------------------------------------------ *
 * The whole dashboard
 * ------------------------------------------------------------------ */

export interface DashboardState {
  activity: Slot<ActivityState>;
  storage: Slot<StorageState>;
  library: Slot<LibraryState>;
  machine: Slot<MachineState>;
  services: Slot<ServicesState>;
  queue: Slot<QueueState>;
  subtitles: Slot<SubtitleState>;
}

export type SlotKey = keyof DashboardState;

/** Snapshot record appended to data/history.jsonl. */
export interface HistorySnapshot {
  t: number;
  libraryBytes: { movies: number; series: number; total: number };
  counts: { movies: number; series: number; episodes: number };
  mounts: { path: string; total: number; used: number }[];
}
