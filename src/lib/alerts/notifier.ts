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

/** Why a send failed, so the UI can say something more useful than "rejected". */
export interface SendResult {
  ok: boolean;
  transport: string;
  detail?: string;
}

async function sendNtfy(config: AlertsConfig, notification: Notification): Promise<SendResult | null> {
  if (!config.ntfyUrl) return null;

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

    if (response.ok) return { ok: true, transport: "ntfy" };
    return {
      ok: false,
      transport: "ntfy",
      detail: `HTTP ${response.status} — ${(await response.text()).slice(0, 200)}`,
    };
  } catch (error) {
    return {
      ok: false,
      transport: "ntfy",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Discord validates its webhook body; other receivers generally don't. */
function isDiscord(url: string): boolean {
  return /discord(app)?\.com\/api\/webhooks\//i.test(url);
}

async function sendWebhook(
  config: AlertsConfig,
  notification: Notification,
): Promise<SendResult | null> {
  if (!config.webhookUrl) return null;

  // Discord's webhook body is validated, so it gets ONLY the fields it
  // documents. Anything else receives the richer payload, which is more
  // useful to a receiver that can read it.
  const payload = isDiscord(config.webhookUrl)
    ? {
        // Discord caps content at 2000 characters and rejects an empty one.
        content: `**${notification.title}**\n${notification.body}`.slice(0, 1900),
        username: "Home Lab",
      }
    : {
        content: `**${notification.title}**\n${notification.body}`,
        level: notification.level,
        title: notification.title,
        body: notification.body,
      };

  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (response.ok) return { ok: true, transport: "webhook" };
    return {
      ok: false,
      transport: "webhook",
      // Discord explains the rejection precisely; passing it through beats
      // any message this code could invent.
      detail: `HTTP ${response.status} — ${(await response.text()).slice(0, 200)}`,
    };
  } catch (error) {
    return {
      ok: false,
      transport: "webhook",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Results from every configured transport. */
export async function notifyDetailed(
  config: AlertsConfig,
  notification: Notification,
): Promise<SendResult[]> {
  const results = await Promise.all([
    sendNtfy(config, notification),
    sendWebhook(config, notification),
  ]);
  return results.filter((result): result is SendResult => result !== null);
}

/** True if at least one transport accepted it. */
export async function notify(
  config: AlertsConfig,
  notification: Notification,
): Promise<boolean> {
  const results = await notifyDetailed(config, notification);
  return results.some((result) => result.ok);
}

export function meetsMinLevel(level: AlertLevel, minLevel: AlertLevel): boolean {
  if (minLevel === "warning") return true;
  return level === "critical";
}
