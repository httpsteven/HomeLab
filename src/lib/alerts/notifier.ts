import "server-only";
import type { AlertLevel } from "./conditions";

/**
 * Delivery. Two transports, both optional, both fire-and-forget.
 *
 * Nothing here is allowed to throw into the collector or hold it up: a dead
 * notification endpoint must not stop the dashboard from collecting data. A
 * monitoring tool that falls over when its own alerting breaks is worse than
 * one with no alerting at all.
 */

const SEND_TIMEOUT_MS = 5_000;

export interface AlertsConfig {
  ntfyUrl: string | null;
  ntfyToken: string | null;
  webhookUrl: string | null;
  repeatHours: number;
  /** Only send at or above this level. */
  minLevel: AlertLevel;
  enabled: boolean;
}

export function alertsConfig(): AlertsConfig {
  const ntfyUrl = process.env.ALERT_NTFY_URL?.trim() || null;
  const webhookUrl = process.env.ALERT_WEBHOOK_URL?.trim() || null;
  const rawRepeat = Number(process.env.ALERT_REPEAT_HOURS);

  return {
    ntfyUrl,
    ntfyToken: process.env.ALERT_NTFY_TOKEN?.trim() || null,
    webhookUrl,
    repeatHours: Number.isFinite(rawRepeat) && rawRepeat >= 0 ? rawRepeat : 12,
    minLevel: process.env.ALERT_MIN_LEVEL?.trim() === "critical" ? "critical" : "warning",
    enabled: Boolean(ntfyUrl || webhookUrl),
  };
}

export interface Notification {
  level: AlertLevel | "resolved";
  title: string;
  body: string;
}

/** ntfy maps priority to how intrusive the phone notification is. */
const NTFY_PRIORITY: Record<Notification["level"], string> = {
  critical: "urgent",
  warning: "high",
  resolved: "low",
};

const NTFY_TAGS: Record<Notification["level"], string> = {
  critical: "rotating_light",
  warning: "warning",
  resolved: "white_check_mark",
};

async function sendNtfy(config: AlertsConfig, notification: Notification): Promise<boolean> {
  if (!config.ntfyUrl) return false;

  try {
    const response = await fetch(config.ntfyUrl, {
      method: "POST",
      headers: {
        // Header values must be latin-1; titles can contain anything, so
        // non-ASCII is stripped rather than allowed to throw.
        Title: notification.title.replace(/[^\x20-\x7E]/g, ""),
        Priority: NTFY_PRIORITY[notification.level],
        Tags: NTFY_TAGS[notification.level],
        ...(config.ntfyToken ? { Authorization: `Bearer ${config.ntfyToken}` } : {}),
      },
      body: notification.body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function sendWebhook(config: AlertsConfig, notification: Notification): Promise<boolean> {
  if (!config.webhookUrl) return false;

  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `content` is what Discord and most webhook receivers read; the extra
      // fields are ignored by those and useful to anything else.
      body: JSON.stringify({
        content: `**${notification.title}**\n${notification.body}`,
        level: notification.level,
        title: notification.title,
        body: notification.body,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** True if at least one transport accepted it. */
export async function notify(
  config: AlertsConfig,
  notification: Notification,
): Promise<boolean> {
  const results = await Promise.all([
    sendNtfy(config, notification),
    sendWebhook(config, notification),
  ]);
  return results.some(Boolean);
}

export function meetsMinLevel(level: AlertLevel, minLevel: AlertLevel): boolean {
  if (minLevel === "warning") return true;
  return level === "critical";
}
