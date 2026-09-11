"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { InfoNote, StatusBadge } from "@/components/ui/Status";
import { formatRelativeTime } from "@/lib/format";
import type { AlertsStatus } from "@/lib/alerts";

/**
 * Makes alerting inspectable.
 *
 * Notifications you can't see the state of are worse than none: you can't tell
 * "nothing is wrong" from "it stopped working two weeks ago". This shows what
 * it would send, what it has sent, and offers a delivery test.
 */
export function AlertsPanel() {
  const [status, setStatus] = useState<AlertsStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    const load = () =>
      fetch("/api/alerts")
        .then((response) => response.json())
        .then((data: AlertsStatus) => {
          if (!cancelled) setStatus(data);
        })
        .catch(() => {});

    load();
    // Slow poll: alert config barely changes, and the active list only moves
    // when a condition does.
    const timer = setInterval(() => {
      setNow(Date.now());
      void load();
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <Panel span="md">
      <PanelHeader
        title="Alerts"
        icon={<BellRing size={13} />}
        meta={status?.enabled ? status.transports.join(" + ") : undefined}
        action={
          status?.enabled ? (
            <ActionButton action="alerts.test" label="Send test" size="xs" />
          ) : null
        }
      />
      <PanelBody className="flex flex-col gap-3">
        {!status ? (
          <div className="skeleton h-24 w-full" />
        ) : !status.enabled ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-muted">Not configured</p>
            <p className="text-xs leading-relaxed text-ink-faint">
              Set <code className="metric">ALERT_NTFY_URL</code> (e.g. an ntfy topic) or{" "}
              <code className="metric">ALERT_WEBHOOK_URL</code> to get a notification when a
              disk fills, a service goes down, or an import stalls.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                level={status.active.length > 0 ? "warning" : "good"}
                label={
                  status.active.length > 0
                    ? `${status.active.length} active`
                    : "Nothing firing"
                }
                compact
              />
              {status.startingUp ? (
                <StatusBadge level="unknown" label="Starting up" compact />
              ) : null}
            </div>

            {status.startingUp ? (
              <InfoNote>
                Holding notifications while the collector fills in — a half-loaded state
                looks exactly like everything being down.
              </InfoNote>
            ) : null}

            {status.active.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {status.active.map((alert) => (
                  <li
                    key={alert.key}
                    className="flex items-start gap-2 rounded-lg bg-surface-2 p-2.5"
                  >
                    <StatusBadge level={alert.level} compact />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-ink">{alert.title}</p>
                      <p className="metric text-[10px] text-ink-faint">
                        since {formatRelativeTime(alert.firstSeen, now)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {status.recent.length > 0 ? (
              <div className="border-t border-[var(--glass-border)] pt-2.5">
                <p className="label-muted mb-1.5">Recently sent</p>
                <ul className="flex flex-col gap-1">
                  {status.recent.slice(0, 5).map((entry, index) => (
                    <li
                      key={`${entry.key}-${entry.at}-${index}`}
                      className="flex items-baseline gap-2 text-[11px]"
                    >
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        style={{
                          background:
                            entry.level === "resolved"
                              ? "var(--status-good)"
                              : entry.level === "critical"
                                ? "var(--status-critical)"
                                : "var(--status-warning)",
                        }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate text-ink-secondary">
                        {entry.title}
                      </span>
                      <span className="metric shrink-0 text-[10px] text-ink-faint">
                        {formatRelativeTime(entry.at, now)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-[11px] text-ink-faint">
                Nothing sent yet. Use &ldquo;Send test&rdquo; to confirm delivery works before
                you need it to.
              </p>
            )}

            <p className="metric text-[10px] text-ink-faint">
              {status.minLevel === "critical" ? "critical only" : "warning and above"} · repeats
              every {status.repeatHours}h
            </p>
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
