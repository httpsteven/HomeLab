import "server-only";
import { getServiceConfig, isConfigured } from "@/lib/config";
import { FAST_TIMEOUT_MS, notConfigured, qs, request, type Result } from "@/lib/http";

/**
 * Tautulli client.
 *
 * Tautulli wraps everything in { response: { result, message, data } } and
 * answers HTTP 200 even for application-level failures, so a bad API key
 * looks like success at the transport layer. `call` unwraps that envelope
 * and converts result:"error" into a proper failure — otherwise a wrong key
 * would silently render as "no data" instead of "your key is wrong".
 */

interface TautulliEnvelope<T> {
  response: {
    result: "success" | "error";
    message: string | null;
    data: T;
  };
}

export interface StreamSession {
  session_key: string;
  session_id: string;
  user: string;
  friendly_name: string;
  user_id: number;
  title: string;
  full_title: string;
  grandparent_title: string;
  parent_title: string;
  media_type: string;
  year: string;
  thumb: string;
  parent_thumb: string;
  grandparent_thumb: string;
  art: string;
  rating_key: string;
  state: "playing" | "paused" | "buffering";
  progress_percent: string;
  duration: string;
  view_offset: string;
  player: string;
  platform: string;
  product: string;
  ip_address: string;
  location: string;
  bandwidth: string;
  quality_profile: string;
  stream_bitrate: string;
  transcode_decision: "direct play" | "copy" | "transcode";
  video_decision: string;
  audio_decision: string;
  subtitle_decision?: string;
  transcode_progress?: string;
  transcode_speed?: string;
  container: string;
  video_codec: string;
  audio_codec: string;
  video_resolution: string;
  stream_video_resolution?: string;
  stream_container_decision?: string;
  is_4k?: number;
  relayed?: number;
  secure?: number;
}

export interface Activity {
  stream_count: string;
  stream_count_direct_play: number;
  stream_count_direct_stream: number;
  stream_count_transcode: number;
  total_bandwidth: number;
  lan_bandwidth: number;
  wan_bandwidth: number;
  sessions: StreamSession[];
}

export interface LibraryRow {
  section_id: string;
  section_name: string;
  section_type: string;
  count: string;
  parent_count?: string;
  child_count?: string;
  is_active?: number;
  plays?: number;
  duration?: number;
}

export interface HomeStatRow {
  title?: string;
  friendly_name?: string;
  user?: string;
  total_plays?: number;
  total_duration?: number;
  thumb?: string;
  grandparent_thumb?: string;
  rating_key?: string;
  user_id?: number;
}

export interface HomeStat {
  stat_id: string;
  stat_title: string;
  rows: HomeStatRow[];
}

export interface PlaysByDate {
  categories: string[];
  series: { name: string; data: number[] }[];
}

class TautulliClient {
  get config() {
    return getServiceConfig("tautulli");
  }

  get available(): boolean {
    return isConfigured(this.config);
  }

  async call<T>(cmd: string, params: Record<string, string | number | undefined> = {}): Promise<Result<T>> {
    const { url, apiKey } = this.config;
    if (!url || !apiKey) {
      return notConfigured("Tautulli is not configured. Set TAUTULLI_URL and TAUTULLI_API_KEY.");
    }

    const result = await request<TautulliEnvelope<T>>(
      `${url}/api/v2${qs({ apikey: apiKey, cmd, out_type: "json", ...params })}`,
      // get_activity runs on the 2s cadence; the heavier history calls are
      // on-demand and can have the normal budget.
      { timeoutMs: cmd === "get_activity" ? FAST_TIMEOUT_MS : undefined },
    );

    if (!result.ok) return result;

    const envelope = result.data?.response;
    if (!envelope || envelope.result !== "success") {
      const message = envelope?.message ?? "Unknown error";
      // Tautulli reports a bad key as an application error over HTTP 200.
      const looksLikeAuth = /api ?key|authenticat|invalid/i.test(message);
      return {
        ok: false,
        kind: looksLikeAuth ? "auth" : "bad-response",
        message: looksLikeAuth
          ? `Tautulli rejected the API key: ${message}`
          : `Tautulli returned an error: ${message}`,
        durationMs: result.durationMs,
        fetchedAt: result.fetchedAt,
      };
    }

    return { ...result, data: envelope.data };
  }

  activity() {
    return this.call<Activity>("get_activity");
  }

  serverInfo() {
    return this.call<{ pms_name: string; pms_version: string; pms_platform: string }>("get_server_info");
  }

  librariesTable() {
    return this.call<{ data: LibraryRow[] }>("get_libraries_table", { length: 100 });
  }

  libraries() {
    return this.call<LibraryRow[]>("get_libraries");
  }

  /** Includes total_file_size per library — the Plex-side view of storage. */
  libraryMediaInfo(sectionId: string) {
    return this.call<{ total_file_size: number; recordsTotal: number }>("get_library_media_info", {
      section_id: sectionId,
      length: 1,
    });
  }

  homeStats(timeRange = 30, count = 8) {
    return this.call<HomeStat[]>("get_home_stats", { time_range: timeRange, stats_count: count });
  }

  history(length = 50) {
    return this.call<{
      data: {
        date: number;
        user: string;
        full_title: string;
        player: string;
        watched_status: number;
        duration: number;
        transcode_decision: string;
        media_type: string;
      }[];
      recordsTotal: number;
    }>("get_history", { length });
  }

  playsByDate(timeRange = 30) {
    return this.call<PlaysByDate>("get_plays_by_date", { time_range: timeRange });
  }

  /**
   * Terminate by session_key.
   *
   * A fallback for Plex's own endpoint, which needs Session.id. Tautulli
   * accepts the key we already display, so this works even when Session.id
   * is missing from the payload.
   */
  terminateSession(sessionKey: string, message: string) {
    return this.call<unknown>("terminate_session", {
      session_key: sessionKey,
      message,
    });
  }

  /** Proxied image URL — keeps the Tautulli key server-side. */
  imageUrl(img: string, width = 300, height = 450): string | null {
    const { url, apiKey } = this.config;
    if (!url || !apiKey) return null;
    return `${url}/api/v2${qs({
      apikey: apiKey,
      cmd: "pms_image_proxy",
      img,
      width,
      height,
      fallback: "poster",
    })}`;
  }
}

export const tautulli = new TautulliClient();
