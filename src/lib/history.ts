import "server-only";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { historyFileName } from "./config";
import { getSlot } from "./collect/store";
import { demoHistory, isDemoMode } from "./demo";
import type { HistorySnapshot } from "./types";

/**
 * Library-size history, appended as JSON Lines.
 *
 * A file rather than a database on purpose: no native dependency, no daemon,
 * trivially backed up or deleted, and one snapshot every 6h is ~1,500 lines a
 * year. If this ever needs real querying, the shape maps straight onto a
 * table.
 */

const SNAPSHOT_INTERVAL_MS = 6 * 60 * 60 * 1000;

const DATA_DIR = "data";

function filePath(): string {
  // Statically scoped to data/ so the bundler doesn't trace the whole project.
  return join(process.cwd(), DATA_DIR, historyFileName());
}

export async function readHistory(): Promise<HistorySnapshot[]> {
  if (isDemoMode()) return demoHistory();

  try {
    const contents = await readFile(filePath(), "utf8");
    return contents
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line) as HistorySnapshot;
        } catch {
          return null; // Skip a torn line rather than losing the whole file.
        }
      })
      .filter((entry): entry is HistorySnapshot => entry !== null)
      .sort((a, b) => a.t - b.t);
  } catch {
    // No file yet — an empty history is the correct answer on day one.
    return [];
  }
}

async function appendSnapshot(snapshot: HistorySnapshot): Promise<void> {
  await mkdir(join(process.cwd(), DATA_DIR), { recursive: true });
  await appendFile(filePath(), `${JSON.stringify(snapshot)}\n`, "utf8");
}

/**
 * Writes a snapshot if enough time has passed since the last one.
 *
 * Called on every storage refresh, so restarts don't skip a window and a
 * long-running process doesn't need its own timer.
 */
export async function recordSnapshotIfDue(force = false): Promise<boolean> {
  // Demo history is generated, never written to disk.
  if (isDemoMode()) return false;

  const storage = getSlot("storage").data;
  const library = getSlot("library").data;
  if (!storage) return false;

  const history = await readHistory();
  const last = history[history.length - 1];
  if (!force && last && Date.now() - last.t < SNAPSHOT_INTERVAL_MS) {
    return false;
  }

  await appendSnapshot({
    t: Date.now(),
    libraryBytes: storage.libraryBytes,
    counts: {
      movies: library?.movies.total ?? 0,
      series: library?.series.total ?? 0,
      episodes: library?.series.episodeFileCount ?? 0,
    },
    mounts: storage.mounts.map((mount) => ({
      path: mount.path,
      total: mount.total,
      used: mount.used,
    })),
  });

  return true;
}

export { projectRunway, type RunwayProjection } from "./runway";
