import "server-only";
import type { ServiceId } from "./config";

/**
 * Muting health checks that don't apply to your setup.
 *
 * A dashboard that permanently shows five warnings you've decided not to care
 * about is worse than one showing none: you stop reading the panel, and the
 * real warning hiding among them goes unnoticed. So irrelevant checks can be
 * muted — but they are COUNTED, never silently dropped, so a muted rule can't
 * quietly hide something later.
 *
 * Matching is on the check's `source` (Servarr's check-class name, e.g.
 * IndexerRssCheck) rather than its message. Messages carry version numbers and
 * get reworded between releases; the source identifier is stable.
 *
 * Configured with HEALTH_MUTE, comma-separated. Each entry is one of:
 *   download-automation     a named group (see below)
 *   IndexerRssCheck         a check source, muted on every service
 *   sonarr:UpdateCheck      a check source, muted on one service only
 */

/**
 * Checks that only matter if you acquire media through indexers and a download
 * client. On a library built by ripping discs, every one of these is
 * permanently true and permanently irrelevant.
 *
 * Deliberately excludes UpdateCheck (an available update is real information)
 * and anything about the library itself, such as RemovedMovieCheck.
 */
const GROUPS: Record<string, string[]> = {
  "download-automation": [
    "IndexerSearchCheck",
    "IndexerRssCheck",
    "IndexerStatusCheck",
    "IndexerJackettAllCheck",
    "DownloadClientCheck",
    "DownloadClientStatusCheck",
    "DownloadClientRootFolderCheck",
    "ImportMechanismCheck",
  ],
  updates: ["UpdateCheck"],
};

export interface MuteRule {
  /** Undefined means "any service". */
  service?: ServiceId;
  /** Lower-cased source or message fragment to match. */
  match: string;
}

export function healthMuteRules(): MuteRule[] {
  const raw = process.env.HEALTH_MUTE?.trim();
  if (!raw) return [];

  const rules: MuteRule[] = [];

  for (const entry of raw.split(",").map((part) => part.trim()).filter(Boolean)) {
    const [head, tail] = entry.includes(":") ? entry.split(":", 2) : [undefined, entry];
    const service = head?.trim().toLowerCase() as ServiceId | undefined;
    const token = (tail ?? "").trim();

    const group = GROUPS[token.toLowerCase()];
    if (group) {
      for (const source of group) rules.push({ service, match: source.toLowerCase() });
    } else if (token) {
      rules.push({ service, match: token.toLowerCase() });
    }
  }

  return rules;
}

export function isMuted(
  rules: MuteRule[],
  service: ServiceId,
  source: string,
  message: string,
): boolean {
  const haystackSource = source.toLowerCase();
  const haystackMessage = message.toLowerCase();

  return rules.some((rule) => {
    if (rule.service && rule.service !== service) return false;
    // Source is the precise match; message substring is a forgiving fallback
    // for services that don't publish a stable check identifier.
    return haystackSource === rule.match || haystackMessage.includes(rule.match);
  });
}
