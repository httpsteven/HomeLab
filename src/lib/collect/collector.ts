import "server-only";
import { buildActivityState } from "@/lib/aggregate/activity";
import { buildLibraryState } from "@/lib/aggregate/library";
import { buildShortsState } from "@/lib/aggregate/shorts";
import { buildMachineState } from "@/lib/aggregate/machine";
import { buildStorageState } from "@/lib/aggregate/storage";
import {
  buildQueueState,
  buildServicesState,
  buildSubtitleState,
} from "@/lib/aggregate/health";
import { bazarr } from "@/lib/clients/bazarr";
import { glances } from "@/lib/clients/glances";
import { radarr } from "@/lib/clients/radarr";
import { sonarr } from "@/lib/clients/sonarr";
import { tautulli } from "@/lib/clients/tautulli";
import { shortsAvailable } from "@/lib/clients/shorts";
import type { LibraryState, SlotKey } from "@/lib/types";
import {
  clientCount,
  markLoading,
  setSlotData,
  setSlotError,
  setSlotNotConfigured,
} from "./store";
import { recordSnapshotIfDue } from "@/lib/history";
import { evaluateAlerts } from "@/lib/alerts";
import { markCollectorStart } from "@/lib/alerts/state";
import {
  demoActivity,
  demoLibrary,
  demoMachine,
  demoQueue,
  demoServices,
  demoStorage,
  demoSubtitles,
  demoShorts,
  isDemoMode,
} from "@/lib/demo";

/**
 * The collector: one scheduler, one set of upstream connections.
 *
 * Each source declares its own cadence and whether it's worth running when
 * nobody is watching. Sources are scheduled independently so a slow or dead
 * service can never stall the others — the classic failure of a single
 * "refresh everything" tick.
 */

interface Source {
  key: SlotKey;
  /** Normal cadence in ms. */
  intervalMs: number;
  /** Skip entirely when no browser is connected (saves the lab and the battery). */
  requiresClients: boolean;
  /** False when the underlying service has no URL/key configured. */
  isConfigured: () => boolean;
  run: () => Promise<unknown>;
}

/**
 * Demo mode swaps the upstream calls for generated data of the same shape.
 * Everything downstream — the store, SSE, every component — is unchanged, so
 * what you see in demo is exactly what you'll see with real services.
 */
let demoLibraryCache: LibraryState | null = null;
function demoLibraryState(): LibraryState {
  // Generating 1,380 items on a 2s tick would be silly; the library is
  // static in demo, only the live sources drift.
  demoLibraryCache ??= demoLibrary();
  return demoLibraryCache;
}

const DEMO_SOURCES: Record<SlotKey, () => unknown> = {
  activity: demoActivity,
  machine: demoMachine,
  services: demoServices,
  queue: demoQueue,
  subtitles: demoSubtitles,
  library: demoLibraryState,
  storage: () => demoStorage(demoLibraryState()),
  shorts: demoShorts,
};

const SOURCES: Source[] = [
  {
    key: "activity",
    intervalMs: 2_000,
    requiresClients: true,
    isConfigured: () => tautulli.available,
    run: buildActivityState,
  },
  {
    // 3s rather than 2s: this is now a single /api/all request, and Glances
    // does real work to answer it (processlist especially). Three seconds is
    // still well inside "live" for CPU and memory.
    key: "machine",
    intervalMs: 3_000,
    requiresClients: true,
    isConfigured: () => glances.available,
    run: buildMachineState,
  },
  {
    key: "queue",
    intervalMs: 30_000,
    requiresClients: false,
    isConfigured: () => sonarr.available || radarr.available,
    run: buildQueueState,
  },
  {
    key: "services",
    intervalMs: 30_000,
    requiresClients: false,
    isConfigured: () => true, // always useful — it reports what's unreachable
    run: buildServicesState,
  },
  {
    key: "subtitles",
    intervalMs: 60_000,
    requiresClients: false,
    isConfigured: () => bazarr.available,
    run: buildSubtitleState,
  },
  {
    key: "storage",
    intervalMs: 10 * 60_000,
    requiresClients: false,
    isConfigured: () => sonarr.available || radarr.available || glances.available,
    run: buildStorageState,
  },
  {
    // 5s: the database is a local file, so this costs nothing upstream. It also
    // publishes the viewer heartbeat the pipeline's worker reads, which wants
    // to be reasonably fresh — the worker treats a stale heartbeat as "someone
    // might be watching" and stops working.
    key: "shorts",
    intervalMs: 5_000,
    requiresClients: false,
    isConfigured: () => shortsAvailable(),
    run: buildShortsState,
  },
  {
    key: "library",
    intervalMs: 10 * 60_000,
    requiresClients: false,
    isConfigured: () => sonarr.available || radarr.available,
    run: buildLibraryState,
  },
];

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;

interface RunnerState {
  timer: NodeJS.Timeout | null;
  failures: number;
  running: boolean;
}

interface CollectorShape {
  started: boolean;
  runners: Map<SlotKey, RunnerState>;
}

const globalForCollector = globalThis as unknown as { __collector?: CollectorShape };
const collector: CollectorShape = (globalForCollector.__collector ??= {
  started: false,
  runners: new Map(),
});

function backoffFor(failures: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
}

async function runSource(source: Source): Promise<void> {
  const runner = collector.runners.get(source.key);
  if (!runner || runner.running) return;

  if (isDemoMode()) {
    setSlotData(source.key, DEMO_SOURCES[source.key]() as never, "poll");
    // Alerts are evaluated in demo mode too. Demo exists so behaviour can be
    // exercised without a real problem to wait for, and alerting is precisely
    // the thing you want to have verified BEFORE you need it.
    void evaluateAlerts();
    schedule(source, source.requiresClients ? source.intervalMs : 30_000);
    return;
  }

  if (!source.isConfigured()) {
    setSlotNotConfigured(source.key);
    schedule(source, source.intervalMs);
    return;
  }

  // Idle backoff: nothing to render for, so don't poll the lab.
  if (source.requiresClients && clientCount() === 0) {
    schedule(source, 5_000);
    return;
  }

  runner.running = true;
  markLoading(source.key);

  try {
    const data = await source.run();
    runner.failures = 0;
    setSlotData(source.key, data as never);

    // Evaluated after the data lands rather than on its own timer, so an
    // alert fires as soon as the state that triggers it exists. Detached and
    // swallowing its own errors: alerting must never stall collection.
    void evaluateAlerts();

    // Storage refresh is also when a history snapshot is due.
    if (source.key === "storage") {
      void recordSnapshotIfDue().catch(() => {});
    }

    schedule(source, source.intervalMs);
  } catch (error) {
    runner.failures += 1;
    setSlotError(source.key, error instanceof Error ? error.message : String(error));
    schedule(source, backoffFor(runner.failures));
  } finally {
    runner.running = false;
  }
}

function schedule(source: Source, delayMs: number): void {
  const runner = collector.runners.get(source.key);
  if (!runner) return;
  if (runner.timer) clearTimeout(runner.timer);
  runner.timer = setTimeout(() => void runSource(source), delayMs);
  // Don't hold the process open just for a poll timer.
  runner.timer.unref?.();
}

/**
 * Force a source to refresh now — the hook the push layer pulls when a
 * SignalR or websocket event says something actually changed. This is what
 * makes push events translate into fresh numbers instead of just a nudge.
 */
export function refreshNow(key: SlotKey): void {
  const source = SOURCES.find((candidate) => candidate.key === key);
  if (!source) return;
  const runner = collector.runners.get(key);
  if (!runner || runner.running) return;
  if (runner.timer) clearTimeout(runner.timer);
  void runSource(source);
}

/** Debounced variant — push channels can emit a burst of events at once. */
const pendingRefresh = new Map<SlotKey, NodeJS.Timeout>();
export function refreshSoon(key: SlotKey, delayMs = 1_500): void {
  const existing = pendingRefresh.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingRefresh.delete(key);
    refreshNow(key);
  }, delayMs);
  timer.unref?.();
  pendingRefresh.set(key, timer);
}

export function startCollector(): void {
  if (collector.started) return;
  collector.started = true;

  // Anchors the startup grace period. Slots fill in over several seconds, and
  // an empty services slot is indistinguishable from every service being down
  // — without this every restart would announce a full outage.
  markCollectorStart();

  for (const source of SOURCES) {
    collector.runners.set(source.key, { timer: null, failures: 0, running: false });
  }

  // Stagger the initial run so we don't fire every request at the lab in the
  // same millisecond on boot.
  SOURCES.forEach((source, index) => {
    schedule(source, index * 150);
  });
}

export function isCollectorStarted(): boolean {
  return collector.started;
}
