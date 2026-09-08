"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Gauge, Users } from "lucide-react";
import { useSlot } from "@/components/DashboardProvider";
import { Freshness } from "@/components/shell/ConnectionIndicator";
import { ActionButton } from "@/components/ui/ActionButton";
import { NotConfigured, Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { formatBitrate, formatDate, formatNumber } from "@/lib/format";
import type { WatchHistoryResponse } from "@/app/api/tautulli-history/route";
import { NowPlaying } from "./NowPlaying";

/**
 * Plays over time.
 *
 * Stacked bars: discrete daily counts split into two parts of a whole. Two
 * series → legend present, and both are labelled in it with their totals.
 */
function PlaysChart({ data }: { data: WatchHistoryResponse["playsByDate"] }) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-muted">No play history yet.</p>;
  }

  const totals = data.reduce(
    (acc, day) => ({ tv: acc.tv + day.tv, movies: acc.movies + day.movies }),
    { tv: 0, movies: 0 },
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        {[
          { label: "TV", value: totals.tv, color: "var(--series-2)" },
          { label: "Movies", value: totals.movies, color: "var(--series-1)" },
        ].map((entry) => (
          <span key={entry.label} className="flex items-center gap-1.5 text-xs">
            <span
              className="size-2.5 rounded-[3px]"
              style={{ background: entry.color }}
              aria-hidden
            />
            <span className="text-ink-secondary">{entry.label}</span>
            <span className="metric text-ink-faint">{formatNumber(entry.value)}</span>
          </span>
        ))}
      </div>

      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--gridline)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) =>
                new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              }
              stroke="var(--axis)"
              tick={{ fill: "var(--text-muted)", fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: "var(--axis)" }}
              minTickGap={28}
            />
            <YAxis
              stroke="var(--axis)"
              tick={{ fill: "var(--text-muted)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={28}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              contentStyle={{
                background: "rgba(24,24,27,0.97)",
                border: "1px solid var(--glass-border-strong)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(value) => formatDate(value as string)}
              labelStyle={{ color: "var(--text-muted)", marginBottom: 4 }}
              itemStyle={{ color: "var(--text-primary)" }}
            />
            {/* 2px surface gap between stacked segments so they read apart. */}
            <Bar dataKey="movies" stackId="plays" fill="var(--series-1)" name="Movies" />
            <Bar
              dataKey="tv"
              stackId="plays"
              fill="var(--series-2)"
              name="TV"
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function RankedList({
  title,
  icon,
  rows,
  unit,
}: {
  title: string;
  icon?: React.ReactNode;
  rows: { label: string; value: number }[];
  unit: string;
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <Panel span="md">
      <PanelHeader title={title} icon={icon} />
      <PanelBody>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.label} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs text-ink-secondary">{row.label}</span>
                  <span className="metric shrink-0 text-xs font-medium text-ink">
                    {formatNumber(row.value)}
                    <span className="ml-1 text-[10px] text-ink-faint">{unit}</span>
                  </span>
                </div>
                {/* Single-hue ordinal bars — magnitude, not identity, so one
                    color at varying length is the right encoding. */}
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(row.value / max) * 100}%`,
                      background: "var(--accent)",
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

export function ActivityView() {
  const slot = useSlot("activity");
  const activity = slot.data;
  const [history, setHistory] = useState<WatchHistoryResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tautulli-history")
      .then((response) => response.json())
      .then((data: WatchHistoryResponse) => {
        if (!cancelled) setHistory(data);
      })
      .catch(() => {
        if (!cancelled) setHistory(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <NowPlaying />

      {/* --- Bandwidth --- */}
      <Panel span="md" live={(activity?.streams.length ?? 0) > 0}>
        <PanelHeader
          title="Bandwidth"
          icon={<Gauge size={13} />}
          action={<Freshness fetchedAt={slot.fetchedAt} mode={slot.mode} />}
        />
        <PanelBody className="flex flex-col gap-3">
          {slot.status === "not-configured" ? (
            <NotConfigured service="Tautulli" />
          ) : (
            <>
              <div>
                <p className="metric text-3xl leading-none font-semibold text-ink">
                  {formatBitrate(activity?.totalBandwidthKbps ?? 0)}
                </p>
                <p className="mt-1 text-xs text-ink-muted">total right now</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-surface-2 p-2.5">
                  <p className="label-muted">LAN</p>
                  <p className="metric mt-0.5 text-sm font-medium text-ink">
                    {formatBitrate(activity?.lanBandwidthKbps ?? 0)}
                  </p>
                </div>
                <div className="rounded-lg bg-surface-2 p-2.5">
                  <p className="label-muted">Remote</p>
                  <p className="metric mt-0.5 text-sm font-medium text-ink">
                    {formatBitrate(activity?.wanBandwidthKbps ?? 0)}
                  </p>
                </div>
              </div>
              {activity ? (
                <div className="flex flex-wrap gap-3 border-t border-[var(--glass-border)] pt-2.5 text-[11px]">
                  <span className="text-ink-secondary">
                    <span className="metric font-medium text-ink">{activity.counts.directPlay}</span>{" "}
                    direct
                  </span>
                  <span className="text-ink-secondary">
                    <span className="metric font-medium text-ink">
                      {activity.counts.directStream}
                    </span>{" "}
                    stream
                  </span>
                  <span className="text-ink-secondary">
                    <span className="metric font-medium text-ink">{activity.counts.transcode}</span>{" "}
                    transcoding
                  </span>
                </div>
              ) : null}
            </>
          )}
        </PanelBody>
      </Panel>

      {/* --- Stream controls --- */}
      {activity && activity.streams.length > 0 ? (
        <Panel span="md">
          <PanelHeader title="Stream control" />
          <PanelBody>
            <ul className="flex flex-col gap-2">
              {activity.streams.map((stream) => (
                <li
                  key={stream.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 p-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-ink">{stream.title}</p>
                    <p className="truncate text-[11px] text-ink-faint">{stream.user}</p>
                  </div>
                  <ActionButton
                    action="plex.terminateStream"
                    params={{
                      sessionId: stream.sessionId,
                      sessionKey: stream.id,
                      reason: "Stopped from the dashboard.",
                    }}
                    label="Stop"
                    variant="danger"
                    size="xs"
                    confirm="Confirm stop"
                  />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] leading-relaxed text-ink-faint">
              Stopping a stream interrupts playback for that viewer. Requires a second click.
            </p>
          </PanelBody>
        </Panel>
      ) : null}

      {/* --- History --- */}
      <Panel span="full">
        <PanelHeader title="Plays" meta="last 30 days" />
        <PanelBody>
          {history === null ? (
            <div className="skeleton h-[200px] w-full" />
          ) : !history.configured ? (
            <NotConfigured service="Tautulli" hint="Connect Tautulli to see watch history." />
          ) : (
            <PlaysChart data={history.playsByDate} />
          )}
        </PanelBody>
      </Panel>

      <RankedList
        title="Top titles"
        rows={(history?.topTitles ?? []).map((row) => ({ label: row.title, value: row.plays }))}
        unit="plays"
      />
      <RankedList
        title="Top users"
        icon={<Users size={13} />}
        rows={(history?.topUsers ?? []).map((row) => ({ label: row.user, value: row.plays }))}
        unit="plays"
      />

      <Panel span="md">
        <PanelHeader title="Recent" />
        <PanelBody>
          {!history?.recent.length ? (
            <p className="py-6 text-center text-sm text-ink-muted">No recent plays.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {history.recent.slice(0, 10).map((entry, index) => (
                <li key={`${entry.date}-${index}`} className="flex items-start gap-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ink-secondary">{entry.title}</p>
                    <p className="metric text-[10px] text-ink-faint">
                      {entry.user} · {entry.player}
                      {entry.transcode === "transcode" ? " · transcoded" : ""}
                    </p>
                  </div>
                  <span className="metric shrink-0 text-[10px] text-ink-faint">
                    {new Date(entry.date * 1000).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PanelBody>
      </Panel>
    </>
  );
}
