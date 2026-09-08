"use client";

import { ShieldCheck } from "lucide-react";
import { useSlot } from "@/components/DashboardProvider";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/Status";

/**
 * Active health warnings from every service, merged into one list.
 *
 * This tile shrinks to a small "all clear" card when there's nothing wrong
 * and expands when there is — the whole point of a warnings panel is that it
 * should be invisible until it isn't.
 */
export function HealthWarnings() {
  const slot = useSlot("services");
  const services = slot.data?.services ?? [];

  const issues = services.flatMap((service) =>
    service.issues.map((issue) => ({ ...issue, service: service.label })),
  );

  const unreachable = services.filter(
    (service) => service.configured && !service.reachable,
  );

  const total = issues.length + unreachable.length;

  return (
    <Panel span={total > 0 ? "lg" : "sm"}>
      <PanelHeader title="Health" meta={total > 0 ? `${total}` : undefined} />
      <PanelBody>
        {total === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-4 text-center">
            <ShieldCheck size={20} style={{ color: "var(--status-good)" }} aria-hidden />
            <p className="text-sm font-medium text-ink">All clear</p>
            <p className="text-xs text-ink-faint">No warnings reported.</p>
          </div>
        ) : (
          // A fresh Sonarr with no indexers configured reports a dozen
          // warnings; at full height that tile alone was taller than the rest
          // of the page. Scrolls past six or so instead of dictating layout.
          <ul className="flex max-h-[19rem] flex-col gap-2 overflow-y-auto pr-1">
            {unreachable.map((service) => (
              <li
                key={`down-${service.id}`}
                className="flex items-start gap-2.5 rounded-lg bg-surface-2 p-2.5"
              >
                <StatusBadge level="critical" label="Down" compact />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-ink">{service.label} is unreachable</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">
                    {service.error}
                  </p>
                </div>
              </li>
            ))}
            {issues.map((issue, index) => (
              <li
                key={`${issue.service}-${index}`}
                className="flex items-start gap-2.5 rounded-lg bg-surface-2 p-2.5"
              >
                <StatusBadge
                  level={issue.level === "critical" ? "critical" : "warning"}
                  label={issue.service}
                  compact
                />
                <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-ink-secondary">
                  {issue.message}
                </p>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}
