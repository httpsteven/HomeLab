"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Label,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatBytes, formatDate } from "@/lib/format";
import type { HistorySnapshot } from "@/lib/types";

/**
 * Library growth over time.
 *
 * Form: change-over-time with two parts summing to a meaningful whole →
 * stacked area. Two series, so a legend is required; both are also direct-
 * labelled at the right edge so identity never rests on color alone.
 *
 * Colors are categorical slots 1 and 2 (blue, orange) — validated adjacent
 * on this surface. One y-axis, always: no dual-axis.
 */

const SERIES = [
  { key: "movies", label: "Movies", color: "var(--series-1)" },
  { key: "series", label: "Series", color: "var(--series-2)" },
] as const;

interface Point {
  t: number;
  movies: number;
  series: number;
  total: number;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number; color?: string }[];
  label?: number;
}) {
  if (!active || !payload?.length) return null;

  const total = payload.reduce((sum, entry) => sum + (entry.value ?? 0), 0);

  return (
    <div className="rounded-lg border border-[var(--glass-border-strong)] bg-[rgba(18,20,26,0.97)] px-3 py-2 shadow-[var(--elev-3)]">
      <p className="metric mb-1.5 text-[11px] text-ink-muted">{formatDate(label)}</p>
      {payload.map((entry) => {
        const meta = SERIES.find((series) => series.key === entry.dataKey);
        return (
          <div key={String(entry.dataKey)} className="flex items-center gap-2 text-xs">
            <span
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: meta?.color }}
              aria-hidden
            />
            <span className="text-ink-secondary">{meta?.label}</span>
            <span className="metric ml-auto pl-3 font-medium text-ink">
              {formatBytes(entry.value ?? 0)}
            </span>
          </div>
        );
      })}
      <div className="mt-1.5 flex items-center gap-2 border-t border-[var(--glass-border)] pt-1.5 text-xs">
        <span className="text-ink-muted">Total</span>
        <span className="metric ml-auto pl-3 font-semibold text-ink">{formatBytes(total)}</span>
      </div>
    </div>
  );
}

export function GrowthChart({
  history,
  /** Total capacity across all mounts, drawn as the ceiling. */
  capacity,
}: {
  history: HistorySnapshot[];
  capacity?: number;
}) {
  const data: Point[] = history.map((snapshot) => ({
    t: snapshot.t,
    movies: snapshot.libraryBytes.movies,
    series: snapshot.libraryBytes.series,
    total: snapshot.libraryBytes.total,
  }));

  if (data.length < 2) {
    return (
      <div className="flex h-[240px] flex-col items-center justify-center gap-2 rounded-lg bg-surface-2 text-center">
        <p className="text-sm text-ink-muted">Not enough history yet</p>
        <p className="max-w-[42ch] text-xs leading-relaxed text-ink-faint">
          A snapshot is recorded every 6 hours. The chart and the runway projection
          fill in from here — come back in a few days.
        </p>
      </div>
    );
  }

  const latest = data[data.length - 1];

  // Headroom to the ceiling gives the curve meaning. Without it a library
  // creeping from 41 to 44 TB reads as a flat slab — technically accurate and
  // completely uninformative about whether you're running out.
  const ceiling = capacity && capacity > latest.total ? capacity : undefined;
  const yMax = ceiling ? ceiling * 1.04 : undefined;

  return (
    <div className="flex flex-col gap-3">
      {/* Legend — always present for two or more series. */}
      <div className="flex flex-wrap items-center gap-4">
        {SERIES.map((series) => (
          <span key={series.key} className="flex items-center gap-1.5 text-xs">
            <span
              className="size-2.5 rounded-[3px]"
              style={{ background: series.color }}
              aria-hidden
            />
            <span className="text-ink-secondary">{series.label}</span>
            <span className="metric text-ink-faint">
              {formatBytes(series.key === "movies" ? latest.movies : latest.series)}
            </span>
          </span>
        ))}
      </div>

      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <defs>
              {SERIES.map((series) => (
                <linearGradient
                  key={series.key}
                  id={`fill-${series.key}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={series.color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={series.color} stopOpacity={0.06} />
                </linearGradient>
              ))}
            </defs>

            {/* Recessive grid: horizontal only, hairline. */}
            <CartesianGrid stroke="var(--gridline)" strokeDasharray="0" vertical={false} />

            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(value) =>
                new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              }
              stroke="var(--axis)"
              tick={{ fill: "var(--text-muted)", fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: "var(--axis)" }}
              minTickGap={40}
            />
            <YAxis
              tickFormatter={(value) => formatBytes(value, 0)}
              stroke="var(--axis)"
              tick={{ fill: "var(--text-muted)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={56}
              domain={yMax ? [0, yMax] : undefined}
            />

            {/* The ceiling. A dashed reference line reads as a limit rather
                than as another data series. */}
            {ceiling ? (
              <ReferenceLine
                y={ceiling}
                stroke="var(--status-warning)"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                ifOverflow="extendDomain"
              >
                <Label
                  value={`Capacity ${formatBytes(ceiling, 1)}`}
                  position="insideTopRight"
                  fill="var(--status-warning)"
                  fontSize={10}
                  offset={6}
                />
              </ReferenceLine>
            ) : null}

            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: "var(--text-muted)", strokeWidth: 1 }}
            />

            {SERIES.map((series) => (
              <Area
                key={series.key}
                type="monotone"
                dataKey={series.key}
                stackId="size"
                stroke={series.color}
                strokeWidth={2}
                fill={`url(#fill-${series.key})`}
                // A 2px surface gap between stacked fills so the segments read
                // as separate shapes rather than merging into one mass.
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface-1)" }}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
