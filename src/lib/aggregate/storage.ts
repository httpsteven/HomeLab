import "server-only";
import { glances } from "@/lib/clients/glances";
import { radarr } from "@/lib/clients/radarr";
import { sonarr } from "@/lib/clients/sonarr";
import type { ServiceId } from "@/lib/config";
import type { LargestItem, MountView, StorageState } from "@/lib/types";
import { getMovies, getSeries } from "./media-cache";

/**
 * Storage aggregation — the centerpiece of the dashboard.
 *
 * The subtle part is deduplication. Sonarr and Radarr both report /mnt/media
 * if both store there, and Glances reports it again from the OS. Counting it
 * three times would inflate total capacity enormously, so mounts are keyed by
 * path and merged, recording which services saw each one.
 */

/** Pseudo-filesystems that are not real storage and only add noise. */
const IGNORED_FS_TYPES = new Set([
  "tmpfs",
  "devtmpfs",
  "overlay",
  "squashfs",
  "ramfs",
  "devfs",
  "autofs",
  "proc",
  "sysfs",
  "cgroup",
  "cgroup2",
  "efivarfs",
  "fuse.snapfuse",
]);

const IGNORED_PATH_PREFIXES = ["/proc", "/sys", "/dev", "/run", "/snap", "/var/lib/docker"];

function isRealMount(path: string, fsType?: string): boolean {
  if (fsType && IGNORED_FS_TYPES.has(fsType.toLowerCase())) return false;
  return !IGNORED_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function labelForPath(path: string): string {
  if (path === "/") return "root";
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

export async function buildStorageState(): Promise<StorageState> {
  const [sonarrDisk, radarrDisk, glancesFs, movies, series] = await Promise.all([
    sonarr.available ? sonarr.diskSpace() : null,
    radarr.available ? radarr.diskSpace() : null,
    glances.available ? glances.fs() : null,
    getMovies(),
    getSeries(),
  ]);

  const byPath = new Map<string, MountView>();

  const addMount = (
    path: string,
    total: number,
    free: number,
    source: ServiceId,
    extra: { label?: string; fromMachine?: boolean; fsType?: string; device?: string } = {},
  ) => {
    if (!path || total <= 0) return;
    if (!isRealMount(path, extra.fsType)) return;

    const existing = byPath.get(path);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      // Glances reads the OS directly, so its numbers win on conflict.
      if (extra.fromMachine) {
        existing.total = total;
        existing.free = free;
        existing.used = total - free;
        existing.usedFraction = total > 0 ? (total - free) / total : 0;
        existing.fromMachine = true;
        existing.fsType = extra.fsType ?? existing.fsType;
        existing.device = extra.device ?? existing.device;
      }
      return;
    }

    byPath.set(path, {
      path,
      label: extra.label?.trim() || labelForPath(path),
      total,
      free,
      used: total - free,
      usedFraction: total > 0 ? (total - free) / total : 0,
      sources: [source],
      fromMachine: extra.fromMachine ?? false,
      fsType: extra.fsType,
      device: extra.device,
    });
  };

  if (sonarrDisk?.ok) {
    for (const disk of sonarrDisk.data ?? []) {
      addMount(disk.path, disk.totalSpace, disk.freeSpace, "sonarr", { label: disk.label });
    }
  }
  if (radarrDisk?.ok) {
    for (const disk of radarrDisk.data ?? []) {
      addMount(disk.path, disk.totalSpace, disk.freeSpace, "radarr", { label: disk.label });
    }
  }
  if (glancesFs?.ok) {
    for (const fs of glancesFs.data ?? []) {
      addMount(fs.mnt_point, fs.size, fs.free, "glances", {
        fromMachine: true,
        fsType: fs.fs_type,
        device: fs.device_name,
      });
    }
  }

  const mounts = [...byPath.values()].sort((a, b) => b.total - a.total);

  const totals = mounts.reduce(
    (acc, mount) => ({
      capacity: acc.capacity + mount.total,
      used: acc.used + mount.used,
      free: acc.free + mount.free,
    }),
    { capacity: 0, used: 0, free: 0 },
  );

  const movieBytes = movies.items.reduce((sum, movie) => sum + (movie.sizeOnDisk || 0), 0);
  const seriesBytes = series.items.reduce(
    (sum, item) => sum + (item.statistics?.sizeOnDisk || 0),
    0,
  );

  /* --- What's eating the space ------------------------------------------
     Movies and series ranked together. For series we also compute size per
     episode, which is what actually catches a season grabbed at remux
     quality — a 400GB show is fine if it's 200 episodes, and alarming if
     it's 10. */
  const largestMovies: LargestItem[] = movies.items
    .filter((movie) => movie.sizeOnDisk > 0)
    .map((movie) => ({
      id: movie.id,
      kind: "movie" as const,
      title: movie.title,
      year: movie.year ?? null,
      size: movie.sizeOnDisk,
      sizePerEpisode: null,
      episodeCount: null,
      quality: movie.movieFile?.quality?.quality?.name ?? null,
      codec: movie.movieFile?.mediaInfo?.videoCodec ?? null,
      path: movie.path,
    }));

  const largestSeries: LargestItem[] = series.items
    .filter((item) => (item.statistics?.sizeOnDisk ?? 0) > 0)
    .map((item) => {
      const size = item.statistics?.sizeOnDisk ?? 0;
      const episodes = item.statistics?.episodeFileCount ?? 0;
      return {
        id: item.id,
        kind: "series" as const,
        title: item.title,
        year: item.year ?? null,
        size,
        sizePerEpisode: episodes > 0 ? size / episodes : null,
        episodeCount: episodes,
        quality: null,
        codec: null,
        path: item.path,
      };
    });

  const largest = [...largestMovies, ...largestSeries]
    .sort((a, b) => b.size - a.size)
    .slice(0, 250);

  return {
    mounts,
    totals,
    libraryBytes: {
      movies: movieBytes,
      series: seriesBytes,
      total: movieBytes + seriesBytes,
    },
    largest,
  };
}
