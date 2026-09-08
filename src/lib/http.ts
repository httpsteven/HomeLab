import "server-only";

/**
 * Shared fetch wrapper for every upstream service.
 *
 * Design rule: these NEVER throw. A service being down is a normal state for
 * a home lab, not an exception — a page render must not blow up because
 * Bazarr is restarting. Callers get a discriminated result and decide what
 * to show.
 */

export type FetchFailureKind =
  | "not-configured"
  | "unreachable"   // connection refused / DNS / no route
  | "timeout"
  | "auth"          // 401 / 403 — almost always a wrong API key
  | "not-found"     // 404 — usually a wrong base path
  | "server-error"
  | "bad-response"; // 2xx but unparseable

export interface FetchSuccess<T> {
  ok: true;
  data: T;
  /** Round-trip time in ms — surfaced on the /setup page. */
  durationMs: number;
  fetchedAt: number;
}

export interface FetchFailure {
  ok: false;
  kind: FetchFailureKind;
  /** Human-readable, safe to render directly. */
  message: string;
  status?: number;
  durationMs: number;
  fetchedAt: number;
}

export type Result<T> = FetchSuccess<T> | FetchFailure;

export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Timeout for sources on a fast cadence.
 *
 * A 2s poll must never wait 10s: the source would spend its whole life
 * blocked on a dead host, produce nothing, and leave every tile showing a
 * loading skeleton — which reads to the user as "the dashboard is broken"
 * rather than "one service is down".
 */
export const FAST_TIMEOUT_MS = 4_000;

/** Messages written for someone debugging their own lab at 1am. */
function describe(kind: FetchFailureKind, detail: string, status?: number): string {
  switch (kind) {
    case "auth":
      return `Rejected the API key (HTTP ${status}). Check the key is correct and has not been regenerated.`;
    case "not-found":
      return `Endpoint not found (HTTP 404). The base URL is probably missing or has an extra path segment.`;
    case "timeout":
      // Deliberately does NOT claim the connection was accepted — a timeout
      // can't tell "connected but silent" from "SYN dropped by a firewall",
      // and asserting either sends you debugging the wrong thing.
      return `No response before the timeout. Either nothing is listening on that port, a firewall is dropping the packets, or the service is genuinely that slow. A refused connection would fail instantly instead — a hang usually means a firewall or the wrong host.`;
    case "unreachable":
      if (detail === "ERR_INVALID_URL") {
        return `The configured URL isn't a valid URL. Check for a stray quote, space, or missing port in the env value.`;
      }
      if (detail === "ECONNREFUSED") {
        return `Connection refused — the host is reachable but nothing is listening on that port. Check the port number and that the service is running.`;
      }
      if (detail === "EHOSTUNREACH" || detail === "ENETUNREACH") {
        return `No route to that host from here. If this is running in Docker, the container may not be able to reach your LAN.`;
      }
      if (detail === "ENOTFOUND" || detail === "EAI_AGAIN") {
        return `Hostname could not be resolved. Use a LAN IP address instead of a name.`;
      }
      return `Could not connect — ${detail}. Check the host, port, and that this machine can reach it on the LAN.`;
    case "server-error":
      return `The service returned HTTP ${status}.`;
    case "bad-response":
      return `Responded, but the body could not be parsed: ${detail}`;
    case "not-configured":
      return detail;
  }
}

export function notConfigured(message: string): FetchFailure {
  return {
    ok: false,
    kind: "not-configured",
    message,
    durationMs: 0,
    fetchedAt: Date.now(),
  };
}

export interface RequestOptions {
  headers?: Record<string, string>;
  method?: string;
  body?: unknown;
  timeoutMs?: number;
  /** Set false for endpoints that return XML or plain text. */
  json?: boolean;
  signal?: AbortSignal;
}

export async function request<T>(
  url: string,
  options: RequestOptions = {},
): Promise<Result<T>> {
  const {
    headers = {},
    method = "GET",
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    json = true,
    signal,
  } = options;

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Let a caller-supplied signal (e.g. client disconnected) also cancel.
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const fail = (kind: FetchFailureKind, detail: string, status?: number): FetchFailure => ({
    ok: false,
    kind,
    message: describe(kind, detail, status),
    status,
    durationMs: Date.now() - started,
    fetchedAt: Date.now(),
  });

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: json ? "application/json" : "*/*",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return fail("auth", "", response.status);
      }
      if (response.status === 404) {
        return fail("not-found", "", response.status);
      }
      return fail("server-error", "", response.status);
    }

    let data: T;
    try {
      if (json) {
        const text = await response.text();
        // Some *arr endpoints answer 200 with an empty body on success.
        data = (text.trim() ? JSON.parse(text) : null) as T;
      } else {
        data = (await response.text()) as T;
      }
    } catch (error) {
      return fail("bad-response", error instanceof Error ? error.message : String(error));
    }

    return {
      ok: true,
      data,
      durationMs: Date.now() - started,
      fetchedAt: Date.now(),
    };
  } catch (error) {
    if (controller.signal.aborted) {
      return fail("timeout", "");
    }
    const detail =
      error instanceof Error
        ? // Node wraps the useful part in `cause`.
          ((error.cause as { code?: string } | undefined)?.code ?? error.message)
        : String(error);
    return fail("unreachable", detail);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Single-flight: concurrent callers asking for the same key share one
 * upstream request. Without this, three browser tabs mounting at once
 * triple the load on the lab for identical data.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/** Build a query string, skipping undefined values. */
export function qs(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : "";
}
