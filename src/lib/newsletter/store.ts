import "server-only";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Issue, IssueSummary } from "./types";

/**
 * Issues on disk, one JSON file each.
 *
 * Same reasoning as the history file: no database to run, trivially backed up,
 * and an issue you want rid of is a file you delete. The filename is the
 * issue's date, which doubles as its route segment.
 *
 * Statically scoped under data/ rather than built from a configurable path —
 * a dynamic path from cwd makes the bundler trace the whole project into the
 * server output, which is a mistake this codebase already made once.
 */

const DATA_DIR = "data";
const ISSUES_DIR = "newsletters";

function dir(): string {
  return join(process.cwd(), DATA_DIR, ISSUES_DIR);
}

/** Dates only — nothing else is ever read from this directory. */
const ID_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function fileFor(id: string): string | null {
  if (!ID_PATTERN.test(id)) return null;
  return join(dir(), `${id}.json`);
}

export async function saveIssue(issue: Issue): Promise<void> {
  await mkdir(dir(), { recursive: true });
  const path = fileFor(issue.id);
  if (!path) return;
  await writeFile(path, JSON.stringify(issue), "utf8");
}

export async function loadIssue(id: string): Promise<Issue | null> {
  const path = fileFor(id);
  if (!path) return null;

  try {
    return JSON.parse(await readFile(path, "utf8")) as Issue;
  } catch {
    return null;
  }
}

/** Newest first. */
export async function listIssues(): Promise<IssueSummary[]> {
  let names: string[];
  try {
    names = await readdir(dir());
  } catch {
    // No issues generated yet — an empty archive is the correct answer.
    return [];
  }

  const ids = names
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -5))
    .filter((id) => ID_PATTERN.test(id))
    .sort()
    .reverse();

  const summaries: IssueSummary[] = [];
  for (const id of ids) {
    const issue = await loadIssue(id);
    if (!issue) continue;
    summaries.push({
      id: issue.id,
      generatedAt: issue.generatedAt,
      from: issue.from,
      to: issue.to,
      movies: issue.shared.counts.movies,
      episodes: issue.shared.counts.episodes,
    });
  }

  return summaries;
}

export async function latestIssue(): Promise<Issue | null> {
  const [newest] = await listIssues();
  return newest ? loadIssue(newest.id) : null;
}
