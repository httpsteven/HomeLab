import "server-only";
import WebSocket from "ws";
import { bazarr } from "@/lib/clients/bazarr";
import { plex } from "@/lib/clients/plex";
import { radarr } from "@/lib/clients/radarr";
import { sonarr } from "@/lib/clients/sonarr";
import { invalidateMedia } from "@/lib/aggregate/media-cache";
import { refreshNow, refreshSoon } from "./collector";
import { setPushMode } from "./push-state";

/**
 * Push connections.
 *
 * Plex, Sonarr, Radarr and Bazarr all broadcast events — the same channels
 * their own web UIs use. Subscribing means a stream starting or an import
 * finishing lands on screen immediately instead of on the next poll tick.
 *
 * Every one of these is best-effort. Polling underneath is always running,
 * so the worst case if a socket won't hold is the normal cadence — never a
 * broken dashboard. Whether each source is actually pushing is recorded in
 * push-state and shown in the UI, so "real-time" is verifiable rather than
 * a claim.
 */

const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;

interface Connection {
  stop: () => void;
}

const globalForPush = globalThis as unknown as { __pushConnections?: Connection[] };

function backoff(attempt: number): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
}

/* ------------------------------------------------------------------ *
 * Plex — websocket, instant now-playing
 * ------------------------------------------------------------------ */

function connectPlex(): Connection {
  let socket: WebSocket | null = null;
  let attempt = 0;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const open = () => {
    if (stopped) return;
    const url = plex.websocketUrl();
    if (!url) {
      setPushMode("plex", "idle");
      return;
    }

    try {
      socket = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    socket.on("open", () => {
      attempt = 0;
      setPushMode("plex", "push");
    });

    socket.on("message", (raw) => {
      try {
        const payload = JSON.parse(raw.toString()) as {
          NotificationContainer?: { type?: string };
        };
        const type = payload.NotificationContainer?.type;

        // `playing` fires on every play/pause/seek/stop.
        if (type === "playing") {
          refreshNow("activity");
        }
        // A completed library scan means counts and sizes moved.
        if (type === "activity" || type === "timeline") {
          refreshSoon("library", 5_000);
        }
      } catch {
        // Malformed frame — ignore it, the next one will be fine.
      }
    });

    socket.on("close", () => {
      setPushMode("plex", "poll");
      scheduleReconnect();
    });

    socket.on("error", () => {
      // 'close' always follows; reconnect is handled there.
      setPushMode("plex", "poll");
    });
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(open, backoff(attempt++));
    timer.unref?.();
  };

  open();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      socket?.close();
      setPushMode("plex", "idle");
    },
  };
}

/* ------------------------------------------------------------------ *
 * Sonarr / Radarr — SignalR
 * ------------------------------------------------------------------ */

/**
 * Servarr's SignalR hub. This is the piece most likely to need iteration
 * across versions, so it's wrapped tightly: any failure just leaves the
 * source on its polling cadence.
 */
async function connectArr(kind: "sonarr" | "radarr"): Promise<Connection> {
  const client = kind === "sonarr" ? sonarr : radarr;
  const config = client.config;

  if (!config.url || !config.apiKey) {
    setPushMode(kind, "idle");
    return { stop: () => {} };
  }

  let stopped = false;

  try {
    // Imported lazily so a missing/incompatible signalr package can never
    // stop the server from booting.
    const signalR = await import("@microsoft/signalr");

    const connection = new signalR.HubConnectionBuilder()
      .withUrl(`${config.url}/signalr/messages?access_token=${config.apiKey}`, {
        accessTokenFactory: () => config.apiKey!,
        // Servarr's hub is websocket-first; long-polling is the fallback.
        transport:
          signalR.HttpTransportType.WebSockets | signalR.HttpTransportType.LongPolling,
      })
      .withAutomaticReconnect([0, 2_000, 5_000, 10_000, 30_000])
      .configureLogging(signalR.LogLevel.None)
      .build();

    connection.on("receiveMessage", (message: { name?: string; body?: unknown }) => {
      const name = message?.name?.toLowerCase();
      if (!name) return;

      switch (name) {
        case "queue":
          refreshNow("queue");
          break;
        case "health":
          refreshSoon("services", 1_000);
          break;
        case "movie":
        case "moviefile":
          // Something on disk changed — drop the cached library rather than
          // waiting out its 10 minute TTL.
          invalidateMedia("movies");
          refreshSoon("library", 3_000);
          refreshSoon("storage", 3_000);
          break;
        case "series":
        case "episodefile":
        case "episode":
          invalidateMedia("series");
          refreshSoon("library", 3_000);
          refreshSoon("storage", 3_000);
          break;
        default:
          break;
      }
    });

    connection.onreconnected(() => {
      setPushMode(kind, "push");
      // Re-sync after a gap: events during the outage were missed, so the
      // cached view can't be trusted.
      refreshNow("queue");
      refreshSoon("services", 500);
    });

    connection.onreconnecting(() => setPushMode(kind, "poll"));
    connection.onclose(() => setPushMode(kind, "poll"));

    await connection.start();
    if (stopped) {
      await connection.stop();
      return { stop: () => {} };
    }
    setPushMode(kind, "push");

    return {
      stop: () => {
        stopped = true;
        void connection.stop();
        setPushMode(kind, "idle");
      },
    };
  } catch {
    // Falls back to polling — which is already running.
    setPushMode(kind, "poll");
    return { stop: () => {} };
  }
}

/* ------------------------------------------------------------------ *
 * Bazarr — Socket.IO
 * ------------------------------------------------------------------ */

async function connectBazarr(): Promise<Connection> {
  const url = bazarr.socketUrl();
  const apiKey = bazarr.config.apiKey;

  if (!url || !apiKey) {
    setPushMode("bazarr", "idle");
    return { stop: () => {} };
  }

  try {
    const { io } = await import("socket.io-client");

    const socket = io(url, {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
      extraHeaders: { "X-API-KEY": apiKey },
      reconnectionDelay: RECONNECT_BASE_MS,
      reconnectionDelayMax: RECONNECT_MAX_MS,
      timeout: 8_000,
    });

    socket.on("connect", () => setPushMode("bazarr", "push"));
    socket.on("disconnect", () => setPushMode("bazarr", "poll"));
    socket.on("connect_error", () => setPushMode("bazarr", "poll"));

    // Bazarr emits a generic data event describing what changed.
    socket.on("data", (payload: { type?: string }) => {
      const type = payload?.type;
      if (type === "episode-wanted" || type === "movie-wanted" || type === "episode" || type === "movie") {
        refreshSoon("subtitles", 2_000);
      }
    });

    return {
      stop: () => {
        socket.close();
        setPushMode("bazarr", "idle");
      },
    };
  } catch {
    setPushMode("bazarr", "poll");
    return { stop: () => {} };
  }
}

/* ------------------------------------------------------------------ */

export async function startPushConnections(): Promise<void> {
  if (globalForPush.__pushConnections) return;
  const connections: Connection[] = [];
  globalForPush.__pushConnections = connections;

  if (plex.available) connections.push(connectPlex());
  if (sonarr.available) connections.push(await connectArr("sonarr"));
  if (radarr.available) connections.push(await connectArr("radarr"));
  if (bazarr.available) connections.push(await connectBazarr());

  // Tautulli and Glances have no push channel — they stay on their polls.
  setPushMode("tautulli", "poll");
  setPushMode("glances", "poll");
}

export function stopPushConnections(): void {
  for (const connection of globalForPush.__pushConnections ?? []) {
    connection.stop();
  }
  globalForPush.__pushConnections = undefined;
}
