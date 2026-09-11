import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AlertLevel, Condition } from "./conditions";

/**
 * Which conditions are already known, so a notification fires on the EDGE
 * rather than on every evaluation.
 *
 * This is the whole difference between an alerting system and a nuisance. The
 * collector evaluates every couple of seconds; without edge detection a full
 * disk would notify ~30,000 times a day.
 */

const DATA_DIR = "data";
const FILE = "alerts.json";

/** How long a still-true condition waits before reminding you. */
const DEFAULT_REPEAT_HOURS = 12;

/**
 * Nothing fires in the first stretch after boot.
 *
 * Slots fill in over several seconds, and an unpopulated `services` slot looks
 * exactly like every service being down. Without this, every restart would
 * announce a full outage and then immediately resolve it.
 */
function startupGraceMs(): number {
  const raw = Number(process.env.ALERT_STARTUP_GRACE_SECONDS);
  return Number.isFinite(raw) && raw >= 0 ? raw * 1000 : 90_000;
}

export interface ActiveAlert {
  key: string;
  level: AlertLevel;
  title: string;
  firstSeen: number;
  lastNotified: number;
}

export interface SentAlert {
  at: number;
  key: string;
  level: AlertLevel | "resolved";
  title: string;
}

interface AlertStore {
  active: Record<string, ActiveAlert>;
  /** Trimmed ring of what was sent, for the UI. */
  recent: SentAlert[];
}

const RECENT_LIMIT = 25;

const globalForAlerts = globalThis as unknown as {
  __alertStore?: AlertStore;
  __alertStoreLoaded?: boolean;
  __collectorStartedAt?: number;
};

const store: AlertStore = (globalForAlerts.__alertStore ??= { active: {}, recent: [] });

export function markCollectorStart(): void {
  globalForAlerts.__collectorStartedAt ??= Date.now();
}

export function withinStartupGrace(): boolean {
  const startedAt = globalForAlerts.__collectorStartedAt;
  if (!startedAt) return true;
  return Date.now() - startedAt < startupGraceMs();
}

function filePath(): string {
  return join(process.cwd(), DATA_DIR, FILE);
}

/**
 * Restores known-active conditions from disk.
 *
 * Without this a container restart re-announces everything already active —
 * the "my disk is full" notification you already acknowledged arrives again on
 * every deploy.
 */
export async function loadAlertStore(): Promise<void> {
  if (globalForAlerts.__alertStoreLoaded) return;
  globalForAlerts.__alertStoreLoaded = true;

  try {
    const parsed = JSON.parse(await readFile(filePath(), "utf8")) as Partial<AlertStore>;
    store.active = parsed.active ?? {};
    store.recent = parsed.recent ?? [];
  } catch {
    // No file yet, or it's unreadable. Starting empty is correct and safe —
    // the worst case is one duplicate notification, never a missed one.
  }
}

async function persist(): Promise<void> {
  try {
    await mkdir(join(process.cwd(), DATA_DIR), { recursive: true });
    await writeFile(filePath(), JSON.stringify(store), "utf8");
  } catch {
    // Alerting must not fail because the disk is full — which is, after all,
    // one of the things it exists to warn about.
  }
}

export function isActive(key: string): boolean {
  return key in store.active;
}

export function activeAlerts(): ActiveAlert[] {
  return Object.values(store.active);
}

export function recentAlerts(): SentAlert[] {
  return store.recent;
}

export interface AlertDiff {
  /** Newly true, or due a reminder. */
  toNotify: Condition[];
  /** No longer true. */
  resolved: ActiveAlert[];
}

/**
 * Compares current conditions against what's known and returns only what
 * should actually be sent.
 */
export function diffConditions(conditions: Condition[], repeatHours: number): AlertDiff {
  const now = Date.now();
  const repeatMs = Math.max(repeatHours, 0) * 3_600_000;
  const seen = new Set(conditions.map((condition) => condition.key));

  const toNotify: Condition[] = [];
  for (const condition of conditions) {
    const existing = store.active[condition.key];

    if (!existing) {
      toNotify.push(condition);
      continue;
    }

    // A condition that worsened (warning → critical) is worth saying again
    // even inside the repeat window.
    const escalated = existing.level !== "critical" && condition.level === "critical";
    const due = repeatMs > 0 && now - existing.lastNotified >= repeatMs;
    if (escalated || due) toNotify.push(condition);
  }

  const resolved = Object.values(store.active).filter((alert) => !seen.has(alert.key));

  return { toNotify, resolved };
}

/** Records what was actually sent. Call only after a successful send. */
export async function commitDiff(
  conditions: Condition[],
  notified: Condition[],
  resolved: ActiveAlert[],
): Promise<void> {
  const now = Date.now();
  const notifiedKeys = new Set(notified.map((condition) => condition.key));

  for (const condition of conditions) {
    const existing = store.active[condition.key];
    store.active[condition.key] = {
      key: condition.key,
      level: condition.level,
      title: condition.title,
      firstSeen: existing?.firstSeen ?? now,
      lastNotified: notifiedKeys.has(condition.key) ? now : (existing?.lastNotified ?? now),
    };
  }

  for (const alert of resolved) delete store.active[alert.key];

  const entries: SentAlert[] = [
    ...notified.map((condition) => ({
      at: now,
      key: condition.key,
      level: condition.level,
      title: condition.title,
    })),
    ...resolved.map((alert) => ({
      at: now,
      key: alert.key,
      level: "resolved" as const,
      title: alert.title,
    })),
  ];

  if (entries.length > 0) {
    store.recent = [...entries, ...store.recent].slice(0, RECENT_LIMIT);
  }

  await persist();
}

export { DEFAULT_REPEAT_HOURS };
