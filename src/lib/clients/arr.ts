import "server-only";
import { getServiceConfig, isConfigured, type ServiceId } from "@/lib/config";
import { notConfigured, qs, request, type RequestOptions, type Result } from "@/lib/http";

/**
 * Shared client for Sonarr and Radarr — both are Servarr apps and expose the
 * same /api/v3 surface with an X-Api-Key header, so the transport is written
 * once and the media-specific endpoints live in sonarr.ts / radarr.ts.
 */

export interface DiskSpace {
  path: string;
  label: string;
  freeSpace: number;
  totalSpace: number;
}

export interface RootFolder {
  id: number;
  path: string;
  freeSpace?: number;
  accessible?: boolean;
}

export interface HealthIssue {
  source: string;
  type: "ok" | "notice" | "warning" | "error";
  message: string;
  wikiUrl?: string;
}

export interface SystemStatus {
  version: string;
  appName?: string;
  instanceName?: string;
  startTime?: string;
  osName?: string;
  isDocker?: boolean;
}

export interface QualityProfile {
  id: number;
  name: string;
}

export interface QueueItem {
  id: number;
  title: string;
  status: string;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  errorMessage?: string;
  size: number;
  sizeleft: number;
  timeleft?: string;
  estimatedCompletionTime?: string;
  downloadClient?: string;
  indexer?: string;
  seriesId?: number;
  movieId?: number;
  statusMessages?: { title?: string; messages?: string[] }[];
}

export interface QueueResponse {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: QueueItem[];
}

export type ArrKind = Extract<ServiceId, "sonarr" | "radarr">;

export class ArrClient {
  constructor(readonly kind: ArrKind) {}

  get config() {
    return getServiceConfig(this.kind);
  }

  get available(): boolean {
    return isConfigured(this.config);
  }

  /** Base URL for the SignalR hub, used by the push layer. */
  signalRUrl(): string | null {
    const { url, apiKey } = this.config;
    if (!url || !apiKey) return null;
    return `${url}/signalr/messages`;
  }

  async call<T>(path: string, options: RequestOptions = {}): Promise<Result<T>> {
    const { url, apiKey, label } = this.config;
    if (!url || !apiKey) {
      return notConfigured(
        `${label} is not configured. Set ${this.kind.toUpperCase()}_URL and ${this.kind.toUpperCase()}_API_KEY.`,
      );
    }
    return request<T>(`${url}/api/v3${path}`, {
      ...options,
      headers: { "X-Api-Key": apiKey, ...options.headers },
    });
  }

  systemStatus() {
    return this.call<SystemStatus>("/system/status");
  }

  health() {
    return this.call<HealthIssue[]>("/health");
  }

  diskSpace() {
    return this.call<DiskSpace[]>("/diskspace");
  }

  rootFolders() {
    return this.call<RootFolder[]>("/rootfolder");
  }

  qualityProfiles() {
    return this.call<QualityProfile[]>("/qualityprofile");
  }

  queue(pageSize = 100) {
    return this.call<QueueResponse>(
      `/queue${qs({ pageSize, includeUnknownSeriesItems: true, includeUnknownMovieItems: true })}`,
    );
  }

  /**
   * Commands are how Servarr exposes actions. The name is supplied by an
   * allowlist in lib/actions.ts — never passed through from the client — so
   * there is no path from the browser to an arbitrary command.
   */
  command(name: string, payload: Record<string, unknown> = {}) {
    return this.call<{ id: number; name: string; status: string }>("/command", {
      method: "POST",
      body: { name, ...payload },
    });
  }
}
