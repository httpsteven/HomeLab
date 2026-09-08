"use client";

import { Clapperboard, HardDrive, Tv, Layers } from "lucide-react";
import type { ReactNode } from "react";
import { useSlot } from "@/components/DashboardProvider";
import { NotConfigured, Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { AnimatedNumber } from "@/components/ui/Metric";
import { formatBytes, formatNumber } from "@/lib/format";

/**
 * The four numbers that answer "how big is this library".
 *
 * These are hero figures, not a chart — a single value has no shape to plot,
 * so a stat tile is the right form. Large mono numerals, one line of context
 * each, nothing else competing.
 */

function StatTile({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: ReactNode;
  sub: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3.5">
      <div className="flex items-center gap-2">
        <span className="text-ink-faint" aria-hidden>
          {icon}
        </span>
        <span className="label-muted">{label}</span>
      </div>
      <div className="text-2xl leading-none font-semibold text-ink sm:text-[28px]">{value}</div>
      <p className="metric text-[11px] text-ink-faint">{sub}</p>
    </div>
  );
}

export function HeadlineNumbers() {
  const library = useSlot("library");
  const storage = useSlot("storage");

  const movies = library.data?.movies;
  const series = library.data?.series;
  const bytes = storage.data?.libraryBytes.total ?? 0;

  const loading = library.status === "loading" && !library.data;

  return (
    <Panel span="full">
      <PanelHeader title="Library" meta="Sonarr + Radarr" />
      <PanelBody>
        {library.status === "not-configured" ? (
          <NotConfigured
            service="Sonarr / Radarr"
            hint="Connect either one to see your library counts and sizes."
          />
        ) : loading ? (
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="skeleton h-[104px]" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatTile
              label="Movies"
              icon={<Clapperboard size={13} />}
              value={
                <AnimatedNumber
                  value={movies?.total ?? 0}
                  format={(n) => formatNumber(Math.round(n))}
                />
              }
              sub={
                movies
                  ? `${formatNumber(movies.missing)} missing · ${formatBytes(movies.bytes)}`
                  : "—"
              }
            />
            <StatTile
              label="Series"
              icon={<Tv size={13} />}
              value={
                <AnimatedNumber
                  value={series?.total ?? 0}
                  format={(n) => formatNumber(Math.round(n))}
                />
              }
              sub={
                series
                  ? `${formatNumber(series.continuing)} continuing · ${formatBytes(series.bytes)}`
                  : "—"
              }
            />
            <StatTile
              label="Episodes"
              icon={<Layers size={13} />}
              value={
                <AnimatedNumber
                  value={series?.episodeFileCount ?? 0}
                  format={(n) => formatNumber(Math.round(n))}
                />
              }
              sub={series ? `${formatNumber(series.missingEpisodes)} missing` : "—"}
            />
            <StatTile
              label="On disk"
              icon={<HardDrive size={13} />}
              value={
                <AnimatedNumber value={bytes} format={(n) => formatBytes(n)} />
              }
              sub="Movies + series combined"
            />
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
