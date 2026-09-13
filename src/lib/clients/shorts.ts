import "server-only";
import Database from "better-sqlite3";
import path from "node:path";

/**
 * Reader for the shorts pipeline's SQLite database.
 *
 * The pipeline (a separate Python process) owns the schema and does the
 * writing; this opens the same file. Two things make that safe:
 *
 *  - WAL, set by the writer, so readers never block the writer and vice versa.
 *  - busy_timeout, so a momentary lock waits instead of throwing SQLITE_BUSY.
 *
 * We open READ-ONLY for everything except the three tables the dashboard owns
 * (jobs, review, lab_state), which use a separate writable handle. Keeping the
 * default handle read-only means a bug here can't corrupt the pipeline's data.
 */

const DB_PATH = process.env.SHORTS_DB_PATH?.trim() || path.join(process.cwd(), "data", "shorts.db");

/** Where generated clips live, for the media route's path validation. */
export const SHORTS_OUTPUT_DIR =
  process.env.SHORTS_OUTPUT_DIR?.trim() || "";

let reader: Database.Database | null = null;
let writer: Database.Database | null = null;

export function shortsDbPath(): string {
  return DB_PATH;
}

/**
 * Configured = the database opens.
 *
 * Deliberately NOT an existsSync check. A dynamic path in a filesystem call
 * defeats Turbopack's static analysis, which then conservatively traces the
 * entire project into the standalone output — every source file and the whole
 * public folder shipped inside the server bundle.
 *
 * Trying to open it is also the better test: a file that exists but is
 * unreadable, or isn't a database, is not "available" either.
 */
export function shortsAvailable(): boolean {
  return openReader() !== null;
}

function openReader(): Database.Database | null {
  if (reader) return reader;

  try {
    reader = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    reader.pragma("busy_timeout = 5000");
    return reader;
  } catch {
    reader = null;
    return null;
  }
}

function openWriter(): Database.Database | null {
  if (writer) return writer;

  try {
    writer = new Database(DB_PATH, { fileMustExist: true });
    writer.pragma("busy_timeout = 5000");
    return writer;
  } catch {
    writer = null;
    return null;
  }
}

/**
 * Drop cached handles.
 *
 * A long-lived read-only handle can end up pinned to an old WAL snapshot if the
 * writer recreates the file (which happens if the pipeline's database is
 * deleted and rebuilt). Reconnecting on error is cheaper than detecting that.
 */
export function resetShortsDb(): void {
  try { reader?.close(); } catch { /* already gone */ }
  try { writer?.close(); } catch { /* already gone */ }
  reader = null;
  writer = null;
}

export function query<T = unknown>(sql: string, params: unknown[] = []): T[] {
  const db = openReader();
  if (!db) return [];
  try {
    return db.prepare(sql).all(...(params as never[])) as T[];
  } catch {
    resetShortsDb();
    return [];
  }
}

export function queryOne<T = unknown>(sql: string, params: unknown[] = []): T | null {
  return query<T>(sql, params)[0] ?? null;
}

export function execute(sql: string, params: unknown[] = []): boolean {
  const db = openWriter();
  if (!db) return false;
  try {
    db.prepare(sql).run(...(params as never[]));
    return true;
  } catch {
    resetShortsDb();
    return false;
  }
}

/**
 * Publish the viewer-activity heartbeat the pipeline's worker reads.
 *
 * This is the whole mechanism behind "don't render while someone is watching":
 * the dashboard already knows who's streaming, so it writes that here rather
 * than the pipeline opening its own connection to Plex.
 *
 * `lastActivityAt` only moves forward while someone is actually watching, which
 * is what gives the worker its cooldown — it measures quiet time from the last
 * stream, not from the last heartbeat.
 */
export function writeLabState(activeStreams: number, transcodes: number): void {
  const now = new Date().toISOString();
  const previous = queryOne<{ last_activity_at: string | null }>(
    "SELECT last_activity_at FROM lab_state WHERE id = 1",
  );
  const lastActivity = activeStreams > 0 ? now : previous?.last_activity_at ?? null;

  execute(
    `INSERT INTO lab_state (id, active_streams, transcodes, last_activity_at, updated_at)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       active_streams = excluded.active_streams,
       transcodes = excluded.transcodes,
       last_activity_at = excluded.last_activity_at,
       updated_at = excluded.updated_at`,
    [activeStreams, transcodes, lastActivity, now],
  );
}

export function enqueueJob(type: string, payload: Record<string, unknown>): number | null {
  const db = openWriter();
  if (!db) return null;
  try {
    const result = db
      .prepare("INSERT INTO jobs (type, payload, created_at) VALUES (?, ?, ?)")
      .run(type, JSON.stringify(payload), new Date().toISOString());
    return Number(result.lastInsertRowid);
  } catch {
    resetShortsDb();
    return null;
  }
}

export function setReview(clipId: string, status: string, note: string | null): boolean {
  return execute(
    `INSERT INTO review (clip_id, status, note, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(clip_id) DO UPDATE SET
       status = excluded.status, note = excluded.note, updated_at = excluded.updated_at`,
    [clipId, status, note, new Date().toISOString()],
  );
}

export function setSubtitleOverride(
  mediaPath: string,
  options: { srtPath?: string | null; streamIndex?: number | null; forceWhisper?: boolean; note?: string | null },
): boolean {
  return execute(
    `INSERT INTO subtitle_overrides (path, srt_path, stream_index, force_whisper, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       srt_path = excluded.srt_path, stream_index = excluded.stream_index,
       force_whisper = excluded.force_whisper, note = excluded.note,
       created_at = excluded.created_at`,
    [
      mediaPath,
      options.srtPath ?? null,
      options.streamIndex ?? null,
      options.forceWhisper ? 1 : 0,
      options.note ?? null,
      new Date().toISOString(),
    ],
  );
}

export interface ShortsHealth {
  ok: boolean;
  detail: string;
  schemaVersion: string | null;
}

/**
 * Is the pipeline's database usable?
 *
 * Checks the schema rather than just the file, because a database that exists
 * but has no tables means the pipeline has never run — a different problem from
 * a wrong path, and worth saying so on /setup.
 */
export function shortsHealth(): ShortsHealth {
  if (!shortsAvailable()) {
    return { ok: false, detail: `Could not open ${DB_PATH}`, schemaVersion: null };
  }

  const version = queryOne<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'schema_version'",
  );
  if (!version) {
    return {
      ok: false,
      detail: "Database exists but has no schema — has the pipeline run yet?",
      schemaVersion: null,
    };
  }

  const clips = queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM shorts WHERE deleted_at IS NULL",
  );
  const audited = queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM subtitle_audit");

  return {
    ok: true,
    detail: `${clips?.n ?? 0} clip(s), ${audited?.n ?? 0} item(s) audited`,
    schemaVersion: `schema v${version.value}`,
  };
}
