/**
 * Scored substring matching for the command palette.
 *
 * A dependency-free ranker rather than a fuzzy-search library: the corpus is
 * ~1,000 titles, which plain JS handles in well under a frame, and a fuzzy
 * matcher on this data actively hurts — "the" would surface half the library.
 * What people actually type is a prefix of the title or of a word in it, and
 * ranking those above mid-word hits is the whole requirement.
 */

export const SCORE = {
  /** Query matches the start of the whole title: "sever" → Severance. */
  prefix: 100,
  /** Query matches the start of a word: "bear" → The Bear. */
  wordStart: 60,
  /** Query appears somewhere inside: "everan" → Severance. */
  contains: 20,
} as const;

/** Returns 0 when there's no match, so callers can filter on truthiness. */
export function scoreMatch(haystack: string, needle: string): number {
  if (!needle) return 0;

  const text = haystack.toLowerCase();
  const query = needle.toLowerCase();
  const index = text.indexOf(query);
  if (index === -1) return 0;

  let score: number = SCORE.contains;
  if (index === 0) {
    score = SCORE.prefix;
  } else if (text[index - 1] === " " || text[index - 1] === ":" || text[index - 1] === "-") {
    score = SCORE.wordStart;
  }

  // Shorter titles rank higher for the same match quality: typing "dune"
  // should surface "Dune" before "Dune: Part Two Behind the Scenes".
  return score + Math.max(0, 20 - haystack.length / 4);
}

export interface Scored<T> {
  item: T;
  score: number;
}

export function rank<T>(items: T[], query: string, key: (item: T) => string, limit: number): T[] {
  if (!query.trim()) return items.slice(0, limit);

  const scored: Scored<T>[] = [];
  for (const item of items) {
    const score = scoreMatch(key(item), query);
    if (score > 0) scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score || key(a.item).localeCompare(key(b.item)));
  return scored.slice(0, limit).map((entry) => entry.item);
}
