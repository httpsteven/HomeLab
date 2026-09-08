"use client";

import { TrendingUp } from "lucide-react";
import { useSlot } from "@/components/DashboardProvider";
import { Freshness } from "@/components/shell/ConnectionIndicator";
import { GrowthChart } from "@/components/charts/GrowthChart";
import { CapacityBar, StackedBar } from "@/components/ui/CapacityBar";
import { NotConfigured, Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { InfoNote, StatusBadge, capacityLevel } from "@/components/ui/Status";
import { formatBytes, formatDate, shortenPath } from "@/lib/format";
import { projectRunway } from "@/lib/runway";
import type { HistorySnapshot } from "@/lib/types";
import { LargestItems } from "./LargestItems";

/**
 * The storage page body.
 *
 * History arrives as a prop from the server; mounts come live over SSE, so
 * the runway is recomputed against current usage rather than against the
 * last snapshot.
 */
export function StorageView({ history }: { history: HistorySnapshot[] }) {
  const slot = useSlot("storage");
  const storage = slot.data;

  if (slot.status === "not-configured") {
    return (
      <Panel span="full">
        <PanelBody>
          <NotConfigured
            service="Storage"
            hint="Connect Sonarr, Radarr or Glances to see disk capacity and growth."
          />
        </PanelBody>
      </Panel>
    );
  }

  const allMounts = [...(storage?.mounts ?? [])].sort((a, b) => b.usedFraction - a.usedFraction);

  // Pool members are nested under their pool rather than listed as peers —
  // a mergerfs pool and its branches are the same bytes, and showing them
  // side by side reads as far more storage than exists.
  const mounts = allMounts.filter((mount) => !mount.partOfPool);
  const membersOf = (poolPath: string) =>
    allMounts.filter((mount) => mount.partOfPool === poolPath);

  const runway = storage ? projectRunway(history, mounts) : [];
  const runwayByPath = new Map(runway.map((entry) => [entry.path, entry]));

  const libraryBytes = storage?.libraryBytes;

  return (
    <>
      {/* --- Per-mount capacity ------------------------------------------ */}
      <Panel span="xl">
        <PanelHeader
          title="Mounts"
          meta={
            mounts.length
              ? allMounts.length > mounts.length
                ? `${mounts.length} · ${allMounts.length - mounts.length} in pools`
                : `${mounts.length}`
              : undefined
          }
          action={<Freshness fetchedAt={slot.fetchedAt} mode={slot.mode} />}
        />
        <PanelBody className="flex flex-col gap-5">
          {mounts.length === 0 ? (
            <div className="skeleton h-32 w-full" />
          ) : (
            mounts.map((mount) => {
              const projection = runwayByPath.get(mount.path);
              const members = mount.isPool ? membersOf(mount.path) : [];
              return (
                <div key={mount.path} className="flex flex-col gap-2">
                  <CapacityBar
                    label={mount.label}
                    sublabel={
                      mount.isPool
                        ? `${shortenPath(mount.path, 3)} · pool of ${members.length || mount.poolMembers?.length || 0} drives`
                        : `${shortenPath(mount.path, 3)}${mount.device ? ` · ${mount.device}` : ""}`
                    }
                    used={mount.used}
                    total={mount.total}
                  />

                  {/* The physical drives behind a pool. Shown because
                      per-drive fullness still matters — mergerfs can fail a
                      write when one branch fills even though the pool has
                      room — but never added to the totals. */}
                  {members.length > 0 ? (
                    <div className="ml-3 flex flex-col gap-2.5 border-l border-[var(--glass-border)] pl-3">
                      {members.map((member) => (
                        <CapacityBar
                          key={member.path}
                          label={member.label}
                          sublabel={`${shortenPath(member.path, 2)}${
                            member.device ? ` · ${member.device}` : ""
                          }`}
                          used={member.used}
                          total={member.total}
                          compact
                        />
                      ))}
                    </div>
                  ) : null}
                  {projection?.confident && projection.daysRemaining !== null ? (
                    <p className="metric text-[11px] text-ink-faint">
                      +{formatBytes(projection.bytesPerDay)}/day · full in{" "}
                      <span
                        style={{
                          // Text, not a fill — uses the readable critical step.
                          color:
                            projection.daysRemaining < 30
                              ? "var(--status-critical-text)"
                              : projection.daysRemaining < 90
                                ? "var(--status-warning)"
                                : "var(--text-secondary)",
                        }}
                      >
                        {Math.round(projection.daysRemaining)} days
                      </span>{" "}
                      ({formatDate(projection.fullOn)})
                    </p>
                  ) : null}
                </div>
              );
            })
          )}
        </PanelBody>
      </Panel>

      {/* --- Totals + composition ---------------------------------------- */}
      <Panel span="md">
        <PanelHeader title="Totals" />
        <PanelBody className="flex flex-col gap-4">
          {storage ? (
            <>
              <div>
                <div className="metric text-4xl leading-none font-semibold text-ink">
                  {formatBytes(storage.totals.free)}
                </div>
                <p className="mt-1.5 text-sm text-ink-muted">free across all mounts</p>
                <p className="metric mt-0.5 text-[11px] text-ink-faint">
                  {formatBytes(storage.totals.used)} used of{" "}
                  {formatBytes(storage.totals.capacity)}
                </p>
              </div>

              {libraryBytes && libraryBytes.total > 0 ? (
                <div className="flex flex-col gap-2 border-t border-[var(--glass-border)] pt-3">
                  <p className="label-muted">Library composition</p>
                  <StackedBar
                    segments={[
                      { label: "Movies", value: libraryBytes.movies, color: "var(--pair-a)" },
                      { label: "Series", value: libraryBytes.series, color: "var(--pair-b)" },
                    ]}
                  />
                  <div className="flex flex-col gap-1">
                    {[
                      { label: "Movies", value: libraryBytes.movies, color: "var(--pair-a)" },
                      { label: "Series", value: libraryBytes.series, color: "var(--pair-b)" },
                    ].map((segment) => (
                      <div key={segment.label} className="flex items-center gap-2 text-xs">
                        <span
                          className="size-2 rounded-[2px]"
                          style={{ background: segment.color }}
                          aria-hidden
                        />
                        <span className="text-ink-secondary">{segment.label}</span>
                        <span className="metric ml-auto text-ink">
                          {formatBytes(segment.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <InfoNote>
                    Library size counts media files only, so it&apos;s smaller than disk usage —
                    the difference is downloads, subtitles, artwork and other data on the same
                    mounts.
                  </InfoNote>
                </div>
              ) : null}
            </>
          ) : (
            <div className="skeleton h-40 w-full" />
          )}
        </PanelBody>
      </Panel>

      {/* --- Growth + runway ---------------------------------------------- */}
      <Panel span="full">
        <PanelHeader
          title="Growth"
          icon={<TrendingUp size={13} />}
          meta={history.length ? `${history.length} snapshots` : "no history yet"}
        />
        <PanelBody className="flex flex-col gap-4">
          <GrowthChart history={history} capacity={storage?.totals.capacity} />

          {runway.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 border-t border-[var(--glass-border)] pt-4 sm:grid-cols-2 xl:grid-cols-4">
              {runway.map((projection) => {
                const mount = mounts.find((entry) => entry.path === projection.path);
                const level = mount ? capacityLevel(mount.usedFraction) : "unknown";
                return (
                  <div key={projection.path} className="rounded-lg bg-surface-2 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">
                        {projection.label}
                      </span>
                      {level !== "good" ? <StatusBadge level={level} compact /> : null}
                    </div>

                    {!projection.confident ? (
                      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
                        {projection.spanDays < 1
                          ? "Needs a few days of history before a projection means anything."
                          : `Only ${projection.spanDays.toFixed(1)} days of history — not enough to project yet.`}
                      </p>
                    ) : projection.daysRemaining === null ? (
                      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
                        {projection.bytesPerDay > 0
                          ? "Growing too slowly to run out — years of headroom."
                          : "Not growing — no runway to project."}
                      </p>
                    ) : (
                      <>
                        <p className="metric mt-1 text-xl font-semibold text-ink">
                          {Math.round(projection.daysRemaining)}
                          <span className="ml-1 text-xs font-medium text-ink-muted">days</span>
                        </p>
                        <p className="metric text-[11px] text-ink-faint">
                          +{formatBytes(projection.bytesPerDay)}/day · full{" "}
                          {formatDate(projection.fullOn)}
                        </p>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </PanelBody>
      </Panel>

      {/* --- What's eating the space -------------------------------------- */}
      <Panel span="full">
        <PanelHeader
          title="What's eating the space"
          meta={storage ? `${storage.largest.length} ranked` : undefined}
        />
        <PanelBody>
          {storage ? (
            <LargestItems items={storage.largest} />
          ) : (
            <div className="skeleton h-64 w-full" />
          )}
        </PanelBody>
      </Panel>
    </>
  );
}
