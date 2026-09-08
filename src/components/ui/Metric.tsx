"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Metric display.
 *
 * All numbers are mono + tabular so columns don't shift width as values
 * update on each poll — the single biggest source of visual noise in a
 * live dashboard.
 */

interface MetricProps {
  value: string;
  unit?: string;
  label: string;
  /** Secondary context under the value: a delta, a total, a qualifier. */
  sub?: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  /** Tint the value. Use sparingly — reserved for status, not decoration. */
  valueColor?: string;
}

const SIZES = {
  sm: { value: "text-lg", unit: "text-[11px]" },
  md: { value: "text-2xl", unit: "text-xs" },
  lg: { value: "text-3xl sm:text-4xl", unit: "text-sm" },
  xl: { value: "text-4xl sm:text-5xl", unit: "text-base" },
} as const;

export function Metric({ value, unit, label, sub, size = "md", className, valueColor }: MetricProps) {
  const sizing = SIZES[size];
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="label-muted">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span
          className={cn("metric font-semibold leading-none text-ink", sizing.value)}
          style={valueColor ? { color: valueColor } : undefined}
        >
          {value}
        </span>
        {unit ? (
          <span className={cn("metric font-medium text-ink-muted", sizing.unit)}>{unit}</span>
        ) : null}
      </span>
      {sub ? <span className="metric text-[11px] text-ink-faint">{sub}</span> : null}
    </div>
  );
}

/**
 * Counts up to a new value instead of snapping.
 *
 * Motion earns its place: this only animates when the value actually changed,
 * and never on first paint (which would make a static load look busy).
 */
export function AnimatedNumber({
  value,
  format,
  durationMs = 600,
  className,
}: {
  value: number;
  format: (n: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);
  const frame = useRef<number | null>(null);
  const isFirst = useRef(true);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      previous.current = value;
      setDisplay(value);
      return;
    }

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion || previous.current === value) {
      previous.current = value;
      setDisplay(value);
      return;
    }

    const from = previous.current;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      // easeOutCubic — decelerating arrival reads as "settling on a reading".
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        previous.current = value;
      }
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [value, durationMs]);

  return <span className={cn("metric tabular-nums", className)}>{format(display)}</span>;
}
