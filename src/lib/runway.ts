import type { HistorySnapshot } from "./types";

/**
 * Growth-rate fitting and runway projection.
 *
 * Kept free of server-only imports so the client can recompute against live
 * mount data without a round trip.
 */

export interface RunwayProjection {
  path: string;
  label: string;
  /** Bytes/day, from a least-squares fit over the available window. */
  bytesPerDay: number;
  daysRemaining: number | null;
  fullOn: number | null;
  /** How much history backs this. Under ~3 days it isn't worth trusting. */
  spanDays: number;
  confident: boolean;
}

/**
 * Least-squares linear fit of used-bytes over time, per mount.
 *
 * Deliberately simple — and deliberately honest about it. `confident` stays
 * false until there's a real span of history, and the UI says so rather than
 * drawing an authoritative line through two points. A flat or shrinking mount
 * yields no projection at all instead of a nonsense date.
 */
export function projectRunway(
  history: HistorySnapshot[],
  mounts: { path: string; label: string; total: number; used: number }[],
): RunwayProjection[] {
  const base = (mount: { path: string; label: string }, spanDays: number): RunwayProjection => ({
    path: mount.path,
    label: mount.label,
    bytesPerDay: 0,
    daysRemaining: null,
    fullOn: null,
    spanDays,
    confident: false,
  });

  if (history.length < 2) {
    return mounts.map((mount) => base(mount, 0));
  }

  const spanDays = (history[history.length - 1].t - history[0].t) / 86_400_000;

  return mounts.map((mount) => {
    const points = history
      .map((snapshot) => {
        const entry = snapshot.mounts.find((m) => m.path === mount.path);
        return entry ? { x: snapshot.t, y: entry.used } : null;
      })
      .filter((point): point is { x: number; y: number } => point !== null);

    if (points.length < 2) return base(mount, spanDays);

    const n = points.length;
    const meanX = points.reduce((sum, point) => sum + point.x, 0) / n;
    const meanY = points.reduce((sum, point) => sum + point.y, 0) / n;

    let numerator = 0;
    let denominator = 0;
    for (const point of points) {
      numerator += (point.x - meanX) * (point.y - meanY);
      denominator += (point.x - meanX) ** 2;
    }

    const bytesPerDay = denominator === 0 ? 0 : (numerator / denominator) * 86_400_000;
    const remaining = Math.max(mount.total - mount.used, 0);

    // Past ~5 years the projection is noise dressed up as a number — a mount
    // creeping along at 60 MB/day is not "full on Oct 11, 2097", it just
    // isn't filling up. Report no runway rather than false precision.
    const rawDays = bytesPerDay > 0 ? remaining / bytesPerDay : null;
    const daysRemaining = rawDays !== null && rawDays <= 1825 ? rawDays : null;

    return {
      path: mount.path,
      label: mount.label,
      bytesPerDay,
      daysRemaining,
      fullOn: daysRemaining !== null ? Date.now() + daysRemaining * 86_400_000 : null,
      spanDays,
      confident: spanDays >= 3 && points.length >= 4,
    };
  });
}
