import "server-only";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fillAllGaps, type GapRun } from "./gap-filler";

/**
 * The daily run.
 *
 * Due-ness comes off the record on disk, not an in-memory timer — same shape
 * as the history snapshot and the weekly newsletter, and for the same reason:
 * a restart shouldn't cause a second run, and a container that was off for
 * three days should catch up with exactly one.
 *
 * IMPORTING IS OFF BY DEFAULT. Without IMPORT_FILL_GAPS=1 this records what it
 * WOULD have imported and writes nothing to Sonarr or Radarr. That default is
 * deliberate: this is the one scheduled job in the project that modifies
 * another service's library, and the right way to earn that is to let someone
 * read a few days of its decisions first.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const FILE = "gap-runs.json";
/** Enough to see a pattern, few enough to stay a small file. */
const KEEP = 14;

function path(): string {
  return join(process.cwd(), "data", FILE);
}

export async function readGapRuns(): Promise<GapRun[]> {
  try {
    return JSON.parse(await readFile(path(), "utf8")) as GapRun[];
  } catch {
    return [];
  }
}

async function record(runs: GapRun[]): Promise<void> {
  const history = [...runs, ...(await readGapRuns())].slice(0, KEEP * 2);
  await mkdir(join(process.cwd(), "data"), { recursive: true });
  await writeFile(path(), JSON.stringify(history, null, 2), "utf8");
}

export function importingEnabled(): boolean {
  return process.env.IMPORT_FILL_GAPS?.trim() === "1";
}

/**
 * Runs if a day has passed since the last one.
 *
 * Returns rather than throws, and is safe to call on every storage tick — the
 * record on disk is the guard.
 */
export async function runGapFillIfDue(force = false): Promise<GapRun[] | null> {
  const previous = await readGapRuns();
  const last = previous[0];

  if (!force && last && Date.now() - last.at < DAY_MS) return null;

  const runs = await fillAllGaps({ dryRun: !importingEnabled() });
  await record(runs);

  for (const run of runs) {
    const verb = run.dryRun ? "would import" : "imported";
    console.log(
      `[gap-fill] ${run.service}: ${verb} ${run.imported.length}, ` +
        `skipped ${run.skipped.length}, failed ${run.failed.length}` +
        (run.dryRun ? " (dry run — set IMPORT_FILL_GAPS=1 to apply)" : ""),
    );
    for (const row of run.skipped) console.log(`[gap-fill]   skip ${row.folder} — ${row.reason}`);
    for (const row of run.failed) console.log(`[gap-fill]   FAIL ${row.folder} — ${row.reason}`);
  }

  return runs;
}
