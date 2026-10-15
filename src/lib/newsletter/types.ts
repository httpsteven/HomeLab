/**
 * One newsletter issue.
 *
 * Built once, rendered twice — by the dashboard page with the normal
 * components, and by the email renderer into table HTML. Keeping a single data
 * model is what stops the page and the email drifting apart, which is the
 * usual fate of a feature like this.
 *
 * Deliberately split into `shared` and `admin`. The viewer edition renders
 * `shared` only, so there is no path by which a disk path, a free-space figure
 * or a service error can reach someone you share Plex with — it isn't a
 * filtering rule that someone has to remember, it's the shape of the object.
 */

export interface AddedItem {
  /** Stable id from Plex, used for poster lookup and React keys. */
  key: string;
  kind: "movie" | "show";
  title: string;
  /** "Season 2 · 6 episodes" for a show, the year for a film. */
  subtitle: string | null;
  year: number | null;
  summary: string | null;
  /** Plex thumb path — resolved to an image by the renderer, not stored. */
  thumb: string | null;
  addedAt: number;
  /** Episodes rolled into this entry, for shows. */
  episodeCount: number;
  /** Runtime in whole minutes, films only — a show's is per-episode noise. */
  runtimeMinutes: number | null;
  /** At most three; the fourth never earned its line. */
  genres: string[];
  /** "PG-13", "TV-MA". Null when Plex has none. */
  contentRating: string | null;
}

export interface WatchRow {
  label: string;
  plays: number;
}

/** Everything safe to show anyone. */
export interface IssueShared {
  added: AddedItem[];
  counts: {
    movies: number;
    episodes: number;
    /** Distinct shows that received episodes. */
    shows: number;
  };
  topTitles: WatchRow[];
  totalPlays: number;
}

/** Operational detail. Viewer edition never renders this. */
export interface IssueAdmin {
  /** Bytes the library grew over the window, from history snapshots. */
  bytesAdded: number | null;
  /** Null when there isn't a snapshot old enough to subtract from. */
  libraryBytesNow: number | null;
  topUsers: WatchRow[];
  playsByDay: { date: string; plays: number }[];
  storage: {
    label: string;
    path: string;
    usedFraction: number;
    free: number;
    total: number;
  }[];
  issues: { service: string; level: string; message: string }[];
  servicesDown: string[];
}

export interface Issue {
  /** ISO date of generation; also the archive filename and route segment. */
  id: string;
  generatedAt: number;
  /** Window covered, inclusive start, exclusive end. */
  from: number;
  to: number;
  shared: IssueShared;
  admin: IssueAdmin;
}

export type Edition = "viewer" | "admin";

/** Summary row for the archive list, so listing doesn't load every issue. */
export interface IssueSummary {
  id: string;
  generatedAt: number;
  from: number;
  to: number;
  movies: number;
  episodes: number;
}
