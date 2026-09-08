"use client";

import { AlertTriangle, Download } from "lucide-react";
import { useSlot } from "@/components/DashboardProvider";
import { Freshness } from "@/components/shell/ConnectionIndicator";
import { NotConfigured, Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { formatBytes } from "@/lib/format";
import { ActionButton } from "@/components/ui/ActionButton";

/**
 * Download queue.
 *
 * Failed items sort first and the tile grows when anything is wrong — a stuck
 * import is the only reason you'd look at this panel, so it shouldn't be
 * buried under six healthy downloads.
 */
export function QueuePanel({ limit = 5 }: { limit?: number }) {
  const slot = useSlot("queue");
  const queue = slot.data;
  const items = queue?.items.slice(0, limit) ?? [];
  const failed = queue?.counts.failed ?? 0;

  // Nothing queued is the common case and needs almost no room; failures need
  // the most, because that is the only reason anyone opens this panel.
  const span = failed > 0 ? "xl" : items.length === 0 ? "md" : "lg";

  return (
    <Panel span={span}>
      <PanelHeader
        title="Download queue"
        meta={queue ? `${queue.counts.total}` : undefined}
        icon={<Download size={13} />}
        action={<Freshness fetchedAt={slot.fetchedAt} mode={slot.mode} />}
      />
      <PanelBody>
        {slot.status === "not-configured" ? (
          <NotConfigured service="Sonarr / Radarr" hint="Connect either to see the queue." />
        ) : items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 py-6 text-center">
            <p className="text-sm text-ink-muted">Queue is empty</p>
            <p className="text-xs text-ink-faint">Nothing downloading or waiting.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={`${item.source}-${item.id}`} className="rounded-lg bg-surface-2 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-ink">{item.title}</p>
                    <p className="metric mt-0.5 text-[10px] text-ink-faint">
                      {item.source} · {formatBytes(item.size - item.sizeLeft)} of{" "}
                      {formatBytes(item.size)}
                      {item.timeLeft ? ` · ${item.timeLeft}` : ""}
                    </p>
                  </div>
                  {item.hasError ? (
                    <span
                      className="flex shrink-0 items-center gap-1 text-[10px] font-medium"
                      style={{ color: "var(--status-serious)" }}
                    >
                      <AlertTriangle size={11} aria-hidden />
                      Stalled
                    </span>
                  ) : (
                    <span className="metric shrink-0 text-[10px] text-ink-muted">
                      {Math.round(item.progress * 100)}%
                    </span>
                  )}
                </div>

                <div
                  className="relative mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3"
                  role="progressbar"
                  aria-valuenow={Math.round(item.progress * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${item.title} download progress`}
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700"
                    style={{
                      width: `${Math.max(item.progress * 100, 1)}%`,
                      // Graphite, not the brand red. This list mixes healthy
                      // rows with failed ones, so a red bar sitting beside a
                      // "Stalled" row would read as an error state itself.
                      // Brand red is only used for progress where no status
                      // encoding shares the component.
                      background: item.hasError
                        ? "var(--status-serious)"
                        : "var(--meter-fill)",
                    }}
                  />
                </div>

                {item.hasError ? (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-[10px] text-ink-muted">
                      {item.errorMessage ?? "Import failed"}
                    </p>
                    <ActionButton
                      action="queue.retry"
                      params={{ service: item.source, id: item.id }}
                      label="Retry"
                      size="xs"
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}
