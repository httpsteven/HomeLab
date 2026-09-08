import { AlertTriangle, CheckCircle2, CircleSlash, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Status is NEVER encoded in color alone.
 *
 * Every one of these renders an icon and a text label alongside the color.
 * That is the documented mitigation for the reserved status palette, which
 * deliberately doesn't clear the colorblind-separation gates that the
 * categorical series palette does — and it's also just better for anyone
 * glancing at a wall of tiles.
 */

export type StatusLevel = "good" | "warning" | "serious" | "critical" | "unknown";

const STATUS_META: Record<
  StatusLevel,
  { color: string; dim: string; Icon: typeof CheckCircle2; defaultLabel: string }
> = {
  good: {
    color: "var(--status-good)",
    dim: "var(--status-good-dim)",
    Icon: CheckCircle2,
    defaultLabel: "OK",
  },
  warning: {
    color: "var(--status-warning)",
    dim: "var(--status-warning-dim)",
    Icon: AlertTriangle,
    defaultLabel: "Warning",
  },
  serious: {
    color: "var(--status-serious)",
    dim: "var(--status-serious-dim)",
    Icon: AlertTriangle,
    defaultLabel: "Degraded",
  },
  critical: {
    color: "var(--status-critical)",
    dim: "var(--status-critical-dim)",
    Icon: XCircle,
    defaultLabel: "Critical",
  },
  unknown: {
    color: "var(--text-muted)",
    dim: "transparent",
    Icon: CircleSlash,
    defaultLabel: "Unknown",
  },
};

export function StatusBadge({
  level,
  label,
  className,
  compact = false,
}: {
  level: StatusLevel;
  label?: string;
  className?: string;
  compact?: boolean;
}) {
  const meta = STATUS_META[level];
  const { Icon } = meta;
  const text = label ?? meta.defaultLabel;

  return (
    <span
      className={cn(
        // w-fit + self-start: in a flex column the badge would otherwise
        // stretch to full width and read as a filled banner.
        "inline-flex w-fit items-center gap-1.5 self-start rounded-full font-medium",
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs",
        className,
      )}
      style={{ background: meta.dim, color: meta.color }}
    >
      <Icon size={compact ? 11 : 13} strokeWidth={2.5} aria-hidden />
      <span>{text}</span>
    </span>
  );
}

/** Dot + text, for tight rows. The text is what carries meaning. */
export function StatusDot({
  level,
  label,
  pulse = false,
}: {
  level: StatusLevel;
  label: string;
  pulse?: boolean;
}) {
  const meta = STATUS_META[level];
  return (
    <span className="inline-flex items-center gap-2 text-xs text-ink-secondary">
      <span
        className={cn("size-2 shrink-0 rounded-full", pulse && "live-dot")}
        style={{ background: meta.color }}
        aria-hidden
      />
      <span>{label}</span>
    </span>
  );
}

/** Maps a used-fraction to a capacity status level. */
export function capacityLevel(usedFraction: number): StatusLevel {
  if (!Number.isFinite(usedFraction)) return "unknown";
  if (usedFraction >= 0.9) return "critical";
  if (usedFraction >= 0.8) return "warning";
  return "good";
}

export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-faint">
      <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
