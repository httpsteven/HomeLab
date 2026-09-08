import { RefreshCw } from "lucide-react";
import { probeAllServices, type ProbeResult } from "@/lib/health-check";
import { PageHeader } from "@/components/shell/AppShell";
import { BentoGrid, Panel } from "@/components/ui/Panel";
import { StatusBadge, type StatusLevel } from "@/components/ui/Status";

export const dynamic = "force-dynamic";

/**
 * Connection tester.
 *
 * Built first and deliberately blunt: five sets of credentials have to be
 * pasted in, and "it doesn't work" is a miserable place to start debugging.
 * Every failure here says which of the two things is wrong — the address or
 * the key — and what to do about it.
 */

const REMEDIATION: Record<string, string> = {
  auth: "The URL is right but the key was rejected. Copy it again from the service's Settings → General page.",
  "not-found":
    "Reached a server, but not this service's API. Check for an extra path on the URL — it should be just http://host:port.",
  unreachable:
    "Nothing is listening there. Check the host and port, that the service is running, and that this machine can reach it on the LAN.",
  timeout:
    "A hang rather than an instant refusal points at a firewall dropping packets. If the dashboard runs in Docker on the same box as this service, requests to the host's LAN IP leave the container and come back through the host firewall — use 127.0.0.1 with host networking instead.",
  "server-error": "The service answered with an error. Its own logs will say why.",
  "bad-response": "Got a response that wasn't valid JSON — usually a reverse proxy or login page in the way.",
};

/** Same-box defaults — the common case for a home lab dashboard. */
const PORT_HINTS: Record<string, string> = {
  plex: "http://127.0.0.1:32400",
  tautulli: "http://127.0.0.1:8181",
  sonarr: "http://127.0.0.1:8989",
  radarr: "http://127.0.0.1:7878",
  bazarr: "http://127.0.0.1:6767",
  glances: "http://127.0.0.1:61208",
};

const KEY_HINTS: Record<string, string> = {
  plex: "Plex token: open any library item → ⋮ → Get Info → View XML, and copy X-Plex-Token from the URL.",
  tautulli: "Tautulli → Settings → Web Interface → API key.",
  sonarr: "Sonarr → Settings → General → API Key.",
  radarr: "Radarr → Settings → General → API Key.",
  bazarr: "Bazarr → Settings → General → API Key.",
  glances: "No key needed — Glances just needs to be running with its web server enabled (-w).",
};

function levelFor(probe: ProbeResult): StatusLevel {
  if (!probe.configured) return "unknown";
  return probe.ok ? "good" : "critical";
}

function ServiceCard({ probe }: { probe: ProbeResult }) {
  const level = levelFor(probe);

  return (
    <Panel span="md">
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">{probe.label}</h2>
            {probe.version ? (
              <p className="metric mt-0.5 text-xs text-ink-muted">
                {probe.version}
                {probe.detail ? ` · ${probe.detail}` : ""}
              </p>
            ) : null}
          </div>
          <StatusBadge
            level={level}
            label={!probe.configured ? "Not set up" : probe.ok ? "Connected" : "Failed"}
          />
        </div>

        {probe.ok ? (
          <p className="metric text-xs text-ink-faint">
            Responded in {probe.durationMs} ms
          </p>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3">
            {probe.detail ? (
              <p className="text-xs leading-relaxed text-ink-secondary">{probe.detail}</p>
            ) : null}
            {probe.kind && REMEDIATION[probe.kind] ? (
              <p className="text-xs leading-relaxed text-ink-muted">{REMEDIATION[probe.kind]}</p>
            ) : null}
            {!probe.configured ? (
              <p className="text-xs leading-relaxed text-ink-muted">{KEY_HINTS[probe.id]}</p>
            ) : null}
          </div>
        )}

        <div className="flex flex-col gap-1.5 border-t border-[var(--glass-border)] pt-2.5">
          {/* The URL the server actually resolved — not an example. If this
              isn't what you put in .env.local, the process is reading a
              different file than you edited, which is by far the most common
              cause of "configured but failing". */}
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-medium tracking-wide text-ink-faint uppercase">
              Tried
            </span>
            <code className="metric truncate text-[11px] text-ink-secondary">
              {probe.baseUrl ?? "— nothing configured —"}
            </code>
          </div>
          <code className="metric text-[10px] text-ink-faint">
            {probe.envVars.join(" · ")}
            {probe.baseUrl ? "" : ` — example: ${PORT_HINTS[probe.id]}`}
          </code>
        </div>
      </div>
    </Panel>
  );
}

export default async function SetupPage() {
  const probes = await probeAllServices();
  const connected = probes.filter((probe) => probe.ok).length;
  const configured = probes.filter((probe) => probe.configured).length;

  return (
    <>
      <PageHeader
        title="Setup"
        description={`${connected} of ${configured} configured ${
          configured === 1 ? "service" : "services"
        } responding.`}
        action={
          <a
            href="/setup"
            className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <RefreshCw size={14} aria-hidden />
            Re-test
          </a>
        }
      />

      {configured === 0 ? (
        <div className="glass mb-4 p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-ink">Nothing connected yet</h2>
          <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink-muted">
            Create a file called{" "}
            <code className="metric rounded bg-surface-2 px-1.5 py-0.5 text-xs">.env.local</code> in
            the project root and add the URL and API key for each service — the exact variable names
            are listed on each card below. Copy{" "}
            <code className="metric rounded bg-surface-2 px-1.5 py-0.5 text-xs">.env.example</code>{" "}
            to start. Restart the dev server after editing it, then re-test.
          </p>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-muted">
            You don&apos;t need all six. Add one and the dashboard starts working — everything else
            shows as not connected until you get to it.
          </p>
        </div>
      ) : null}

      <BentoGrid>
        {probes.map((probe) => (
          <ServiceCard key={probe.id} probe={probe} />
        ))}
      </BentoGrid>
    </>
  );
}
