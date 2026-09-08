"use client";

import { Cpu, Monitor, Pause, Play, Wifi, Zap } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatBitrate, formatDuration } from "@/lib/format";
import type { StreamView } from "@/lib/types";
import { useSlot } from "@/components/DashboardProvider";
import { Freshness } from "@/components/shell/ConnectionIndicator";
import { NotConfigured, Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";

/**
 * Now playing.
 *
 * The one tile whose size tracks state: nothing streaming makes it a quiet
 * idle card; active streams promote it to a full-width row. That's the
 * "layout tells you where to look" rule in practice.
 */

/** Transcode is the expensive case, so it's called out — with an icon and a
    word, never color alone. */
const TRANSCODE_META = {
  "direct play": { label: "Direct play", color: "var(--status-good)", Icon: Zap },
  "direct stream": { label: "Direct stream", color: "var(--status-warning)", Icon: Wifi },
  transcode: { label: "Transcode", color: "var(--status-serious)", Icon: Cpu },
} as const;

function StreamCard({ stream }: { stream: StreamView }) {
  const meta = TRANSCODE_META[stream.transcode];
  const { Icon } = meta;
  const remaining = Math.max(stream.durationMs - stream.positionMs, 0);

  return (
    <article className="flex gap-3 rounded-xl bg-surface-2 p-3">
      {stream.posterUrl ? (
        /* Plain <img>, not next/image: the source is our own proxy route
           serving bytes from a LAN host the optimizer can't reach, and these
           are 56px thumbnails where optimization buys nothing. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={stream.posterUrl}
          alt=""
          className="h-[84px] w-[56px] shrink-0 rounded-lg object-cover"
          loading="lazy"
        />
      ) : (
        // No artwork (Tautulli image proxy unavailable, or demo mode): a
        // lettered tile beats an empty grey rectangle.
        <div
          className="grid h-[84px] w-[56px] shrink-0 place-items-center rounded-lg text-lg font-semibold text-white/80"
          style={{
            background: "linear-gradient(150deg, var(--surface-3), var(--surface-2))",
          }}
          aria-hidden
        >
          {stream.title.charAt(0).toUpperCase()}
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-ink">{stream.title}</h3>
            {stream.subtitle ? (
              <p className="truncate text-xs text-ink-muted">{stream.subtitle}</p>
            ) : null}
          </div>
          {stream.state === "paused" ? (
            <Pause size={14} className="mt-0.5 shrink-0 text-ink-muted" aria-label="Paused" />
          ) : (
            <Play size={14} className="mt-0.5 shrink-0 text-ink-muted" aria-label="Playing" />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
          <span className="truncate font-medium text-ink-secondary">{stream.user}</span>
          <span className="flex items-center gap-1 truncate">
            <Monitor size={11} aria-hidden />
            {stream.player}
          </span>
          <span className="metric">{formatBitrate(stream.bandwidthKbps)}</span>
        </div>

        <div className="mt-auto flex items-center gap-2">
          <div
            className="relative h-1 flex-1 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-valuenow={Math.round(stream.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${stream.title} progress`}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-1000 ease-linear"
              style={{ width: `${stream.progress * 100}%` }}
            />
          </div>
          <span className="metric shrink-0 text-[10px] text-ink-faint">
            {formatDuration(remaining)} left
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Icon size={11} style={{ color: meta.color }} aria-hidden />
          <span className="text-[11px] font-medium" style={{ color: meta.color }}>
            {meta.label}
          </span>
          {stream.qualitySummary ? (
            <span className="metric truncate text-[10px] text-ink-faint">
              {stream.qualitySummary}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function NowPlaying() {
  const slot = useSlot("activity");
  const activity = slot.data;
  const streams = activity?.streams ?? [];
  const hasStreams = streams.length > 0;

  // Tile size follows importance: idle is small, busy takes the room it needs.
  // Idle sits at 4 columns so it rows up with Total storage and Server (4+4+4);
  // one or two streams take 8 and pair with Total storage.
  const span = !hasStreams ? "md" : streams.length > 2 ? "full" : "xl";

  return (
    <Panel span={span} live={hasStreams}>
      <PanelHeader
        title="Now playing"
        meta={hasStreams ? `${streams.length}` : undefined}
        action={<Freshness fetchedAt={slot.fetchedAt} mode={slot.mode} />}
      />
      <PanelBody>
        {slot.status === "not-configured" ? (
          <NotConfigured
            service="Tautulli"
            hint="Tautulli provides stream detail — who's watching, and whether it's transcoding."
          />
        ) : !hasStreams ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 py-6 text-center">
            <p className="text-sm text-ink-muted">Nothing streaming</p>
            <p className="text-xs text-ink-faint">The server is idle.</p>
          </div>
        ) : (
          <div
            className={cn(
              "grid gap-2.5",
              streams.length > 1 && "sm:grid-cols-2",
              streams.length > 4 && "xl:grid-cols-3",
            )}
          >
            {streams.map((stream) => (
              <StreamCard key={stream.id} stream={stream} />
            ))}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
