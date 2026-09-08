"use client";

import Link from "next/link";
import { useSlot } from "@/components/DashboardProvider";
import { Freshness } from "@/components/shell/ConnectionIndicator";
import { CapacityBar } from "@/components/ui/CapacityBar";
import { NotConfigured, Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { formatBytes, shortenPath } from "@/lib/format";

/**
 * Capacity summary for the overview.
 *
 * Mounts are ordered by how full they are, not by size — the one about to
 * run out is the one you need to see, and burying it under a bigger, emptier
 * disk defeats the point.
 */
export function CapacitySummary({ limit = 4 }: { limit?: number }) {
  const slot = useSlot("storage");
  const storage = slot.data;

  // Pool members are excluded here too, or the summary contradicts the totals
  // beside it — showing srv1/srv2/srv3 AND the pool that spans them.
  const mounts = [...(storage?.mounts ?? [])]
    .filter((mount) => !mount.partOfPool)
    .sort((a, b) => b.usedFraction - a.usedFraction);
  const shown = mounts.slice(0, limit);

  // A mount over 90% promotes this tile to a wider cell.
  const hasCritical = mounts.some((mount) => mount.usedFraction >= 0.9);

  return (
    <Panel span={hasCritical ? "xl" : "lg"}>
      <PanelHeader
        title="Capacity"
        meta={mounts.length > limit ? `${limit} of ${mounts.length}` : undefined}
        action={<Freshness fetchedAt={slot.fetchedAt} mode={slot.mode} />}
      />
      <PanelBody className="flex flex-col gap-4">
        {slot.status === "not-configured" ? (
          <NotConfigured
            service="Storage"
            hint="Connect Sonarr, Radarr or Glances to see disk capacity."
          />
        ) : shown.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-6">
            <div className="skeleton h-16 w-full" />
          </div>
        ) : (
          <>
            {shown.map((mount) => (
              <CapacityBar
                key={mount.path}
                label={mount.label}
                sublabel={shortenPath(mount.path, 3)}
                used={mount.used}
                total={mount.total}
              />
            ))}
            {mounts.length > limit ? (
              <Link
                href="/storage"
                className="text-xs font-medium text-accent underline-offset-4 hover:underline"
              >
                All {mounts.length} mounts →
              </Link>
            ) : null}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

/** Aggregate capacity across every mount — the single "how full am I" number. */
export function TotalCapacity() {
  const slot = useSlot("storage");
  const totals = slot.data?.totals;
  const fraction = totals && totals.capacity > 0 ? totals.used / totals.capacity : 0;

  return (
    <Panel span="md">
      <PanelHeader title="Total storage" />
      <PanelBody className="flex flex-col justify-center gap-3">
        {slot.status === "not-configured" ? (
          <NotConfigured service="Storage" hint="Connect Sonarr, Radarr or Glances." />
        ) : totals ? (
          <>
            <div>
              <div className="metric text-3xl leading-none font-semibold text-ink">
                {formatBytes(totals.free)}
              </div>
              <p className="mt-1 text-xs text-ink-muted">free</p>
            </div>
            <CapacityBar
              label=""
              used={totals.used}
              total={totals.capacity}
              compact
              className="[&>div:first-child]:hidden"
            />
            <p className="metric text-[11px] text-ink-faint">
              {formatBytes(totals.used)} of {formatBytes(totals.capacity)} used ·{" "}
              {(fraction * 100).toFixed(1)}%
            </p>
          </>
        ) : (
          <div className="skeleton h-24 w-full" />
        )}
      </PanelBody>
    </Panel>
  );
}
