import type { ServiceId } from "@/lib/config";
import type { SlotMode } from "@/lib/types";

/**
 * Tracks whether each service is currently delivering events over its push
 * channel or has fallen back to polling.
 *
 * This lives in its own tiny module to avoid an import cycle: the health
 * aggregator wants to report the mode, and the push layer wants to call the
 * collector, which calls the health aggregator.
 *
 * It's honest state, not aspiration — set only when a socket actually
 * connects, and cleared the moment it drops. The UI shows it so "real-time"
 * is a claim you can verify rather than take on faith.
 */

const globalForPush = globalThis as unknown as {
  __pushModes?: Map<ServiceId, SlotMode>;
  __pushReasons?: Map<ServiceId, string>;
};

const modes: Map<ServiceId, SlotMode> = (globalForPush.__pushModes ??= new Map());

/**
 * Why a source is on polling rather than push.
 *
 * The fallback used to be entirely silent: the UI reported "polling" and gave
 * no way to find out whether the socket was refused, rejected, or never
 * attempted. Reporting the mode without the reason makes a degraded state
 * look like a designed one.
 */
const reasons: Map<ServiceId, string> = (globalForPush.__pushReasons ??= new Map());

export function setPushMode(id: ServiceId, mode: SlotMode, reason?: string): void {
  modes.set(id, mode);
  if (mode === "push") reasons.delete(id);
  else if (reason) reasons.set(id, reason);
}

export function allPushReasons(): Record<string, string> {
  return Object.fromEntries(reasons);
}

export function getPushMode(id: ServiceId): SlotMode {
  return modes.get(id) ?? "poll";
}

export function allPushModes(): Record<string, SlotMode> {
  return Object.fromEntries(modes);
}
