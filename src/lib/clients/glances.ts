import "server-only";
import { getServiceConfig, glancesApiVersion, isConfigured } from "@/lib/config";
import { FAST_TIMEOUT_MS, notConfigured, request, type Result } from "@/lib/http";

/**
 * Glances client — machine metrics (CPU, RAM, temps, disk I/O, network).
 *
 * Glances 4 serves /api/4/… and Glances 3 serves /api/3/…. Rather than make
 * the user work out which they have, the first call probes the configured
 * version and falls back to the other, then remembers the answer.
 */

export interface GlancesCpu {
  total: number;
  user: number;
  system: number;
  idle: number;
  iowait?: number;
  steal?: number;
  nice?: number;
}

export interface GlancesMem {
  total: number;
  available: number;
  percent: number;
  used: number;
  free: number;
  active?: number;
  cached?: number;
  buffers?: number;
}

export interface GlancesSwap {
  total: number;
  used: number;
  free: number;
  percent: number;
}

export interface GlancesFs {
  device_name: string;
  fs_type: string;
  mnt_point: string;
  size: number;
  used: number;
  free: number;
  percent: number;
}

export interface GlancesSensor {
  label: string;
  value: number;
  unit: string;
  warning?: number;
  critical?: number;
  type?: string;
}

export interface GlancesNetwork {
  interface_name: string;
  bytes_recv: number;
  bytes_sent: number;
  bytes_recv_rate_per_sec?: number;
  bytes_sent_rate_per_sec?: number;
  speed?: number;
  is_up?: boolean;
}

export interface GlancesDiskIO {
  disk_name: string;
  read_bytes: number;
  write_bytes: number;
  read_bytes_rate_per_sec?: number;
  write_bytes_rate_per_sec?: number;
}

export interface GlancesLoad {
  min1: number;
  min5: number;
  min15: number;
  cpucore?: number;
}

export interface GlancesProcess {
  name: string;
  cpu_percent: number;
  memory_percent: number;
  pid: number;
  username?: string;
}

export interface GlancesSystem {
  hostname: string;
  os_name: string;
  os_version?: string;
  platform?: string;
  linux_distro?: string;
}

/** Shape of /api/{v}/all — the plugins this dashboard reads. */
export interface GlancesAll {
  cpu?: GlancesCpu;
  mem?: GlancesMem;
  memswap?: GlancesSwap;
  load?: GlancesLoad;
  sensors?: GlancesSensor[];
  network?: GlancesNetwork[];
  diskio?: GlancesDiskIO[];
  uptime?: string;
  system?: GlancesSystem;
  percpu?: { cpu_number: number; total: number }[];
  processlist?: GlancesProcess[];
  fs?: GlancesFs[];
}

class GlancesClient {
  /** Cached after the first successful probe. */
  private resolvedVersion: number | null = null;

  get config() {
    return getServiceConfig("glances");
  }

  get available(): boolean {
    return isConfigured(this.config);
  }

  get apiVersion(): number | null {
    return this.resolvedVersion;
  }

  private async attempt<T>(version: number, endpoint: string): Promise<Result<T>> {
    const { url } = this.config;
    // Glances sits on the 2s cadence, so it gets the short timeout.
    return request<T>(`${url}/api/${version}/${endpoint}`, { timeoutMs: FAST_TIMEOUT_MS });
  }

  async call<T>(endpoint: string): Promise<Result<T>> {
    const { url } = this.config;
    if (!url) {
      return notConfigured(
        "Glances is not configured. Set GLANCES_URL (see the README for the one-line Docker setup).",
      );
    }

    if (this.resolvedVersion !== null) {
      return this.attempt<T>(this.resolvedVersion, endpoint);
    }

    // Probe the configured version, then the other one. A 404 means "wrong
    // API version"; anything else is a real failure worth reporting as-is.
    const preferred = glancesApiVersion();
    const first = await this.attempt<T>(preferred, endpoint);
    if (first.ok) {
      this.resolvedVersion = preferred;
      return first;
    }
    if (first.kind !== "not-found") return first;

    const alternate = preferred === 4 ? 3 : 4;
    const second = await this.attempt<T>(alternate, endpoint);
    if (second.ok) {
      this.resolvedVersion = alternate;
      return second;
    }
    return first;
  }

  /**
   * Every plugin in ONE request.
   *
   * This replaces eleven separate round trips per poll. At a 2s cadence that
   * was 330 requests a minute against the server just to draw one panel —
   * enough to make both the dashboard and the machine it's watching crawl.
   */
  all() {
    return this.call<GlancesAll>("all");
  }

  cpu() {
    return this.call<GlancesCpu>("cpu");
  }

  mem() {
    return this.call<GlancesMem>("mem");
  }

  swap() {
    return this.call<GlancesSwap>("memswap");
  }

  fs() {
    return this.call<GlancesFs[]>("fs");
  }

  sensors() {
    return this.call<GlancesSensor[]>("sensors");
  }

  network() {
    return this.call<GlancesNetwork[]>("network");
  }

  diskio() {
    return this.call<GlancesDiskIO[]>("diskio");
  }

  load() {
    return this.call<GlancesLoad>("load");
  }

  uptime() {
    return this.call<string>("uptime");
  }

  system() {
    return this.call<GlancesSystem>("system");
  }

  /** Per-core percentages; absent on some platforms. */
  percpu() {
    return this.call<{ cpu_number: number; total: number }[]>("percpu");
  }

  processList() {
    return this.call<GlancesProcess[]>("processlist");
  }
}

export const glances = new GlancesClient();
