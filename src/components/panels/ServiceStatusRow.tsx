"use client";

import { useSlot } from "@/components/DashboardProvider";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { StatusBadge, type StatusLevel } from "@/components/ui/Status";
import type { ServiceHealthView } from "@/lib/types";

/**
 * One row of every service's state.
 *
 * The "is everything fine" answer. Each entry shows an icon, a name and a
 * word — a green dot alone would fail anyone who can't distinguish it from
 * the amber one.
 */

function levelFor(service: ServiceHealthView): StatusLevel {
  if (!service.configured) return "unknown";
  if (!service.reachable) return "critical";
  if (service.issues.some((issue) => issue.level === "critical")) return "critical";
  if (service.issues.length > 0) return "warning";
  return "good";
}

function labelFor(service: ServiceHealthView, level: StatusLevel): string {
  if (!service.configured) return "Not set up";
  if (!service.reachable) return "Down";
  if (level === "warning" || level === "critical") {
    return `${service.issues.length} issue${service.issues.length === 1 ? "" : "s"}`;
  }
  return "OK";
}

export function ServiceStatusRow() {
  const slot = useSlot("services");
  const services = slot.data?.services ?? [];

  const problems = services.filter(
    (service) => service.configured && (!service.reachable || service.issues.length > 0),
  ).length;

  return (
    <Panel span="full">
      <PanelHeader
        title="Services"
        meta={problems > 0 ? `${problems} need attention` : "all healthy"}
      />
      <PanelBody>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {services.map((service) => {
            const level = levelFor(service);
            return (
              <div
                key={service.id}
                className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-ink">{service.label}</span>
                </div>
                <StatusBadge level={level} label={labelFor(service, level)} compact />
                <div className="metric flex items-baseline gap-1.5 text-[10px] text-ink-faint">
                  {service.version ? <span className="truncate">{service.version}</span> : null}
                  {service.responseMs !== null && service.reachable ? (
                    <span className="ml-auto shrink-0">{service.responseMs}ms</span>
                  ) : null}
                </div>
                {/* Push vs poll, stated per service — the real-time claim is
                    verifiable rather than assumed. */}
                {service.configured && service.reachable ? (
                  <span
                    className="text-[10px] font-medium"
                    style={{
                      color:
                        service.mode === "push" ? "var(--status-good)" : "var(--text-faint)",
                    }}
                  >
                    {service.mode === "push" ? "push · live" : "polling"}
                  </span>
                ) : null}
              </div>
            );
          })}
          {services.length === 0
            ? Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="skeleton h-[104px]" />
              ))
            : null}
        </div>
      </PanelBody>
    </Panel>
  );
}
