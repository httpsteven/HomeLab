import "server-only";
import { buildIssue } from "./build";
import { mailConfig, sendIssue } from "./send";
import { listIssues, saveIssue } from "./store";
import type { Issue } from "./types";

/**
 * The weekly run.
 *
 * Due-ness is derived from the archive on disk rather than an in-memory timer,
 * exactly as the history snapshot does it. That's what makes a restart
 * harmless: the question is "when was the last issue generated", and the
 * answer survives the process.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const DAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function configuredDay(): number | null {
  const raw = process.env.NEWSLETTER_DAY?.trim().toLowerCase();
  if (!raw) return 0;
  return raw in DAYS ? DAYS[raw] : null;
}

export interface RunOutcome {
  generated: boolean;
  issue?: Issue;
  delivery: string[];
}

/**
 * Generates and sends if an issue is due.
 *
 * Returns rather than throws, and is safe to call every couple of seconds —
 * the archive check is the guard.
 */
export async function runNewsletterIfDue(force = false): Promise<RunOutcome> {
  const [latest] = await listIssues();
  const now = Date.now();

  if (!force) {
    // At most one a week, regardless of anything else.
    if (latest && now - latest.generatedAt < WEEK_MS) {
      return { generated: false, delivery: [] };
    }

    // And only on the configured day, so issues don't drift across the week
    // every time the container restarts.
    const day = configuredDay();
    if (day !== null && new Date(now).getDay() !== day) {
      return { generated: false, delivery: [] };
    }
  }

  const issue = await buildIssue();
  await saveIssue(issue);

  const config = mailConfig();
  const delivery: string[] = [];

  // Generated issues are always archived and visible on the dashboard; only
  // sending is gated. That's what makes it safe to leave this running while
  // you decide whether the first few issues are any good.
  if (config.enabled) {
    for (const edition of ["viewer", "admin"] as const) {
      const audience =
        edition === "admin" ? config.adminRecipients : config.viewerRecipients;
      if (audience.length === 0) continue;

      const result = await sendIssue(issue, edition);
      delivery.push(`${edition}: ${result.message}`);
    }
  } else {
    delivery.push("Sending is off (NEWSLETTER_ENABLED is not set).");
  }

  return { generated: true, issue, delivery };
}
