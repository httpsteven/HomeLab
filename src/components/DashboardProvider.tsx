"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { DashboardState, Slot, SlotKey } from "@/lib/types";
import { hexToRgbTripletClient } from "@/lib/color-client";

/**
 * Subscribes once to the server's SSE stream and shares the state with the
 * whole app.
 *
 * One connection per browser tab, not one per component — and the tab drops
 * it entirely when hidden, so a phone in a pocket isn't holding a stream open
 * or draining battery.
 */

export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "paused";

interface DashboardContextValue {
  state: DashboardState | null;
  status: ConnectionStatus;
  /** Server time of the last message — the freshness anchor for the UI. */
  lastEventAt: number | null;
}

const DashboardContext = createContext<DashboardContextValue>({
  state: null,
  status: "connecting",
  lastEventAt: null,
});

type StoreEvent =
  | { type: "snapshot"; state: DashboardState }
  | { type: "patch"; key: SlotKey; slot: Slot<unknown> };

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DashboardState | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (disposed || sourceRef.current) return;

      const source = new EventSource("/api/stream");
      sourceRef.current = source;

      source.onopen = () => setStatus("live");

      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as StoreEvent;
          setLastEventAt(Date.now());
          setStatus("live");

          if (payload.type === "snapshot") {
            setState(payload.state);
          } else {
            setState((current) =>
              current
                ? ({ ...current, [payload.key]: payload.slot } as DashboardState)
                : current,
            );
          }
        } catch {
          // Ignore a malformed frame; the next one will be fine.
        }
      };

      source.onerror = () => {
        // EventSource retries on its own; reflect that rather than tearing
        // down and rebuilding the connection ourselves.
        setStatus("reconnecting");
      };
    };

    const disconnect = () => {
      sourceRef.current?.close();
      sourceRef.current = null;
    };

    // Hidden tab: drop the stream. On return, reconnect — the snapshot that
    // arrives on connect re-syncs whatever was missed.
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        disconnect();
        setStatus("paused");
      } else {
        setStatus("connecting");
        connect();
      }
    };

    connect();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      disconnect();
    };
  }, []);

  /* --- Ambient wash ----------------------------------------------------
     The signature move: the page takes on the colour of whatever is playing,
     and returns to the brand red when nothing is.

     Only the background wash changes. The brand accent stays fixed — a poster
     repainting the nav, focus rings and progress bars would erase the
     identity every time someone pressed play. Data marks never use either. */
  const accent = state?.activity.data?.accent ?? null;
  useEffect(() => {
    const root = document.documentElement;
    if (accent) {
      const triplet = hexToRgbTripletClient(accent);
      if (triplet) root.style.setProperty("--ambient-glow", `rgba(${triplet}, 0.20)`);
    } else {
      root.style.removeProperty("--ambient-glow");
    }
  }, [accent]);

  const value = useMemo(
    () => ({ state, status, lastEventAt }),
    [state, status, lastEventAt],
  );

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard() {
  return useContext(DashboardContext);
}

/** Typed access to one slot. */
export function useSlot<K extends SlotKey>(key: K): DashboardState[K] {
  const { state } = useDashboard();
  return (
    state?.[key] ??
    ({
      status: "loading",
      data: null,
      error: null,
      fetchedAt: null,
      attemptedAt: null,
      mode: "idle",
      failures: 0,
    } as DashboardState[K])
  );
}
