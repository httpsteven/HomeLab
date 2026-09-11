import "server-only";
import { getState } from "@/lib/collect/store";
import { deriveConditions } from "./conditions";
import {
  alertsConfig,
  meetsMinLevel,
  notify,
  notifyDetailed,
  type AlertsConfig,
} from "./notifier";
import {
  activeAlerts,
  commitDiff,
  diffConditions,
  isActive,
  loadAlertStore,
  recentAlerts,
  withinStartupGrace,
} from "./state";

/**
 * Evaluate current state and send whatever is genuinely new.
 *
 * Called after slot updates rather than on a timer of its own, so an alert
 * fires as soon as the data that triggers it lands.
 */

let evaluating = false;

export async function evaluateAlerts(): Promise<void> {
  const config = alertsConfig();
  if (!config.enabled) return;

  // Slot updates can arrive in bursts; one evaluation at a time is plenty and
  // stops a burst from racing the store into an inconsistent state.
  if (evaluating) return;
  evaluating = true;

  try {
    await loadAlertStore();

    const conditions = deriveConditions(getState(), isActive);

    // Still booting: do nothing at all, and in particular do NOT record these
    // conditions as known.
    //
    // Committing them here was a bug worth naming: a condition already true at
    // boot — a disk that's ALREADY full — would be marked as seen without ever
    // being notified, and then never announced because it was no longer new.
    // The grace exists only to avoid alerting on half-loaded state, where an
    // empty services slot looks identical to a total outage. Not re-announcing
    // across restarts is the persisted store's job, not this one's.
    if (withinStartupGrace()) return;

    const { toNotify, resolved } = diffConditions(conditions, config.repeatHours);

    const sendable = toNotify.filter((condition) =>
      meetsMinLevel(condition.level, config.minLevel),
    );

    const sent = [];
    for (const condition of sendable) {
      const ok = await notify(config, {
        level: condition.level,
        title: condition.title,
        body: condition.body,
      });
      // Only record it as notified if delivery actually worked, so a transient
      // outage at the notification endpoint doesn't silently swallow an alert.
      if (ok) sent.push(condition);
    }

    for (const alert of resolved) {
      await notify(config, {
        level: "resolved",
        title: `Resolved: ${alert.title}`,
        body: "This condition has cleared.",
      });
    }

    await commitDiff(conditions, sent, resolved);
  } catch {
    // Alerting must never take the collector down with it.
  } finally {
    evaluating = false;
  }
}

export interface AlertsStatus {
  enabled: boolean;
  transports: string[];
  minLevel: string;
  repeatHours: number;
  startingUp: boolean;
  active: ReturnType<typeof activeAlerts>;
  recent: ReturnType<typeof recentAlerts>;
}

export async function alertsStatus(): Promise<AlertsStatus> {
  await loadAlertStore();
  const config: AlertsConfig = alertsConfig();

  return {
    enabled: config.enabled,
    transports: [config.ntfyUrl ? "ntfy" : null, config.webhookUrl ? "webhook" : null].filter(
      (value): value is string => value !== null,
    ),
    minLevel: config.minLevel,
    repeatHours: config.repeatHours,
    startingUp: withinStartupGrace(),
    active: activeAlerts(),
    recent: recentAlerts(),
  };
}

/** Delivery test — the gate before any of the rest is trustworthy. */
export async function sendTestAlert(): Promise<{ ok: boolean; message: string }> {
  const config = alertsConfig();
  if (!config.enabled) {
    return {
      ok: false,
      message: "No alert transport configured. Set ALERT_NTFY_URL or ALERT_WEBHOOK_URL.",
    };
  }

  const results = await notifyDetailed(config, {
    level: "warning",
    title: "Home Lab test alert",
    body: "If you're reading this on your phone, alerting works.",
  });

  const delivered = results.filter((result) => result.ok);
  if (delivered.length > 0) {
    return { ok: true, message: `Test delivered via ${delivered.map((r) => r.transport).join(" and ")}.` };
  }

  // Pass the receiver's own explanation through. "Rejected" on its own tells
  // you nothing; Discord and ntfy both say precisely what was wrong, and
  // inventing a vaguer message on top of that helps no one.
  const reasons = results
    .map((result) => `${result.transport}: ${result.detail ?? "rejected"}`)
    .join(" · ");

  return { ok: false, message: reasons || "No transport configured." };
}
