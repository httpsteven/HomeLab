/**
 * Matching unmapped folders to the thing they actually are.
 *
 * Sonarr and Radarr both offer a "Library Import" screen that guesses, and
 * the guesses are not safe to accept unattended. On this library it proposed
 * Strawberry Shortcake for "Sonic X Japanese Sub", Pieces Of Her for
 * "Spider-Noir BW", and the 1980 Friday the 13th for the 2009 remake. Three
 * wrong files, filed confidently.
 *
 * So this is deliberately strict, and strictness here means FALSE NEGATIVES
 * ARE THE GOAL. A folder left alone costs one manual import. A folder matched
 * to the wrong title writes bad metadata into the library, and the person who
 * finds out is whoever sits down to watch it.
 *
 * Four rules, all of which must pass:
 *
 *   1. The folder states a year, and it matches the candidate's year exactly.
 *   2. The normalized titles are equal — not similar, equal.
 *   3. Exactly one candidate passes, so a tie is never broken by position.
 *   4. No other folder in the same run claims the same id, and the id isn't
 *      already in the library.
 *
 * Rule 4 exists because the data demanded it: "Spider-Man - Brand New Day"
 * and "Spider-Man Brand New Day" are two folders for one film, and importing
 * both would leave two entries fighting over one movie.
 */

export interface LookupCandidate {
  title: string;
  year?: number;
  tvdbId?: number;
  tmdbId?: number;
}

export interface ImportDecision {
  folder: string;
  /** Set only when every rule passed. */
  match: LookupCandidate | null;
  /** Always set — the reason it was taken or left, in plain words. */
  reason: string;
}

/**
 * Folder names and catalogue titles disagree in predictable ways.
 *
 * Rippers write " - " where the real title has ":", drop apostrophes and
 * full stops, and alternate between roman numerals and digits. None of that
 * is a different film, so none of it should block a match — while anything
 * this does NOT normalise still has to agree exactly.
 */
export function normalizeTitle(value: string): string {
  let text = (value ?? "").toLowerCase().replace(/&/g, "and");
  text = text.replace(/[:\-–—_]+/g, " ");
  text = text.replace(/[^a-z0-9 ]+/g, "");
  text = text.replace(/\s+/g, " ").trim();

  const ROMAN: Record<string, string> = {
    ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9",
  };
  // Only a trailing numeral — "Halloween II" is a sequel, but the "v" in
  // "Freddy vs Jason" is not a five.
  const parts = text.split(" ");
  const tail = parts[parts.length - 1];
  if (parts.length > 1 && ROMAN[tail]) parts[parts.length - 1] = ROMAN[tail];
  return parts.join(" ");
}

/** "Halloween H20 - 20 Years Later (1998)" -> title and year. */
export function parseFolder(name: string): { title: string; year: number | null } {
  const match = /^(.*?)\s*\((\d{4})\)\s*$/.exec(name);
  if (!match) return { title: name.trim(), year: null };
  return { title: match[1].trim(), year: Number(match[2]) };
}

function idOf(candidate: LookupCandidate): number | undefined {
  return candidate.tvdbId ?? candidate.tmdbId;
}

/**
 * Decides every folder in one pass.
 *
 * One pass rather than one call per folder, because rule 4 can only be
 * applied once every folder's candidate is known.
 */
export function decideImports(
  folders: { folder: string; candidates: LookupCandidate[] }[],
  existingIds: Set<number>,
): ImportDecision[] {
  const staged = new Map<number, { folder: string; match: LookupCandidate }[]>();
  const decisions: ImportDecision[] = [];

  for (const { folder, candidates } of folders) {
    const { title, year } = parseFolder(folder);

    if (year === null) {
      decisions.push({ folder, match: null, reason: "no year in the folder name" });
      continue;
    }

    const wanted = normalizeTitle(title);
    const exact = candidates.filter(
      (candidate) => normalizeTitle(candidate.title) === wanted && candidate.year === year,
    );

    if (exact.length === 0) {
      const best = candidates[0];
      decisions.push({
        folder,
        match: null,
        reason: best
          ? `closest was "${best.title}${best.year ? ` (${best.year})` : ""}"`
          : "nothing came back from the lookup",
      });
      continue;
    }

    if (exact.length > 1) {
      decisions.push({
        folder,
        match: null,
        reason: `${exact.length} candidates match equally well`,
      });
      continue;
    }

    const match = exact[0];
    const id = idOf(match);
    if (id === undefined) {
      decisions.push({ folder, match: null, reason: "candidate has no catalogue id" });
      continue;
    }

    if (existingIds.has(id)) {
      decisions.push({
        folder,
        match: null,
        reason: "already in the library under a different folder",
      });
      continue;
    }

    const bucket = staged.get(id) ?? [];
    bucket.push({ folder, match });
    staged.set(id, bucket);
  }

  for (const [, rows] of staged) {
    if (rows.length === 1) {
      decisions.push({
        folder: rows[0].folder,
        match: rows[0].match,
        reason: "exact title and year",
      });
      continue;
    }
    // Two folders, one film. Import neither: picking one would be a guess,
    // and importing both would leave them fighting over the same entry.
    for (const row of rows) {
      decisions.push({
        folder: row.folder,
        match: null,
        reason: `${rows.length} folders claim "${row.match.title}" — needs a human`,
      });
    }
  }

  return decisions.sort((a, b) => a.folder.localeCompare(b.folder));
}
