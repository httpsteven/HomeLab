import "server-only";
import { getServiceConfig, isConfigured } from "@/lib/config";
import { notConfigured, qs, request, type Result } from "@/lib/http";

/**
 * Bazarr client. Uses X-API-KEY (note the dashes — different from Servarr's
 * X-Api-Key) against /api.
 */

export interface BazarrBadges {
  episodes: number;
  movies: number;
  providers: number;
  status: number;
  sonarr_signalr?: string;
  radarr_signalr?: string;
}

export interface BazarrStatus {
  data: {
    bazarr_version: string;
    sonarr_version?: string;
    radarr_version?: string;
    operating_system?: string;
    python_version?: string;
    start_time?: number;
  };
}

export interface BazarrProvider {
  name: string;
  status: string;
  retry: string;
}

export interface WantedEpisode {
  seriesTitle: string;
  episode_number: string;
  episodeTitle: string;
  missing_subtitles: { name: string; code2: string; code3: string }[];
  sonarrSeriesId: number;
  sonarrEpisodeId: number;
}

export interface WantedMovie {
  title: string;
  missing_subtitles: { name: string; code2: string; code3: string }[];
  radarrId: number;
}

class BazarrClient {
  get config() {
    return getServiceConfig("bazarr");
  }

  get available(): boolean {
    return isConfigured(this.config);
  }

  /** Socket.IO endpoint used by the push layer. */
  socketUrl(): string | null {
    return this.config.url;
  }

  async call<T>(
    path: string,
    options: { method?: string; body?: unknown; params?: Record<string, string | number | undefined> } = {},
  ): Promise<Result<T>> {
    const { url, apiKey } = this.config;
    if (!url || !apiKey) {
      return notConfigured("Bazarr is not configured. Set BAZARR_URL and BAZARR_API_KEY.");
    }
    return request<T>(`${url}/api${path}${qs(options.params ?? {})}`, {
      method: options.method,
      body: options.body,
      headers: { "X-API-KEY": apiKey },
    });
  }

  status() {
    return this.call<BazarrStatus>("/system/status");
  }

  health() {
    return this.call<{ data: { object: string; issue: string }[] }>("/system/health");
  }

  /** Counts of wanted subtitles and unhealthy providers — the summary view. */
  badges() {
    return this.call<BazarrBadges>("/badges");
  }

  providers() {
    return this.call<{ data: BazarrProvider[] }>("/providers");
  }

  wantedEpisodes(length = 50) {
    return this.call<{ data: WantedEpisode[]; total: number }>("/episodes/wanted", {
      params: { start: 0, length },
    });
  }

  wantedMovies(length = 50) {
    return this.call<{ data: WantedMovie[]; total: number }>("/movies/wanted", {
      params: { start: 0, length },
    });
  }

  /** Trigger a subtitle search for one episode. */
  searchEpisodeSubtitles(seriesId: number, episodeId: number) {
    return this.call<unknown>("/episodes/subtitles", {
      method: "PATCH",
      params: { seriesid: seriesId, episodeid: episodeId },
    });
  }

  /** Trigger a subtitle search for one movie. */
  searchMovieSubtitles(radarrId: number) {
    return this.call<unknown>("/movies/subtitles", {
      method: "PATCH",
      params: { radarrid: radarrId },
    });
  }
}

export const bazarr = new BazarrClient();
