import "server-only";
import type {
  ActivityState,
  HistorySnapshot,
  LibraryItem,
  LibraryState,
  MachineState,
  QueueState,
  ServicesState,
  StorageState,
  SubtitleState,
} from "./types";

/**
 * Demo mode — set DEMO_MODE=1 in .env.local.
 *
 * Generates plausible data in the exact shapes the real aggregators produce,
 * so the dashboard can be evaluated (and the layout verified) before any
 * credentials exist. Values drift slightly between polls so live behaviour —
 * count-ups, sparklines, freshness — is visible rather than frozen.
 *
 * This never touches the network and is completely inert unless the env var
 * is set.
 */

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1" || process.env.DEMO_MODE === "true";
}

const GB = 1024 ** 3;
const TB = 1024 ** 4;

/** Deterministic pseudo-random so the same title always gets the same size. */
function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

const MOVIE_TITLES = [
  "Blade Runner 2049", "Dune", "Arrival", "Sicario", "Prisoners", "Heat",
  "The Thing", "Alien", "Aliens", "Children of Men", "Mad Max: Fury Road",
  "No Country for Old Men", "There Will Be Blood", "The Social Network",
  "Whiplash", "Parasite", "Oldboy", "Memories of Murder", "Burning",
  "The Handmaiden", "Drive", "Nightcrawler", "Zodiac", "Se7en", "Fight Club",
  "The Prestige", "Inception", "Interstellar", "Tenet", "Dunkirk",
  "The Master", "Phantom Thread", "Licorice Pizza", "Inherent Vice",
  "Annihilation", "Ex Machina", "Under the Skin", "The Lighthouse",
  "The Witch", "Hereditary", "Midsommar", "Get Out", "Us", "Nope",
  "Everything Everywhere All at Once", "The Green Knight", "First Reformed",
  "Uncut Gems", "Good Time", "Marriage Story",
];

const SERIES_TITLES = [
  "The Bear", "Severance", "Succession", "Better Call Saul", "Breaking Bad",
  "The Wire", "The Sopranos", "Mad Men", "Chernobyl", "Band of Brothers",
  "True Detective", "Fargo", "Barry", "Atlanta", "Reservation Dogs",
  "Andor", "The Expanse", "Dark", "Twin Peaks", "Deadwood",
  "Halt and Catch Fire", "Rectify", "The Leftovers", "Watchmen", "Devs",
];

const QUALITIES = ["Bluray-2160p", "Bluray-1080p", "WEBDL-2160p", "WEBDL-1080p", "WEBRip-1080p", "Bluray-720p"];
const CODECS = ["HEVC / H.265", "H.264", "AV1"];

/* ------------------------------------------------------------------ */

export function demoLibrary(): LibraryState {
  const items: LibraryItem[] = [];
  const random = seeded(42);

  let movieBytes = 0;
  let moviesWithFile = 0;
  let moviesUnmonitored = 0;

  // 1,284 movies: the named ones plus filler, so tables and counts are real.
  for (let index = 0; index < 1284; index += 1) {
    const title =
      index < MOVIE_TITLES.length
        ? MOVIE_TITLES[index]
        : `${MOVIE_TITLES[index % MOVIE_TITLES.length]} ${Math.floor(index / MOVIE_TITLES.length) + 1}`;

    const roll = random();
    const hasFile = roll > 0.06;
    const is4k = roll > 0.72;
    const size = hasFile
      ? (is4k ? 28 + random() * 45 : 4 + random() * 12) * GB
      : 0;

    movieBytes += size;
    if (hasFile) moviesWithFile += 1;
    const monitored = random() > 0.12;
    if (!monitored) moviesUnmonitored += 1;

    items.push({
      id: index + 1,
      kind: "movie",
      title,
      year: 1975 + Math.floor(random() * 50),
      size,
      monitored,
      completeness: hasFile ? 1 : 0,
      quality: hasFile ? (is4k ? QUALITIES[Math.floor(random() * 3)] : QUALITIES[3 + Math.floor(random() * 3)]) : null,
      codec: hasFile ? CODECS[Math.floor(random() * (is4k ? 2 : 3))] : null,
      resolution: is4k ? "3840x2160" : "1920x1080",
      added: new Date(Date.now() - random() * 900 * 86400000).toISOString(),
      episodeCount: null,
      episodeFileCount: null,
      path: `/mnt/media/movies/${title.replace(/[^a-z0-9]+/gi, ".")}`,
      genres: [],
    });
  }

  let seriesBytes = 0;
  let episodeCount = 0;
  let episodeFileCount = 0;
  let seriesUnmonitored = 0;
  let ended = 0;

  for (let index = 0; index < 96; index += 1) {
    const title =
      index < SERIES_TITLES.length
        ? SERIES_TITLES[index]
        : `${SERIES_TITLES[index % SERIES_TITLES.length]} ${Math.floor(index / SERIES_TITLES.length) + 1}`;

    const episodes = 8 + Math.floor(random() * 80);
    const files = Math.max(0, episodes - Math.floor(random() * 6));
    const perEpisode = (1.2 + random() * 7) * GB;
    const size = files * perEpisode;

    seriesBytes += size;
    episodeCount += episodes;
    episodeFileCount += files;
    const monitored = random() > 0.15;
    if (!monitored) seriesUnmonitored += 1;
    const isEnded = random() > 0.55;
    if (isEnded) ended += 1;

    items.push({
      id: 10000 + index,
      kind: "series",
      title,
      year: 1999 + Math.floor(random() * 26),
      size,
      monitored,
      completeness: episodes > 0 ? files / episodes : 0,
      quality: QUALITIES[Math.floor(random() * QUALITIES.length)],
      codec: null,
      resolution: null,
      added: new Date(Date.now() - random() * 900 * 86400000).toISOString(),
      episodeCount: episodes,
      episodeFileCount: files,
      path: `/mnt/media/tv/${title.replace(/[^a-z0-9]+/gi, ".")}`,
      genres: [],
    });
  }

  // Roll the per-item facts up into the distribution buckets.
  const qualityMap = new Map<string, { name: string; count: number; bytes: number }>();
  const codecMap = new Map<string, { name: string; count: number; bytes: number }>();
  for (const item of items) {
    if (item.size <= 0) continue;
    if (item.quality) {
      const entry = qualityMap.get(item.quality) ?? { name: item.quality, count: 0, bytes: 0 };
      entry.count += 1;
      entry.bytes += item.size;
      qualityMap.set(item.quality, entry);
    }
    if (item.codec) {
      const entry = codecMap.get(item.codec) ?? { name: item.codec, count: 0, bytes: 0 };
      entry.count += 1;
      entry.bytes += item.size;
      codecMap.set(item.codec, entry);
    }
  }

  return {
    movies: {
      total: 1284,
      withFile: moviesWithFile,
      missing: 1284 - moviesWithFile,
      unmonitored: moviesUnmonitored,
      bytes: movieBytes,
    },
    series: {
      total: 96,
      episodeCount,
      episodeFileCount,
      missingEpisodes: episodeCount - episodeFileCount,
      unmonitored: seriesUnmonitored,
      bytes: seriesBytes,
      ended,
      continuing: 96 - ended,
    },
    plexLibraries: [
      { name: "Movies", type: "movie", count: moviesWithFile, childCount: null },
      { name: "TV Shows", type: "show", count: 96, childCount: episodeFileCount },
    ],
    byQuality: [...qualityMap.values()].sort((a, b) => b.bytes - a.bytes),
    byCodec: [...codecMap.values()].sort((a, b) => b.bytes - a.bytes),
    items: items.sort((a, b) => a.title.localeCompare(b.title)),
  };
}

export function demoStorage(library: LibraryState): StorageState {
  // Disk usage is derived from library size (plus ~6% for artwork, subtitles
  // and stray files) so the numbers agree with each other the way they would
  // on a real server. Hardcoding both would let them drift apart and make the
  // dashboard look wrong when it isn't.
  const movieUsed = library.movies.bytes * 1.06;
  const seriesUsed = library.series.bytes * 1.06;

  const mounts = [
    { path: "/mnt/media/movies", label: "movies", total: 34 * TB, used: movieUsed, fsType: "ext4", device: "/dev/sdb1" },
    { path: "/mnt/media/tv", label: "tv", total: 22 * TB, used: seriesUsed, fsType: "ext4", device: "/dev/sdc1" },
    { path: "/mnt/downloads", label: "downloads", total: 2 * TB, used: 0.42 * TB, fsType: "ext4", device: "/dev/sdd1" },
    { path: "/", label: "root", total: 460 * GB, used: 128 * GB, fsType: "ext4", device: "/dev/sda2" },
  ].map((mount) => ({
    ...mount,
    free: mount.total - mount.used,
    usedFraction: mount.used / mount.total,
    sources: ["sonarr", "radarr", "glances"] as StorageState["mounts"][number]["sources"],
    fromMachine: true,
  }));

  const totals = mounts.reduce(
    (acc, mount) => ({
      capacity: acc.capacity + mount.total,
      used: acc.used + mount.used,
      free: acc.free + mount.free,
    }),
    { capacity: 0, used: 0, free: 0 },
  );

  const largest = library.items
    .filter((item) => item.size > 0)
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      year: item.year,
      size: item.size,
      sizePerEpisode:
        item.kind === "series" && item.episodeFileCount
          ? item.size / item.episodeFileCount
          : null,
      episodeCount: item.episodeFileCount,
      quality: item.quality,
      codec: item.codec,
      path: item.path,
    }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 250);

  return {
    mounts,
    totals,
    libraryBytes: {
      movies: library.movies.bytes,
      series: library.series.bytes,
      total: library.movies.bytes + library.series.bytes,
    },
    largest,
  };
}

export function demoActivity(): ActivityState {
  // Drift the bandwidth a little each poll so live updates are visible.
  const jitter = () => 0.92 + Math.random() * 0.16;

  const streams: ActivityState["streams"] = [
    {
      id: "demo-1",
      title: "Severance",
      subtitle: "Severance — Season 2 · Cold Harbor",
      user: "steven",
      player: "Apple TV",
      platform: "tvOS",
      state: "playing",
      progress: 0.34 + (Date.now() % 60000) / 600000,
      durationMs: 3_240_000,
      positionMs: 1_100_000,
      bandwidthKbps: Math.round(24_800 * jitter()),
      transcode: "direct play",
      videoDecision: "direct play",
      audioDecision: "direct play",
      qualitySummary: "4K HEVC",
      location: "lan",
      isSecure: true,
      posterUrl: null,
      mediaType: "episode",
      ratingKey: "demo-1",
    },
    {
      id: "demo-2",
      title: "Blade Runner 2049",
      subtitle: "2017",
      user: "guest",
      player: "Chrome",
      platform: "Windows",
      state: "playing",
      progress: 0.71,
      durationMs: 9_780_000,
      positionMs: 6_943_800,
      bandwidthKbps: Math.round(8_200 * jitter()),
      transcode: "transcode",
      videoDecision: "transcode",
      audioDecision: "direct stream",
      qualitySummary: "4K HEVC → 1080p H.264",
      location: "wan",
      isSecure: true,
      posterUrl: null,
      mediaType: "movie",
      ratingKey: "demo-2",
    },
  ];

  const total = streams.reduce((sum, stream) => sum + stream.bandwidthKbps, 0);

  return {
    streams,
    totalBandwidthKbps: total,
    lanBandwidthKbps: streams[0].bandwidthKbps,
    wanBandwidthKbps: streams[1].bandwidthKbps,
    counts: { total: 2, directPlay: 1, directStream: 0, transcode: 1 },
    // A fixed teal so the ambient wash is visible in demo without a poster
    // to sample from.
    accent: "#2f9e8f",
  };
}

export function demoMachine(): MachineState {
  const wave = (offset: number, amplitude: number, base: number) =>
    base + Math.sin(Date.now() / 12000 + offset) * amplitude + Math.random() * 3;

  return {
    hostname: "vault",
    os: "Ubuntu 24.04.1 LTS",
    uptime: "42 days, 6:18:04",
    cpu: {
      total: Math.max(2, Math.min(98, wave(0, 14, 26))),
      user: 18.4,
      system: 6.1,
      iowait: 1.2,
    },
    perCore: Array.from({ length: 12 }, (_, index) =>
      Math.max(1, Math.min(99, wave(index, 22, 25))),
    ),
    load: { min1: 2.14, min5: 1.87, min15: 1.62, cores: 12 },
    memory: {
      total: 64 * GB,
      used: 38.4 * GB + Math.random() * GB,
      free: 25.6 * GB,
      percent: 60 + Math.random() * 3,
    },
    swap: { total: 8 * GB, used: 0.4 * GB, percent: 5 },
    sensors: [
      { label: "Package id 0", value: 52 + Math.random() * 8, unit: "C", critical: 100 },
      { label: "NVMe", value: 41 + Math.random() * 4, unit: "C", critical: 85 },
      { label: "HDD sdb", value: 38 + Math.random() * 3, unit: "C", critical: 60 },
    ],
    network: [
      {
        name: "eno1",
        rxBytesPerSec: 4_200_000 + Math.random() * 2_000_000,
        txBytesPerSec: 31_000_000 + Math.random() * 9_000_000,
      },
    ],
    diskIO: [
      { name: "sdb", readBytesPerSec: 42_000_000 + Math.random() * 20_000_000, writeBytesPerSec: 1_200_000 },
      { name: "sdc", readBytesPerSec: 8_000_000, writeBytesPerSec: 240_000 },
      { name: "nvme0n1", readBytesPerSec: 900_000, writeBytesPerSec: 12_000_000 },
    ],
    topProcesses: [
      { name: "Plex Transcoder", cpu: 212.4, memory: 3.1, pid: 3841 },
      { name: "Plex Media Server", cpu: 18.2, memory: 4.8, pid: 1204 },
      { name: "qbittorrent-nox", cpu: 6.4, memory: 2.2, pid: 998 },
      { name: "sonarr", cpu: 2.1, memory: 3.4, pid: 1442 },
      { name: "radarr", cpu: 1.8, memory: 3.2, pid: 1443 },
      { name: "bazarr", cpu: 0.9, memory: 1.9, pid: 1444 },
    ],
  };
}

export function demoServices(): ServicesState {
  return {
    services: [
      { id: "plex", label: "Plex", configured: true, reachable: true, version: "1.41.3.9314", responseMs: 12, error: null, issues: [], mode: "push" },
      { id: "tautulli", label: "Tautulli", configured: true, reachable: true, version: "1.41.3.9314", responseMs: 24, error: null, issues: [], mode: "poll" },
      {
        id: "sonarr", label: "Sonarr", configured: true, reachable: true, version: "4.0.10.2544", responseMs: 18, error: null,
        issues: [{ level: "warning", message: "Indexer 'NZBgeek' is unavailable due to failures for more than 6 hours", source: "IndexerStatusCheck" }],
        mode: "push",
      },
      { id: "radarr", label: "Radarr", configured: true, reachable: true, version: "5.14.0.9383", responseMs: 21, error: null, issues: [], mode: "push" },
      {
        id: "bazarr", label: "Bazarr", configured: true, reachable: true, version: "1.4.5", responseMs: 33, error: null,
        issues: [{ level: "warning", message: "Provider 'opensubtitles.com' reached its daily download limit", source: "Providers" }],
        mode: "push",
      },
      { id: "glances", label: "Glances", configured: true, reachable: true, version: "API v4", responseMs: 9, error: null, issues: [], mode: "poll" },
    ],
  };
}

export function demoQueue(): QueueState {
  const items: QueueState["items"] = [
    {
      id: 1, source: "sonarr", title: "The.Bear.S03E05.2160p.WEB-DL.DDP5.1.HDR.H.265",
      status: "downloading", state: "downloading", size: 6.8 * GB, sizeLeft: 2.1 * GB,
      progress: 0.69, timeLeft: "00:04:12", errorMessage: null, hasError: false,
      downloadClient: "qBittorrent", indexer: "NZBgeek",
    },
    {
      id: 2, source: "radarr", title: "Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX",
      status: "downloading", state: "downloading", size: 82 * GB, sizeLeft: 61 * GB,
      progress: 0.256, timeLeft: "01:22:40", errorMessage: null, hasError: false,
      downloadClient: "qBittorrent", indexer: "PassThePopcorn",
    },
    {
      id: 3, source: "sonarr", title: "Andor.S02E03.1080p.WEB-DL.DDP5.1.H.264",
      status: "completed", state: "importPending", size: 3.2 * GB, sizeLeft: 0,
      progress: 1,
      errorMessage: "One or more episodes expected in this release were not imported or missing from the release",
      hasError: true, timeLeft: null, downloadClient: "SABnzbd", indexer: "DrunkenSlug",
    },
  ];

  return {
    items,
    counts: { total: 3, downloading: 2, failed: 1, queued: 0 },
    totalBytesLeft: items.reduce((sum, item) => sum + item.sizeLeft, 0),
  };
}

export function demoSubtitles(): SubtitleState {
  return {
    wantedEpisodes: 34,
    wantedMovies: 12,
    unhealthyProviders: 1,
    providers: [
      { name: "opensubtitles.com", status: "Daily limit reached", healthy: false },
      { name: "podnapisi", status: "Good", healthy: true },
      { name: "subf2m", status: "Good", healthy: true },
      { name: "tvsubtitles", status: "Good", healthy: true },
    ],
  };
}

/**
 * 45 days of growth history, so the runway projection has something real to
 * fit. Movies grow steadily; TV grows in bursts as seasons land.
 */
export function demoHistory(): HistorySnapshot[] {
  const snapshots: HistorySnapshot[] = [];
  const now = Date.now();
  const random = seeded(7);

  // Work backwards from today's real totals so the history line lands exactly
  // where the current numbers are, instead of ending somewhere else.
  const library = demoLibrary();
  const endMovies = library.movies.bytes;
  const endSeries = library.series.bytes;

  const movieDeltas: number[] = [];
  const seriesDeltas: number[] = [];
  for (let day = 0; day <= 45; day += 1) {
    movieDeltas.push((8 + random() * 55) * GB);
    // Season drops: occasional big jumps rather than a smooth line.
    seriesDeltas.push(random() > 0.82 ? (90 + random() * 160) * GB : (4 + random() * 22) * GB);
  }

  const movieGrowth = movieDeltas.reduce((sum, delta) => sum + delta, 0);
  const seriesGrowth = seriesDeltas.reduce((sum, delta) => sum + delta, 0);

  let movieBytes = endMovies - movieGrowth;
  let seriesBytes = endSeries - seriesGrowth;
  let movieCount = library.movies.total - 60;
  let episodeCount = library.series.episodeFileCount - 300;

  for (let day = 45; day >= 0; day -= 1) {
    const index = 45 - day;
    const t = now - day * 86400000;

    movieBytes += movieDeltas[index];
    seriesBytes += seriesDeltas[index];
    movieCount += index % 3 === 0 ? 4 : 1;
    episodeCount += seriesDeltas[index] > 80 * GB ? 12 : 4;

    snapshots.push({
      t,
      libraryBytes: { movies: movieBytes, series: seriesBytes, total: movieBytes + seriesBytes },
      counts: { movies: movieCount, series: 96, episodes: episodeCount },
      mounts: [
        { path: "/mnt/media/movies", total: 34 * TB, used: movieBytes * 1.06 },
        { path: "/mnt/media/tv", total: 22 * TB, used: seriesBytes * 1.06 },
        { path: "/mnt/downloads", total: 2 * TB, used: (0.3 + random() * 0.25) * TB },
        { path: "/", total: 460 * GB, used: 128 * GB },
      ],
    });
  }

  return snapshots;
}
