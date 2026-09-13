import type { DashboardState, Slot, SlotKey, SlotMode } from "@/lib/types";

/**
 * The single in-memory state snapshot, plus a subscriber list.
 *
 * Browsers never talk to the lab. They subscribe here, and this is the only
 * thing that talks upstream — so ten open tabs cost the lab exactly what one
 * costs.
 */

function emptySlot<T>(): Slot<T> {
  return {
    status: "idle",
    data: null,
    error: null,
    fetchedAt: null,
    attemptedAt: null,
    mode: "idle",
    failures: 0,
  };
}

function initialState(): DashboardState {
  return {
    activity: emptySlot(),
    storage: emptySlot(),
    library: emptySlot(),
    machine: emptySlot(),
    services: emptySlot(),
    queue: emptySlot(),
    subtitles: emptySlot(),
    shorts: emptySlot(),
  };
}

export type StoreEvent =
  | { type: "snapshot"; state: DashboardState }
  | { type: "patch"; key: SlotKey; slot: Slot<unknown> };

type Listener = (event: StoreEvent) => void;

interface StoreShape {
  state: DashboardState;
  listeners: Set<Listener>;
}

// globalThis so dev hot-reload doesn't orphan the state and subscribers.
const globalForStore = globalThis as unknown as { __dashboardStore?: StoreShape };

const store: StoreShape = (globalForStore.__dashboardStore ??= {
  state: initialState(),
  listeners: new Set<Listener>(),
});

export function getState(): DashboardState {
  return store.state;
}

export function getSlot<K extends SlotKey>(key: K): DashboardState[K] {
  return store.state[key];
}

/** Number of connected browsers — drives idle backoff. */
export function clientCount(): number {
  return store.listeners.size;
}

export function subscribe(listener: Listener): () => void {
  store.listeners.add(listener);
  // New subscriber gets the whole picture immediately, then deltas.
  listener({ type: "snapshot", state: store.state });
  return () => {
    store.listeners.delete(listener);
  };
}

function emit(event: StoreEvent): void {
  for (const listener of store.listeners) {
    try {
      listener(event);
    } catch {
      // A broken subscriber (disconnected browser mid-write) must not take
      // down the collector or the other subscribers.
    }
  }
}

export function markLoading(key: SlotKey): void {
  const current = store.state[key];
  // Only show a loading state on first load — a background refresh should
  // not blank out data that's already on screen.
  const status = current.data === null ? "loading" : current.status;
  store.state = {
    ...store.state,
    [key]: { ...current, status, attemptedAt: Date.now() },
  };
}

export function setSlotData<K extends SlotKey>(
  key: K,
  data: NonNullable<DashboardState[K]["data"]>,
  mode: SlotMode = "poll",
): void {
  const now = Date.now();
  const slot: Slot<unknown> = {
    status: "ok",
    data,
    error: null,
    fetchedAt: now,
    attemptedAt: now,
    mode,
    failures: 0,
  };
  store.state = { ...store.state, [key]: slot };
  emit({ type: "patch", key, slot });
}

export function setSlotError(key: SlotKey, error: string): void {
  const current = store.state[key];
  const now = Date.now();
  const slot: Slot<unknown> = {
    ...current,
    // Keep the last good data on screen and label it stale, rather than
    // replacing a real number with an error box.
    status: "error",
    error,
    attemptedAt: now,
    failures: current.failures + 1,
  };
  store.state = { ...store.state, [key]: slot };
  emit({ type: "patch", key, slot });
}

export function setSlotNotConfigured(key: SlotKey): void {
  const now = Date.now();
  const slot: Slot<unknown> = {
    status: "not-configured",
    data: null,
    error: null,
    fetchedAt: null,
    attemptedAt: now,
    mode: "idle",
    failures: 0,
  };
  store.state = { ...store.state, [key]: slot };
  emit({ type: "patch", key, slot });
}

export function setSlotMode(key: SlotKey, mode: SlotMode): void {
  const current = store.state[key];
  if (current.mode === mode) return;
  const slot: Slot<unknown> = { ...current, mode };
  store.state = { ...store.state, [key]: slot };
  emit({ type: "patch", key, slot });
}
