import "server-only";
import type { ArrClient, ArrLookupResult } from "@/lib/clients/arr";
import { radarr } from "@/lib/clients/radarr";
import { sonarr } from "@/lib/clients/sonarr";
import { isExcluded } from "@/lib/exclusions";
import { decideImports, parseFolder, type ImportDecision } from "@/lib/library-import";

/**
 * Fills the gaps: folders on disk that Sonarr or Radarr isn't tracking.
 *
 * Runs daily, and only ever ADDS. Nothing here deletes, moves or renames —
 * the folder keeps its name and the files keep their inodes, because the
 * entry is created with `path` pointing at what is already there.
 *
 * The matching rules live in library-import.ts and are deliberately strict.
 * This module is the plumbing: fetch the gaps, ask the catalogue, apply the
 * decision, and keep a record of what it chose so the dashboard can show its
 * working rather than just a count.
 */

export interface GapRun {
  at: number;
  service: "sonarr" | "radarr";
  imported: { folder: string; title: string }[];
  skipped: { folder: string; reason: string }[];
  failed: { folder: string; reason: string }[];
  /** True when nothing was written — the daily preview, or a manual dry run. */
  dryRun: boolean;
}

/** Quality profile to file new entries under, when one isn't configured. */
const DEFAULT_PROFILE_ID = 1;

function profileId(): number {
  const raw = Number(process.env.IMPORT_QUALITY_PROFILE_ID);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_PROFILE_ID;
}

async function gatherDecisions(
  client: ArrClient,
): Promise<{ decisions: ImportDecision[]; rootPath: string | null }> {
  const roots = await client.unmappedFolders();
  if (!roots.ok || !roots.data) return { decisions: [], rootPath: null };

  const root = roots.data[0];
  const folders = (root?.unmappedFolders ?? [])
    .map((entry) => entry.name)
    // The same exclusion list the rest of the dashboard uses: a duplicate
    // copy of something you own shouldn't be imported OR reported as a gap.
    .filter((name) => !isExcluded(name));

  const library = await client.libraryIds();
  const existingIds = new Set<number>();
  for (const item of (library.ok ? (library.data ?? []) : [])) {
    const id = item.tvdbId ?? item.tmdbId;
    if (id !== undefined) existingIds.add(id);
  }

  const looked: { folder: string; candidates: ArrLookupResult[] }[] = [];
  for (const folder of folders) {
    const { title } = parseFolder(folder);
    const result = await client.lookup(title);
    looked.push({ folder, candidates: result.ok ? (result.data ?? []) : [] });
  }

  return {
    decisions: decideImports(looked, existingIds),
    rootPath: root?.path ?? null,
  };
}

export async function fillGaps(
  service: "sonarr" | "radarr",
  options: { dryRun: boolean },
): Promise<GapRun> {
  const client = service === "sonarr" ? sonarr : radarr;
  const run: GapRun = {
    at: Date.now(),
    service,
    imported: [],
    skipped: [],
    failed: [],
    dryRun: options.dryRun,
  };

  const { decisions, rootPath } = await gatherDecisions(client);
  if (!rootPath) return run;

  for (const decision of decisions) {
    if (!decision.match) {
      run.skipped.push({ folder: decision.folder, reason: decision.reason });
      continue;
    }

    if (options.dryRun) {
      run.imported.push({ folder: decision.folder, title: decision.match.title });
      continue;
    }

    const base = {
      title: decision.match.title,
      year: decision.match.year,
      qualityProfileId: profileId(),
      monitored: true,
      rootFolderPath: rootPath,
      // The existing folder, exactly as it is on disk. This is the line that
      // makes it an adoption rather than a move.
      path: `${rootPath}/${decision.folder}`,
    };

    const payload =
      service === "sonarr"
        ? { ...base, tvdbId: decision.match.tvdbId, seriesType: "standard", seasonFolder: true }
        : { ...base, tmdbId: decision.match.tmdbId, minimumAvailability: "released" };

    const result = await client.addExisting(payload);
    if (result.ok) {
      run.imported.push({ folder: decision.folder, title: decision.match.title });
    } else {
      // A failure is reported, never retried in a loop: whatever the service
      // objected to will still be true a second later.
      run.failed.push({ folder: decision.folder, reason: result.message });
    }
  }

  return run;
}

/** Both services, one call. */
export async function fillAllGaps(options: { dryRun: boolean }): Promise<GapRun[]> {
  return [await fillGaps("sonarr", options), await fillGaps("radarr", options)];
}
