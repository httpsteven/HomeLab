import "server-only";
import type { AlertLevel, ConditionField } from "./conditions";

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
  fields?: ConditionField[];
  /** Dashboard route this concerns; becomes a tap target. */
  path?: string;
}

/**
 * Embed accent, matching the dashboard's reserved status palette so a red
 * notification means the same thing a red bar does.
 */
const EMBED_COLOR: Record<Notification["level"], number> = {
  critical: 0xd0_3b_3b,
  warning: 0xfa_b2_19,
  resolved: 0x0c_a3_0c,
};

const LEVEL_EMOJI: Record<Notification["level"], string> = {
  critical: "🔴",
  warning: "🟡",
  resolved: "🟢",
};

/** Where this dashboard is reachable, for links in notifications. */
function dashboardUrl(): string | null {
  const raw = process.env.DASHBOARD_URL?.trim();
  if (!raw) return null;

  // Validated, because Discord rejects an embed carrying a malformed `url` —
  // a typo here would otherwise break every notification rather than just the
  // link inside it.
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return raw.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function linkFor(notification: Notification): string | null {
  const base = dashboardUrl();
  if (!base) return null;
  return `${base}${notification.path ?? "/"}`;
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

/** Markdown body: the detail fields read better as a list than inline prose. */
function ntfyBody(notification: Notification): string {
  const lines = [notification.body];
  if (notification.fields?.length) {
    lines.push("");
    for (const field of notification.fields) lines.push(`**${field.name}:** ${field.value}`);
  }
  return lines.join("\n");
}

async function sendNtfy(config: AlertsConfig, notification: Notification): Promise<SendResult | null> {
  if (!config.ntfyUrl) return null;
  const link = linkFor(notification);

  try {
    const response = await fetch(config.ntfyUrl, {
      method: "POST",
      headers: {
        // Header values must be latin-1; titles can contain anything, so
        // non-ASCII is stripped rather than allowed to throw.
        Title: notification.title.replace(/[^\x20-\x7E]/g, ""),
        Priority: NTFY_PRIORITY[notification.level],
        Tags: NTFY_TAGS[notification.level],
        Markdown: "yes",
        // Tapping the notification opens the page it's about, rather than
        // leaving you to find it.
        ...(link ? { Click: link } : {}),
        ...(link ? { Actions: `view, Open dashboard, ${link}` } : {}),
        ...(config.ntfyToken ? { Authorization: `Bearer ${config.ntfyToken}` } : {}),
      },
      body: ntfyBody(notification),
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

/**
 * Discord validates its webhook body; other receivers generally don't.
 *
 * Auto-detected from the host, and overridable with ALERT_WEBHOOK_FORMAT for
 * anything speaking Discord's shape behind a different hostname — a proxy, a
 * self-hosted relay, or a compatible bot endpoint.
 */
function isDiscord(url: string): boolean {
  const override = process.env.ALERT_WEBHOOK_FORMAT?.trim().toLowerCase();
  if (override === "discord") return true;
  if (override === "generic") return false;
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
  const link = linkFor(notification);

  const payload = isDiscord(config.webhookUrl)
    ? {
        username: "Home Lab",
        // An embed rather than plain content: it carries a colour matching the
        // severity, structured fields, and a timestamp — all of which a wall of
        // bold text can't.
        embeds: [
          {
            title: `${LEVEL_EMOJI[notification.level]}  ${notification.title}`.slice(0, 250),
            description: notification.body.slice(0, 1900),
            color: EMBED_COLOR[notification.level],
            ...(link ? { url: link } : {}),
            ...(notification.fields?.length
              ? {
                  fields: notification.fields.slice(0, 25).map((field) => ({
                    name: field.name.slice(0, 250),
                    value: field.value.slice(0, 1000) || "—",
                    inline: field.inline ?? false,
                  })),
                }
              : {}),
            footer: { text: "Home Lab" },
            timestamp: new Date().toISOString(),
          },
        ],
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
