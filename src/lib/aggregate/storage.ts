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
 * The whole difficulty here is counting each byte exactly once. The same
 * physical filesystem reaches us through up to three different names:
 *
 *   1. Sonarr and Radarr both report /mnt/media if both store there.
 *   2. Glances runs with the host root bind-mounted at /rootfs, so it reports
 *      every filesystem a second time under that prefix.
 *   3. A union filesystem (mergerfs) presents one pool whose capacity is the
 *      SUM of member drives that are themselves separately mounted.
 *
 * Miss any of those and total capacity silently doubles.
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

/**
 * Individual FILES that Docker bind-mounts into a container.
 *
 * Glances running in a container sees these as separate "filesystems" and
 * reports each with the size of the underlying disk — so /etc/hostname shows
 * up as another 195 GB volume identical to root, inflating total capacity.
 * They are not storage.
 */
const IGNORED_EXACT_PATHS = new Set([
  "/etc/hostname",
  "/etc/hosts",
  "/etc/resolv.conf",
  "/etc/localtime",
  "/etc/timezone",
]);

/** Union filesystems: one pool spanning several real drives. */
const UNION_FS_TYPES = ["mergerfs", "unionfs", "aufs", "mhddfs", "overlayfs"];

/**
 * Glances is normally run with `-v /:/rootfs:ro`, so it sees the host's
 * filesystems under that prefix and reports e.g. /rootfs/mnt/srv1. That's the
 * same disk Sonarr calls /mnt/srv1 — without stripping this, every drive is
 * counted twice.
 */
function stripRootfsPrefix(path: string): string {
  if (path === "/rootfs") return "/";
  if (path.startsWith("/rootfs/")) return path.slice("/rootfs".length);
  return path;
}

function isRealMount(path: string, fsType?: string): boolean {
  if (fsType && IGNORED_FS_TYPES.has(fsType.toLowerCase())) return false;
  if (IGNORED_EXACT_PATHS.has(path)) return false;
  return !IGNORED_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Servarr's `label` is whatever fstab used, which on Linux is usually a UUID
 * or a /dev/disk/by-id path — unreadable as a heading. Fall back to the mount
 * path in that case.
 */
function isDeviceishLabel(label: string): boolean {
  return (
    label.startsWith("/dev/") ||
    label.startsWith("UUID=") ||
    label.includes(":") ||
    /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(label) ||
    label.length > 24
  );
}

function labelForPath(path: string): string {
  if (path === "/") return "root";
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function cleanLabel(rawLabel: string | undefined, path: string): string {
  const label = rawLabel?.trim();
  if (!label || isDeviceishLabel(label)) return labelForPath(path);
  return label;
}

/**
 * A union mount advertises its branches in the device field, colon-joined:
 * "/mnt/srv1:/mnt/srv2:/mnt/srv3". That's the signal we use — it also names
 * exactly which mounts to exclude from the totals.
 */
function unionBranches(device: string | undefined, fsType: string | undefined): string[] | null {
  const byType = fsType && UNION_FS_TYPES.some((type) => fsType.toLowerCase().includes(type));
  const device_ = device?.trim();

  if (!device_ || !device_.includes(":")) return byType ? [] : null;

  const parts = device_.split(":").map((part) => part.trim()).filter(Boolean);
  // Every branch is an absolute path — distinguishes a mergerfs device from
  // something like an NFS "host:/export".
  if (parts.length >= 2 && parts.every((part) => part.startsWith("/"))) return parts;

  return byType ? [] : null;
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
  /** Device → canonical path, so the same device under two names merges. */
  const byDevice = new Map<string, string>();

  const addMount = (
    rawPath: string,
    total: number,
    free: number,
    source: ServiceId,
    extra: { label?: string; fromMachine?: boolean; fsType?: string; device?: string } = {},
  ) => {
    const path = stripRootfsPrefix(rawPath);
    if (!path || total <= 0) return;
    if (!isRealMount(path, extra.fsType)) return;

    const device = extra.device?.trim();
    const branches = unionBranches(device ?? extra.label, extra.fsType);
    const isPool = branches !== null;

    // A device seen under a second path is the same filesystem. Union mounts
    // are exempt: their "device" is a branch list, not a block device, and
    // several pools could legitimately share one.
    if (device && !isPool) {
      const existingPath = byDevice.get(device);
      if (existingPath && existingPath !== path) {
        const existing = byPath.get(existingPath);
        if (existing) {
          if (!existing.sources.includes(source)) existing.sources.push(source);
          if (extra.fromMachine) {
            existing.fsType = extra.fsType ?? existing.fsType;
            existing.fromMachine = true;
          }
          return;
        }
      }
    }

    const existing = byPath.get(path);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      // Register the device here as well as on creation. A mount first seen
      // from Sonarr (which reports no device) would otherwise never enter the
      // device index, so a later entry for the same device — Glances reporting
      // a bind-mounted file, say — looked like a separate filesystem.
      if (device && !isPool && !byDevice.has(device)) byDevice.set(device, path);
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
      if (isPool && branches && branches.length > 0) {
        existing.isPool = true;
        existing.poolMembers = branches;
      }
      return;
    }

    if (device && !isPool) byDevice.set(device, path);

    byPath.set(path, {
      path,
      label: cleanLabel(extra.label, path),
      total,
      free,
      used: total - free,
      usedFraction: total > 0 ? (total - free) / total : 0,
      sources: [source],
      fromMachine: extra.fromMachine ?? false,
      fsType: extra.fsType,
      device: extra.device,
      isPool,
      poolMembers: branches && branches.length > 0 ? branches : undefined,
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

  /* --- Mark pool members ------------------------------------------------
     A mergerfs pool reports capacity equal to the sum of its branches. Those
     branches are usually mounted individually too, so counting both tells you
     you have twice the storage you actually have. Members stay visible — they
     are the physical drives, and per-drive fullness matters — but they are
     excluded from the totals. */
  const mounts = [...byPath.values()];
  for (const pool of mounts) {
    if (!pool.isPool || !pool.poolMembers) continue;
    for (const memberPath of pool.poolMembers) {
      const member = byPath.get(stripRootfsPrefix(memberPath));
      if (member && member.path !== pool.path) member.partOfPool = pool.path;
    }
  }

  const sorted = mounts.sort((a, b) => b.total - a.total);

  // Only mounts that aren't inside a pool contribute to the totals.
  const counted = sorted.filter((mount) => !mount.partOfPool);
  const totals = counted.reduce(
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
    mounts: sorted,
    totals,
    libraryBytes: {
      movies: movieBytes,
      series: seriesBytes,
      total: movieBytes + seriesBytes,
    },
    largest,
  };
}
