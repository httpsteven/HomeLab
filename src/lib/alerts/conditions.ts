import "server-only";
import { CAPACITY_THRESHOLDS } from "@/lib/config";
import { formatBytes, formatPercent } from "@/lib/format";
import type { DashboardState } from "@/lib/types";

/**
 * Turns the collector's current state into the set of conditions worth
 * telling someone about. Pure: no I/O, no notion of what was sent before.
 * Deciding what is NEW lives in state.ts.
 */

export type AlertLevel = "warning" | "critical";

export interface Condition {
  /**
   * Stable identity for this condition across evaluations.
   *
   * It must not embed the changing value — "mount:/srv" and not
   * "mount:/srv:91%" — or every percentage point would look like a brand new
   * condition and re-notify.
   */
  key: string;
  level: AlertLevel;
  title: string;
  body: string;
}

/**
 * Hysteresis gap.
 *
 * A disk sitting exactly on the threshold would otherwise flap: alert at 90.0,
 * clear at 89.9, alert again at 90.0. A condition has to fall this far back
 * below its trigger before it counts as resolved.
 */
const CLEAR_MARGIN = 0.03;

/** Whether a fraction still counts as triggered, given it already was. */
export function stillTriggered(value: number, threshold: number, wasActive: boolean): boolean {
  return wasActive ? value >= threshold - CLEAR_MARGIN : value >= threshold;
}

export function deriveConditions(
  state: DashboardState,
  wasActive: (key: string) => boolean,
): Condition[] {
  const conditions: Condition[] = [];

  /* --- Storage ------------------------------------------------------- */
  const storage = state.storage.data;
  if (storage) {
    for (const mount of storage.mounts) {
      const key = `mount:${mount.path}`;

      if (stillTriggered(mount.usedFraction, CAPACITY_THRESHOLDS.critical, wasActive(key))) {
        conditions.push({
          key,
          level: "critical",
          title: `${mount.label} is ${formatPercent(mount.usedFraction, 0)} full`,
          body: `${formatBytes(mount.free)} free of ${formatBytes(mount.total)} on ${mount.path}.`,
        });
        continue;
      }

      if (stillTriggered(mount.usedFraction, CAPACITY_THRESHOLDS.warning, wasActive(key))) {
        conditions.push({
          key,
          level: "warning",
          title: `${mount.label} is ${formatPercent(mount.usedFraction, 0)} full`,
          body: `${formatBytes(mount.free)} free of ${formatBytes(mount.total)} on ${mount.path}.`,
        });
      }
    }

    /* A pool member filling while the pool looks healthy.
       mergerfs can fail a write when one branch is full even though the pool
       reports plenty of room, so the pool-level check alone misses it — and
       this is the failure people find out about the hard way. */
    for (const member of storage.mounts) {
      if (!member.partOfPool) continue;
      const pool = storage.mounts.find((mount) => mount.path === member.partOfPool);
      if (!pool || pool.usedFraction >= CAPACITY_THRESHOLDS.warning) continue;

      const key = `pool-member:${member.path}`;
      if (stillTriggered(member.usedFraction, CAPACITY_THRESHOLDS.critical, wasActive(key))) {
        conditions.push({
          key,
          level: "warning",
          title: `${member.label} is nearly full inside ${pool.label}`,
          body:
            `${member.label} is ${formatPercent(member.usedFraction, 0)} full while the pool ` +
            `is only ${formatPercent(pool.usedFraction, 0)}. Writes landing on that drive can ` +
            `fail even though the pool has room.`,
        });
      }
    }
  }

  /* --- Services ------------------------------------------------------ */
  const services = state.services.data;
  if (services) {
    for (const service of services.services) {
      if (!service.configured || service.reachable) continue;
      conditions.push({
        key: `service-down:${service.id}`,
        level: "critical",
        title: `${service.label} is unreachable`,
        body: service.error ?? "No response from the service.",
      });
    }
  }

  /* --- Queue --------------------------------------------------------- */
  const queue = state.queue.data;
  if (queue && queue.counts.failed > 0) {
    const failed = queue.items.filter((item) => item.hasError);
    conditions.push({
      key: "queue-failed",
      level: "warning",
      title: `${queue.counts.failed} stalled ${queue.counts.failed === 1 ? "import" : "imports"}`,
      body: failed
        .slice(0, 3)
        .map((item) => item.title)
        .join("\n") || "Check the download queue.",
    });
  }

  /* --- Temperature --------------------------------------------------- */
  const machine = state.machine.data;
  if (machine) {
    for (const sensor of machine.sensors) {
      if (sensor.unit !== "C" || sensor.critical === null) continue;
      const key = `temp:${sensor.label}`;
      const fraction = sensor.value / sensor.critical;
      if (stillTriggered(fraction, 0.9, wasActive(key))) {
        conditions.push({
          key,
          level: "critical",
          title: `${sensor.label} at ${sensor.value.toFixed(0)}°C`,
          body: `Critical threshold for this sensor is ${sensor.critical}°C.`,
        });
      }
    }
  }

  return conditions;
}
