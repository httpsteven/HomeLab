/**
 * The Bazarr tasks this dashboard is willing to trigger.
 *
 * Bazarr exposes twelve; these are the ones worth a button and safe to press
 * repeatedly. The browser sends an id from this list and nothing else, so the
 * action endpoint can never be talked into running an arbitrary job.
 *
 * Left off on purpose:
 *   update_bazarr        — updates Bazarr itself. Privileged, and belongs in
 *                          the package manager where it can be reviewed.
 *   cache_cleanup        — housekeeping nobody needs to watch.
 *   update_announcements — fetches Bazarr's notice banner.
 */
export interface BazarrTaskOption {
  id: string;
  label: string;
  /** Why you would press it, in the UI's own voice. */
  hint: string;
}

export const BAZARR_TASKS: BazarrTaskOption[] = [
  {
    id: "update_series",
    label: "Sync with Sonarr",
    hint: "Pull the current series list from Sonarr.",
  },
  {
    id: "update_movies",
    label: "Sync with Radarr",
    hint: "Pull the current movie list from Radarr.",
  },
  {
    id: "wanted_search_missing_subtitles_series",
    label: "Find missing TV subtitles",
    hint: "Unscheduled by default — this is the only thing that runs it.",
  },
  {
    id: "wanted_search_missing_subtitles_movies",
    label: "Find missing film subtitles",
    hint: "Otherwise every 6 hours.",
  },
  {
    id: "series_full_scan_subtitles",
    label: "Reindex TV subtitles",
    hint: "Re-reads what is on disk. Slow; run it after moving files.",
  },
  {
    id: "movies_full_scan_subtitles",
    label: "Reindex film subtitles",
    hint: "Re-reads what is on disk. Slow; run it after moving files.",
  },
  {
    id: "upgrade_subtitles",
    label: "Upgrade existing subtitles",
    hint: "Looks for better versions of subtitles already downloaded.",
  },
];
