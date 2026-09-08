import { cn } from "@/lib/cn";
import { formatBytes, formatPercent } from "@/lib/format";
import { capacityLevel, StatusBadge } from "./Status";

/**
 * A mount's capacity.
 *
 * Mark spec: 4px rounded data-end anchored to the baseline, thin track, a
 * 2px surface gap where segments meet. The threshold tick is a real reference
 * line, not decoration — it shows *where* the warning level sits so a bar at
 * 78% visibly reads as "close" rather than just "a number".
 */

interface CapacityBarProps {
  used: number;
  total: number;
  label: string;
  sublabel?: string;
  className?: string;
  /** Hides the numeric row for compact contexts (e.g. the overview strip). */
  compact?: boolean;
}

export function CapacityBar({
  used,
  total,
  label,
  sublabel,
  className,
  compact = false,
}: CapacityBarProps) {
  const fraction = total > 0 ? Math.min(used / total, 1) : 0;
  const level = capacityLevel(fraction);
  const free = Math.max(total - used, 0);

  const fillColor =
    level === "critical"
      ? "var(--status-critical)"
      : level === "warning"
        ? "var(--status-warning)"
        : "var(--seq-400)";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{label}</p>
          {sublabel ? (
            <p className="metric truncate text-[11px] text-ink-faint">{sublabel}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="metric text-sm font-semibold text-ink">{formatPercent(fraction, 1)}</span>
          {level !== "good" ? <StatusBadge level={level} compact /> : null}
        </div>
      </div>

      <div
        className="relative h-2 w-full overflow-hidden rounded-full bg-surface-3"
        role="meter"
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} capacity used`}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${Math.max(fraction * 100, 1.5)}%`, background: fillColor }}
        />
        {/* Warning threshold reference line — 2px surface gap keeps it legible
            against the fill rather than blending into it. */}
        <div
          className="absolute inset-y-0 w-px"
          style={{ left: "80%", background: "rgba(255,255,255,0.28)" }}
          aria-hidden
        />
      </div>

      {!compact ? (
        <div className="metric flex items-baseline justify-between text-[11px] text-ink-muted">
          <span>
            {formatBytes(used)} <span className="text-ink-faint">used</span>
          </span>
          <span>
            {formatBytes(free)} <span className="text-ink-faint">free of {formatBytes(total)}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Horizontal stacked composition bar — how a total splits across categories.
 * Segments carry a 2px surface gap so adjacent fills never merge into one
 * shape, which is the standard failure of stacked bars.
 */
export function StackedBar({
  segments,
  className,
  height = 10,
}: {
  segments: { label: string; value: number; color: string }[];
  className?: string;
  height?: number;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) return null;

  return (
    <div className={cn("flex w-full overflow-hidden rounded-full", className)} style={{ height }}>
      {segments.map((segment, index) => {
        const pct = (segment.value / total) * 100;
        if (pct <= 0) return null;
        return (
          <div
            key={segment.label}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${pct}%`,
              background: segment.color,
              marginLeft: index === 0 ? 0 : 2,
            }}
            title={`${segment.label}: ${formatBytes(segment.value)}`}
          />
        );
      })}
    </div>
  );
}
