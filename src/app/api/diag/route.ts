import { allServices, isConfigured } from "@/lib/config";
import { getState } from "@/lib/collect/store";
import { allPushModes, allPushReasons } from "@/lib/collect/push-state";
import { probeAllServices } from "@/lib/health-check";
import { isDemoMode } from "@/lib/demo";
import type { SlotKey } from "@/lib/types";

/**
 * Diagnostics: what the collector actually knows, and how long each service
 * takes to answer.
 *
 * Point curl at this when the dashboard feels slow — it says which source is
 * stalling and how stale each slot is, which beats guessing from the UI.
 *
 *   curl -s http://localhost:3000/api/diag | jq
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  const state = getState();
  const now = Date.now();

  const slots = (Object.keys(state) as SlotKey[]).map((key) => {
    const slot = state[key];
    return {
      slot: key,
      status: slot.status,
      hasData: slot.data !== null,
      mode: slot.mode,
      ageSeconds: slot.fetchedAt ? Math.round((now - slot.fetchedAt) / 1000) : null,
      consecutiveFailures: slot.failures,
      error: slot.error,
    };
  });

  // Live probe — this is the number that matters when something feels slow.
  const probes = await probeAllServices();

  return Response.json(
    {
      demoMode: isDemoMode(),
      configured: allServices()
        .filter((service) => isConfigured(service))
        .map((service) => service.id),
      pushModes: allPushModes(),
      // Why anything on "poll" isn't pushing.
      pushFallbackReasons: allPushReasons(),
      slots,
      probes: probes.map((probe) => ({
        service: probe.id,
        // The resolved base URL, so a stale container env is visible here too.
        triedUrl: probe.baseUrl,
        configured: probe.configured,
        ok: probe.ok,
        responseMs: probe.durationMs,
        version: probe.version,
        error: probe.detail,
      })),
      diagnosticTookMs: Date.now() - started,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
