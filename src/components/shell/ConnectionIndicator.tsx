"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { useDashboard } from "@/components/DashboardProvider";

/**
 * Live-connection state for the whole dashboard.
 *
 * Deliberately always visible: if the stream drops, every number on screen
 * silently stops being true, and that has to be legible at a glance. Carries
 * an icon shape + text, never color alone.
 */

const LABELS = {
  connecting: { text: "Connecting", tone: "var(--text-muted)", pulse: true },
  live: { text: "Live", tone: "var(--status-good)", pulse: true },
  reconnecting: { text: "Reconnecting", tone: "var(--status-warning)", pulse: true },
  paused: { text: "Paused", tone: "var(--text-muted)", pulse: false },
} as const;

export function ConnectionIndicator() {
  const { status, lastEventAt } = useDashboard();
  const meta = LABELS[status];

  // Clock held in state and advanced on a timer, so the "3s ago" label keeps
  // counting between events without reading Date.now() during render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5"
      role="status"
      aria-live="polite"
      title={
        lastEventAt
          ? `Last update ${formatRelativeTime(lastEventAt, now)}`
          : "Waiting for the first update"
      }
    >
      <span
        className={cn("size-1.5 shrink-0 rounded-full", meta.pulse && "live-dot")}
        style={{ background: meta.tone }}
        aria-hidden
      />
      <span className="text-xs font-medium" style={{ color: meta.tone }}>
        {meta.text}
      </span>
      {status === "live" && lastEventAt ? (
        <span className="metric hidden text-[10px] text-ink-faint sm:inline">
          {formatRelativeTime(lastEventAt, now)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Per-tile freshness. A quietly stale number is worse than an obviously
 * stale one, so any tile whose data has gone cold says so.
 */
export function Freshness({
  fetchedAt,
  mode,
  className,
}: {
  fetchedAt: number | null;
  mode?: string;
  className?: string;
}) {
  // `now` is state advanced by the interval rather than a Date.now() call in
  // render. Reading the clock during render is impure — the displayed age
  // would then only change when the component happened to re-render for some
  // other reason, so a frozen tile could quietly show a fresh timestamp.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  if (!fetchedAt) return null;

  const stale = now - fetchedAt > 120_000;

  return (
    <span
      className={cn("metric text-[10px]", className)}
      style={{ color: stale ? "var(--status-warning)" : "var(--text-faint)" }}
    >
      {mode === "push" ? "live · " : ""}
      {formatRelativeTime(fetchedAt, now)}
    </span>
  );
}
