import "server-only";
import { query, queryOne, shortsAvailable, writeLabState } from "@/lib/clients/shorts";
import { getSlot } from "@/lib/collect/store";
import type {
  ShortClip,
  ShortsJob,
  ShortsRun,
  ShortsState,
  ShortsTestRun,
  ShortsWorkerStatus,
  SubtitleAuditRow,
} from "@/lib/types";

/**
 * Builds the shorts slot.
 *
 * Deliberately a SUMMARY. The full clip list and the full audit table are
 * hundreds of KB on a real library and only one page needs either, so they come
 * from /api/shorts/clips and /api/shorts/audit on demand — the same reasoning
 * as the library-items route.
 */

/** Mirrors the worker's gate defaults; see yield_to_viewers in config.yaml. */
const RESUME_AFTER_IDLE_SECONDS = 300;
const HEARTBEAT_STALE_AFTER_SECONDS = 60;

interface ClipRow {
  clip_id: string;
  title: string | null;
  show: string | null;
  lookup_key: string;
  quote: string;
  category: string | null;
  start: number;
  end: number;
  duration: number;
  score: number;
  output: string;
  thumbnail: string | null;
  provenance: string | null;
  series_id: string | null;
  part_index: number | null;
  part_total: number | null;
  created_at: string;
  review_status: string | null;
}

export function toClip(row: ClipRow): ShortClip {
  return {
    id: row.clip_id,
    title: row.title,
    show: row.show,
    lookupKey: row.lookup_key,
    quote: row.quote,
    category: row.category,
    start: row.start,
    end: row.end,
    duration: row.duration,
    score: row.score,
    output: row.output,
    thumbnail: row.thumbnail,
    provenance: row.provenance,
    seriesId: row.series_id,
    partIndex: row.part_index,
    partTotal: row.part_total,
    createdAt: row.created_at,
    reviewStatus: row.review_status,
  };
}

const CLIP_COLUMNS = `
  s.clip_id, s.title, s.show, s.lookup_key, s.quote, s.category,
  s.start, s.end, s.duration, s.score, s.output, s.thumbnail,
  s.provenance, s.series_id, s.part_index, s.part_total, s.created_at,
  r.status AS review_status
`;

/** Every live clip. Soft-deleted rows are excluded everywhere. */
export function listClips(): ShortClip[] {
  return query<ClipRow>(
    `SELECT ${CLIP_COLUMNS}
       FROM shorts s LEFT JOIN review r ON r.clip_id = s.clip_id
      WHERE s.deleted_at IS NULL
      ORDER BY s.created_at DESC, s.part_index ASC`,
  ).map(toClip);
}

export function listAudit(): SubtitleAuditRow[] {
  return query<{
    path: string; title: string | null; show: string | null; kind: string | null;
    stream_count: number; codecs: string | null; languages: string | null;
    forced_streams: number; sidecars: number; reason: string | null;
    explanation: string | null; provenance: string | null; cue_count: number | null;
    coverage: number | null; usable: number; needs_whisper: number;
    est_minutes: number | null; checked_at: string | null;
  }>(
    `SELECT a.path, m.title, m.show, m.kind, a.stream_count, a.codecs, a.languages,
            a.forced_streams, a.sidecars, a.reason, a.explanation, a.provenance,
            a.cue_count, a.coverage, a.usable, a.needs_whisper, a.est_minutes,
            a.checked_at
       FROM subtitle_audit a JOIN media_items m ON m.path = a.path
      ORDER BY a.usable ASC, m.show, m.title`,
  ).map((row) => ({
    path: row.path,
    title: row.title,
    show: row.show,
    kind: row.kind,
    streamCount: row.stream_count,
    codecs: row.codecs,
    languages: row.languages,
    forcedStreams: row.forced_streams,
    sidecars: row.sidecars,
    reason: row.reason,
    explanation: row.explanation,
    provenance: row.provenance,
    cueCount: row.cue_count,
    coverage: row.coverage,
    usable: row.usable === 1,
    needsWhisper: row.needs_whisper === 1,
    estMinutes: row.est_minutes,
    checkedAt: row.checked_at,
  }));
}

function count(sql: string): number {
  return queryOne<{ n: number }>(sql)?.n ?? 0;
}

/**
 * The worker's gate decision, recomputed here for display.
 *
 * The worker makes its own call from the same row — this does not control
 * anything, it explains. A queue that looks stuck with no reason given is the
 * thing this exists to prevent.
 */
function workerStatus(): ShortsWorkerStatus {
  const row = queryOne<{
    active_streams: number;
    transcodes: number;
    last_activity_at: string | null;
    updated_at: string;
  }>("SELECT * FROM lab_state WHERE id = 1");

  if (!row) {
    return {
      paused: false,
      reason: "no heartbeat yet",
      activeStreams: 0,
      transcodes: 0,
      heartbeatAgeSeconds: null,
    };
  }

  const now = Date.now();
  const age = (now - Date.parse(row.updated_at)) / 1000;
  const base = {
    activeStreams: row.active_streams,
    transcodes: row.transcodes,
    heartbeatAgeSeconds: Math.round(age),
  };

  if (age > HEARTBEAT_STALE_AFTER_SECONDS) {
    return { ...base, paused: true, reason: `heartbeat ${Math.round(age)}s stale` };
  }
  if (row.active_streams > 0) {
    const plural = row.active_streams === 1 ? "" : "s";
    return { ...base, paused: true, reason: `${row.active_streams} stream${plural} active` };
  }
  if (row.last_activity_at) {
    const quiet = (now - Date.parse(row.last_activity_at)) / 1000;
    if (quiet < RESUME_AFTER_IDLE_SECONDS) {
      const left = Math.ceil((RESUME_AFTER_IDLE_SECONDS - quiet) / 60);
      return { ...base, paused: true, reason: `cooling down (~${left}m left)` };
    }
  }
  return { ...base, paused: false, reason: "clear to run" };
}

export async function buildShortsState(): Promise<ShortsState> {
  if (!shortsAvailable()) {
    throw new Error("shorts database not found");
  }

  // Publish the viewer heartbeat the pipeline's worker reads. Done here because
  // this runs on the collector's tick and the activity slot is already
  // populated — no extra call to Plex, no second poller.
  const activitySlot = getSlot("activity");
  if (activitySlot.data) {
    writeLabState(activitySlot.data.counts.total, activitySlot.data.counts.transcode);
  } else if (activitySlot.status === "not-configured") {
    // No viewer signal exists AT ALL, because Tautulli was never set up. Publish
    // "nobody watching" rather than going quiet: the worker treats a stale
    // heartbeat as "someone might be watching", so staying silent here would
    // pause the pipeline forever over an integration that is simply absent.
    //
    // Note the deliberate gap: if activity IS configured but currently failing,
    // we write nothing and let the heartbeat go stale. That's the case where we
    // genuinely don't know who's watching, and pausing is the right answer.
    writeLabState(0, 0);
  }

  const byReason = query<{ reason: string; explanation: string | null; n: number }>(
    `SELECT reason, explanation, COUNT(*) AS n
       FROM subtitle_audit WHERE usable = 0 AND reason IS NOT NULL
      GROUP BY reason ORDER BY n DESC`,
  ).map((row) => ({ reason: row.reason, explanation: row.explanation, count: row.n }));

  const byProvenance = query<{ provenance: string; n: number }>(
    `SELECT provenance, COUNT(*) AS n FROM shorts
      WHERE deleted_at IS NULL AND provenance IS NOT NULL
      GROUP BY provenance ORDER BY n DESC`,
  ).map((row) => ({ provenance: row.provenance, count: row.n }));

  const recentClips = query<ClipRow>(
    `SELECT ${CLIP_COLUMNS}
       FROM shorts s LEFT JOIN review r ON r.clip_id = s.clip_id
      WHERE s.deleted_at IS NULL
      ORDER BY s.created_at DESC LIMIT 12`,
  ).map(toClip);

  const jobs = query<{
    job_id: number; type: string; status: string; progress: number;
    detail: string | null; error: string | null; created_at: string;
    finished_at: string | null;
  }>(
    // Running and queued first so active work is never below history.
    `SELECT * FROM jobs
      ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
               job_id DESC
      LIMIT 25`,
  ).map<ShortsJob>((row) => ({
    id: row.job_id,
    type: row.type,
    status: row.status,
    progress: row.progress,
    detail: row.detail,
    error: row.error,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  }));

  const runs = query<{
    run_id: string; command: string; started_at: string; finished_at: string | null;
    items_seen: number; produced: number; skipped: number; reasons: string | null;
    error: string | null;
  }>("SELECT * FROM runs ORDER BY started_at DESC LIMIT 15").map<ShortsRun>((row) => {
    let reasons: { reason: string; count: number }[] = [];
    try {
      const parsed = JSON.parse(row.reasons ?? "{}") as Record<string, number>;
      reasons = Object.entries(parsed)
        .map(([reason, n]) => ({ reason, count: n }))
        .sort((a, b) => b.count - a.count);
    } catch {
      reasons = [];
    }
    return {
      id: row.run_id,
      command: row.command,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      itemsSeen: row.items_seen,
      produced: row.produced,
      skipped: row.skipped,
      reasons,
      error: row.error,
    };
  });

  const tests = query<{
    run_id: string; suite: string; passed: number; failed: number;
    duration: number | null; detail: string | null; created_at: string;
  }>("SELECT * FROM test_runs ORDER BY created_at DESC LIMIT 10").map<ShortsTestRun>(
    (row) => ({
      id: row.run_id,
      suite: row.suite,
      passed: row.passed,
      failed: row.failed,
      duration: row.duration,
      detail: row.detail,
      createdAt: row.created_at,
    }),
  );

  const estMinutes =
    queryOne<{ total: number | null }>(
      "SELECT SUM(est_minutes) AS total FROM subtitle_audit WHERE needs_whisper = 1",
    )?.total ?? 0;

  return {
    totals: {
      clips: count("SELECT COUNT(*) AS n FROM shorts WHERE deleted_at IS NULL"),
      series: count(
        "SELECT COUNT(DISTINCT series_id) AS n FROM shorts WHERE series_id IS NOT NULL AND deleted_at IS NULL",
      ),
      mediaItems: count("SELECT COUNT(*) AS n FROM media_items"),
      audited: count("SELECT COUNT(*) AS n FROM subtitle_audit"),
      usable: count("SELECT COUNT(*) AS n FROM subtitle_audit WHERE usable = 1"),
      needsWhisper: count(
        "SELECT COUNT(*) AS n FROM subtitle_audit WHERE needs_whisper = 1",
      ),
    },
    byReason,
    byProvenance,
    recentClips,
    jobs,
    runs,
    tests,
    worker: workerStatus(),
    estWhisperHours: (estMinutes ?? 0) / 60,
  };
}
