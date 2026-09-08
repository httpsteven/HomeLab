import "server-only";
import { allServices, isConfigured, type ServiceId } from "@/lib/config";
import { bazarr } from "@/lib/clients/bazarr";
import { glances } from "@/lib/clients/glances";
import { plex } from "@/lib/clients/plex";
import { radarr } from "@/lib/clients/radarr";
import { sonarr } from "@/lib/clients/sonarr";
import { tautulli } from "@/lib/clients/tautulli";
import type { Result } from "@/lib/http";

/**
 * Connection tests for the /setup page.
 *
 * Each probe is the cheapest call that proves the URL AND the key are both
 * right, and returns the version so you can see you reached the thing you
 * meant to reach.
 */

export interface ProbeResult {
  id: ServiceId;
  label: string;
  configured: boolean;
  ok: boolean;
  version: string | null;
  detail: string | null;
  durationMs: number;
  /** Present on failure — drives the specific remediation hint in the UI. */
  kind?: string;
  envVars: string[];
}

const ENV_VARS: Record<ServiceId, string[]> = {
  plex: ["PLEX_URL", "PLEX_TOKEN"],
  tautulli: ["TAUTULLI_URL", "TAUTULLI_API_KEY"],
  sonarr: ["SONARR_URL", "SONARR_API_KEY"],
  radarr: ["RADARR_URL", "RADARR_API_KEY"],
  bazarr: ["BAZARR_URL", "BAZARR_API_KEY"],
  glances: ["GLANCES_URL"],
};

function toProbe(
  id: ServiceId,
  label: string,
  configured: boolean,
  result: Result<unknown>,
  version: string | null,
  detail?: string,
): ProbeResult {
  return {
    id,
    label,
    configured,
    ok: result.ok,
    version,
    detail: result.ok ? (detail ?? null) : result.message,
    durationMs: result.durationMs,
    kind: result.ok ? undefined : result.kind,
    envVars: ENV_VARS[id],
  };
}

async function probeService(id: ServiceId, label: string, configured: boolean): Promise<ProbeResult> {
  if (!configured) {
    return {
      id,
      label,
      configured: false,
      ok: false,
      version: null,
      detail: "Not configured yet.",
      durationMs: 0,
      kind: "not-configured",
      envVars: ENV_VARS[id],
    };
  }

  switch (id) {
    case "sonarr": {
      const result = await sonarr.systemStatus();
      return toProbe(id, label, true, result, result.ok ? result.data?.version ?? null : null);
    }
    case "radarr": {
      const result = await radarr.systemStatus();
      return toProbe(id, label, true, result, result.ok ? result.data?.version ?? null : null);
    }
    case "plex": {
      const result = await plex.identity();
      return toProbe(
        id,
        label,
        true,
        result,
        result.ok ? result.data?.version ?? null : null,
        result.ok ? (result.data?.friendlyName ?? undefined) : undefined,
      );
    }
    case "tautulli": {
      const result = await tautulli.serverInfo();
      return toProbe(
        id,
        label,
        true,
        result,
        result.ok ? result.data?.pms_version ?? null : null,
        result.ok ? `Watching ${result.data?.pms_name ?? "Plex"}` : undefined,
      );
    }
    case "bazarr": {
      const result = await bazarr.status();
      return toProbe(id, label, true, result, result.ok ? result.data?.data?.bazarr_version ?? null : null);
    }
    case "glances": {
      const result = await glances.system();
      return toProbe(
        id,
        label,
        true,
        result,
        result.ok ? `API v${glances.apiVersion ?? "?"}` : null,
        result.ok ? `${result.data?.hostname ?? "host"} · ${result.data?.os_name ?? ""}`.trim() : undefined,
      );
    }
  }
}

export async function probeAllServices(): Promise<ProbeResult[]> {
  const services = allServices();
  // All in parallel — a slow or dead service must not delay the others.
  return Promise.all(
    services.map((service) => probeService(service.id, service.label, isConfigured(service))),
  );
}
