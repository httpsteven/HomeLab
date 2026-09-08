"use client";

import { Cpu, MemoryStick, Thermometer } from "lucide-react";
import { useSlot } from "@/components/DashboardProvider";
import { Freshness } from "@/components/shell/ConnectionIndicator";
import { NotConfigured, Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { formatBytes } from "@/lib/format";

/**
 * Machine health at a glance.
 *
 * Three gauges rather than a chart: each is a single current value with no
 * shape over time, which is a stat tile's job. The time series lives on the
 * Health page where there's room for it.
 */

function Gauge({
  label,
  percent,
  detail,
  icon,
  /** Overrides the headline text when a percentage isn't the real unit. */
  display,
}: {
  label: string;
  percent: number;
  detail: string;
  icon: React.ReactNode;
  display?: string;
}) {
  const clamped = Math.min(Math.max(percent, 0), 100);
  // Load color is a status judgement, so it uses the reserved status ramp —
  // and the number is always present, so color is never carrying it alone.
  const color =
    clamped >= 90
      ? "var(--status-critical)"
      : clamped >= 75
        ? "var(--status-warning)"
        : "var(--meter-fill)";

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3">
      <div className="flex items-center gap-1.5">
        <span className="text-ink-faint" aria-hidden>
          {icon}
        </span>
        <span className="label-muted">{label}</span>
        <span className="metric ml-auto text-sm font-semibold text-ink">
          {display ?? `${clamped.toFixed(0)}%`}
        </span>
      </div>
      <div
        className="relative h-1.5 overflow-hidden rounded-full bg-surface-3"
        role="meter"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${Math.max(clamped, 1)}%`, background: color }}
        />
      </div>
      <p className="metric text-[10px] text-ink-faint">{detail}</p>
    </div>
  );
}

export function MachineSummary() {
  const slot = useSlot("machine");
  const machine = slot.data;

  const hottest = machine?.sensors
    .filter((sensor) => sensor.unit === "C")
    .sort((a, b) => b.value - a.value)[0];

  const memoryPercent = machine?.memory?.percent ?? 0;

  return (
    <Panel span="md">
      <PanelHeader
        title="Server"
        meta={machine?.hostname ?? undefined}
        action={<Freshness fetchedAt={slot.fetchedAt} mode={slot.mode} />}
      />
      <PanelBody>
        {slot.status === "not-configured" ? (
          <NotConfigured
            service="Glances"
            hint="Run the Glances container on your server to see CPU, memory and temperatures."
          />
        ) : !machine ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="skeleton h-[74px]" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Gauge
              label="CPU"
              percent={machine.cpu.total}
              detail={
                machine.load
                  ? `load ${machine.load.min1.toFixed(2)} · ${machine.load.min5.toFixed(2)} · ${machine.load.min15.toFixed(2)}`
                  : `${machine.perCore.length} cores`
              }
              icon={<Cpu size={12} />}
            />
            <Gauge
              label="Memory"
              percent={memoryPercent}
              detail={
                machine.memory
                  ? `${formatBytes(machine.memory.used)} of ${formatBytes(machine.memory.total)}`
                  : "—"
              }
              icon={<MemoryStick size={12} />}
            />
            {hottest ? (
              <Gauge
                label="Temperature"
                // The bar is scaled against the sensor's own critical point,
                // but the headline stays in °C — a percentage of a thermal
                // limit is not a number anyone thinks in.
                percent={(hottest.value / (hottest.critical ?? 90)) * 100}
                display={`${hottest.value.toFixed(0)}°C`}
                detail={`${hottest.label} · limit ${hottest.critical ?? 90}°C`}
                icon={<Thermometer size={12} />}
              />
            ) : (
              <div className="rounded-lg bg-surface-2 p-3">
                <p className="text-[11px] text-ink-faint">
                  No temperature sensors reported — common in VMs and containers.
                </p>
              </div>
            )}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
