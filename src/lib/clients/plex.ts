import "server-only";
import { getServiceConfig, isConfigured } from "@/lib/config";
import { notConfigured, qs, request, type Result } from "@/lib/http";

/**
 * Plex Media Server client.
 *
 * Plex speaks XML by default; `Accept: application/json` gets JSON back with
 * a MediaContainer envelope. We use Plex directly for identity, sections and
 * the websocket; stream *detail* (transcode reasons, bandwidth) comes from
 * Tautulli, which enriches the same sessions far more usefully.
 */

interface MediaContainer<T> {
  MediaContainer: T;
}

export interface PlexIdentity {
  machineIdentifier: string;
  version: string;
  friendlyName?: string;
}

export interface PlexSection {
  key: string;
  title: string;
  type: string;
  agent?: string;
  scanner?: string;
  updatedAt?: number;
  Location?: { id: number; path: string }[];
}

export interface PlexSession {
  sessionKey: string;
  title: string;
  grandparentTitle?: string;
  type: string;
  thumb?: string;
  art?: string;
  User?: { id: string; title: string };
  Player?: { title: string; product: string; state: string; address?: string };
  Session?: { id: string; bandwidth?: number; location?: string };
  TranscodeSession?: {
    videoDecision?: string;
    audioDecision?: string;
    throttled?: boolean;
    progress?: number;
    speed?: number;
  };
}

class PlexClient {
  get config() {
    return getServiceConfig("plex");
  }

  get available(): boolean {
    return isConfigured(this.config);
  }

  /** WebSocket endpoint used by the push layer for instant now-playing. */
  websocketUrl(): string | null {
    const { url, apiKey } = this.config;
    if (!url || !apiKey) return null;
    const ws = url.replace(/^http/i, "ws");
    return `${ws}/:/websockets/notifications${qs({ "X-Plex-Token": apiKey })}`;
  }

  async call<T>(path: string, init: { method?: string } = {}): Promise<Result<T>> {
    const { url, apiKey } = this.config;
    if (!url || !apiKey) {
      return notConfigured("Plex is not configured. Set PLEX_URL and PLEX_TOKEN.");
    }
    return request<T>(`${url}${path}`, {
      method: init.method,
      headers: {
        "X-Plex-Token": apiKey,
        Accept: "application/json",
      },
    });
  }

  async identity(): Promise<Result<PlexIdentity>> {
    const result = await this.call<MediaContainer<PlexIdentity>>("/identity");
    if (!result.ok) return result;
    return { ...result, data: result.data.MediaContainer };
  }

  async sections(): Promise<Result<PlexSection[]>> {
    const result = await this.call<MediaContainer<{ Directory?: PlexSection[] }>>("/library/sections");
    if (!result.ok) return result;
    return { ...result, data: result.data.MediaContainer.Directory ?? [] };
  }

  async sessions(): Promise<Result<PlexSession[]>> {
    const result = await this.call<MediaContainer<{ Metadata?: PlexSession[] }>>("/status/sessions");
    if (!result.ok) return result;
    return { ...result, data: result.data.MediaContainer.Metadata ?? [] };
  }

  /**
   * The one genuinely intrusive action in the app — it stops someone's
   * playback. Gated behind a confirmation dialog in the UI.
   */
  terminateSession(sessionId: string, reason: string) {
    return this.call<unknown>(
      `/status/sessions/terminate${qs({ sessionId, reason })}`,
    );
  }
}

export const plex = new PlexClient();
