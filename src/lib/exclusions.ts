/**
 * Titles this dashboard should behave as though it never saw.
 *
 * This exists because of Sonic X, which is on disk twice: the English version
 * Sonarr tracks at /srv/local_tvshows/Sonic X (2003), and a 99-episode
 * "Sonic X Japanese Sub (2003)" folder that Plex scanned, matched to nothing,
 * and now lists as a second show with no summary and no artwork.
 *
 * That second copy is not harmless. It inflates the episode count for a show
 * you own once, and because Plex never matched it, it sits permanently in
 * every "needs attention" list with nothing anyone can do about it. Sonarr
 * doesn't track it, so none of the usual tools apply.
 *
 * THE PATTERN IS NOT A BARE "sub". Globbing the library for that also matched
 * "The Substance (2024)" and "Batman and Mr Freeze SubZero (1998)" — two films
 * that would have silently vanished from the dashboard. The default matches
 * the full phrase, as a phrase, which is the difference between a filter and
 * a trap.
 */

const DEFAULT_PATTERNS = ["japanese sub", "japanese dub"];

/**
 * Comma-separated, from EXCLUDE_TITLES. Set it to an empty string to turn
 * exclusion off entirely; leave it unset to get the defaults above.
 */
export function excludedPatterns(): string[] {
  const raw = process.env.EXCLUDE_TITLES;
  if (raw === undefined) return DEFAULT_PATTERNS;

  return raw
    .split(",")
    .map((pattern) => pattern.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * True when any of the supplied strings matches an exclusion pattern.
 *
 * Takes several values because the same item is identified differently
 * depending on where it surfaces — a title in Plex, a path in the subtitle
 * audit — and a rule that only reads one of them is a rule with a hole in it.
 */
export function isExcluded(...values: (string | null | undefined)[]): boolean {
  const patterns = excludedPatterns();
  if (patterns.length === 0) return false;

  for (const value of values) {
    if (!value) continue;
    const haystack = value.toLowerCase();
    if (patterns.some((pattern) => haystack.includes(pattern))) return true;
  }

  return false;
}
