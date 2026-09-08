"use client";

import { Activity, Cpu, HardDriveDownload, Languages, Thermometer } from "lucide-react";
import { useSlot } from "@/components/DashboardProvider";
import { Freshness } from "@/components/shell/ConnectionIndicator";
import { NotConfigured, Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { StatusBadge, StatusDot } from "@/components/ui/Status";
import { formatBytes, formatNumber } from "@/lib/format";
import { HealthWarnings } from "./HealthWarnings";
import { QueuePanel } from "./QueuePanel";
import { ServiceStatusRow } from "./ServiceStatusRow";

/** Bytes/sec → human rate. Network and disk I/O both use it. */
function rate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

/**
 * Per-core CPU.
 *
 * Small multiples rather than 12 series on one chart — twelve lines would
 * need twelve colors, which no categorical palette can separate safely.
 */
function CoreGrid({ cores }: { cores: number[] }) {
  if (cores.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="label-muted">Per core</p>
      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8 xl:grid-cols-12">
        {cores.map((value, index) => {
          const clamped = Math.min(Math.max(value, 0), 100);
          return (
            <div key={index} className="flex flex-col items-center gap-1">
              <div
                className="relative h-12 w-full overflow-hidden rounded bg-surface-3"
                role="meter"
                aria-valuenow={Math.round(clamped)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Core ${index} usage`}
                title={`Core ${index}: ${clamped.toFixed(0)}%`}
              >
                <div
                  className="absolute inset-x-0 bottom-0 rounded-t transition-[height] duration-700 ease-out"
                  style={{
                    height: `${Math.max(clamped, 2)}%`,
                    background:
                      clamped >= 90
                        ? "var(--status-critical)"
                        : clamped >= 70
                          ? "var(--status-warning)"
                          : "var(--meter-fill)",
                  }}
                />
              </div>
              <span className="metric text-[9px] text-ink-faint">{index}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MachinePanels() {
  const slot = useSlot("machine");
  const machine = slot.data;

  if (slot.status === "not-configured") {
    return (
      <Panel span="full">
        <PanelHeader title="Machine" />
        <PanelBody>
          <NotConfigured
            service="Glances"
            hint="Run the Glances container on your server (see the README) to get CPU, memory, temperatures and disk I/O."
          />
        </PanelBody>
      </Panel>
    );
  }

  if (!machine) {
    return (
      <Panel span="full">
        <PanelBody>
          <div className="skeleton h-48 w-full" />
        </PanelBody>
      </Panel>
    );
  }

  return (
    <>
      <Panel span="xl" live>
        <PanelHeader
          title="Processor"
          icon={<Cpu size={13} />}
          meta={machine.hostname ?? undefined}
          action={<Freshness fetchedAt={slot.fetchedAt} mode={slot.mode} />}
        />
        <PanelBody className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[
              { label: "Total", value: `${machine.cpu.total.toFixed(1)}%` },
              { label: "User", value: `${machine.cpu.user.toFixed(1)}%` },
              { label: "System", value: `${machine.cpu.system.toFixed(1)}%` },
              {
                label: "I/O wait",
                value: machine.cpu.iowait !== null ? `${machine.cpu.iowait.toFixed(1)}%` : "—",
              },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg bg-surface-2 p-3">
                <p className="label-muted">{stat.label}</p>
                <p className="metric mt-1 text-xl font-semibold text-ink">{stat.value}</p>
              </div>
            ))}
          </div>

          <CoreGrid cores={machine.perCore} />

          {machine.load ? (
            <div className="flex flex-wrap items-center gap-4 border-t border-[var(--glass-border)] pt-3">
              <span className="label-muted">Load average</span>
              <span className="metric text-sm text-ink">
                {machine.load.min1.toFixed(2)}
                <span className="text-ink-faint"> 1m</span>
              </span>
              <span className="metric text-sm text-ink">
                {machine.load.min5.toFixed(2)}
                <span className="text-ink-faint"> 5m</span>
              </span>
              <span className="metric text-sm text-ink">
                {machine.load.min15.toFixed(2)}
                <span className="text-ink-faint"> 15m</span>
              </span>
              {machine.load.cores ? (
                <span className="metric text-[11px] text-ink-faint">
                  across {machine.load.cores} cores
                </span>
              ) : null}
            </div>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel span="md">
        <PanelHeader title="Memory" />
        <PanelBody className="flex flex-col gap-3">
          {machine.memory ? (
            <>
              <div>
                <p className="metric text-3xl leading-none font-semibold text-ink">
                  {machine.memory.percent.toFixed(0)}%
                </p>
                <p className="metric mt-1.5 text-[11px] text-ink-faint">
                  {formatBytes(machine.memory.used)} of {formatBytes(machine.memory.total)}
                </p>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full transition-[width] duration-700"
                  style={{
                    width: `${machine.memory.percent}%`,
                    background:
                      machine.memory.percent >= 90
                        ? "var(--status-critical)"
                        : machine.memory.percent >= 80
                          ? "var(--status-warning)"
                          : "var(--meter-fill)",
                  }}
                />
              </div>
              {machine.swap && machine.swap.total > 0 ? (
                <div className="border-t border-[var(--glass-border)] pt-2.5">
                  <div className="flex items-baseline justify-between">
                    <span className="label-muted">Swap</span>
                    <span className="metric text-xs text-ink-secondary">
                      {formatBytes(machine.swap.used)} / {formatBytes(machine.swap.total)}
                    </span>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-ink-muted">No memory data.</p>
          )}
        </PanelBody>
      </Panel>

      <Panel span="md">
        <PanelHeader title="Temperatures" icon={<Thermometer size={13} />} />
        <PanelBody>
          {machine.sensors.length === 0 ? (
            <p className="py-4 text-xs leading-relaxed text-ink-faint">
              No sensors reported. Common in VMs and containers — Glances needs host access to
              read them.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {machine.sensors.map((sensor) => {
                const critical = sensor.critical ?? 90;
                const fraction = sensor.value / critical;
                return (
                  <li key={sensor.label} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-secondary">
                      {sensor.label}
                    </span>
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(fraction * 100, 100)}%`,
                          background:
                            fraction >= 0.9
                              ? "var(--status-critical)"
                              : fraction >= 0.75
                                ? "var(--status-warning)"
                                : "var(--meter-fill)",
                        }}
                      />
                    </div>
                    <span className="metric w-12 shrink-0 text-right text-xs font-medium text-ink">
                      {sensor.value.toFixed(0)}°{sensor.unit}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </PanelBody>
      </Panel>

      <Panel span="md">
        <PanelHeader title="Network" icon={<Activity size={13} />} />
        <PanelBody>
          {machine.network.length === 0 ? (
            <p className="py-4 text-xs text-ink-faint">No interfaces reported.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {machine.network.map((iface) => (
                <li key={iface.name} className="rounded-lg bg-surface-2 p-2.5">
                  <p className="metric text-xs font-medium text-ink">{iface.name}</p>
                  <div className="mt-1.5 flex gap-4">
                    <span className="metric text-[11px] text-ink-secondary">
                      <span className="text-ink-faint">↓ </span>
                      {rate(iface.rxBytesPerSec)}
                    </span>
                    <span className="metric text-[11px] text-ink-secondary">
                      <span className="text-ink-faint">↑ </span>
                      {rate(iface.txBytesPerSec)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PanelBody>
      </Panel>

      <Panel span="md">
        <PanelHeader title="Disk I/O" icon={<HardDriveDownload size={13} />} />
        <PanelBody>
          {machine.diskIO.length === 0 ? (
            <p className="py-4 text-xs text-ink-faint">No disk activity reported.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {machine.diskIO.map((disk) => (
                <li key={disk.name} className="flex items-center gap-3">
                  <span className="metric w-16 shrink-0 truncate text-xs text-ink-secondary">
                    {disk.name}
                  </span>
                  <span className="metric flex-1 text-right text-[11px] text-ink-muted">
                    <span className="text-ink-faint">R </span>
                    {rate(disk.readBytesPerSec)}
                  </span>
                  <span className="metric flex-1 text-right text-[11px] text-ink-muted">
                    <span className="text-ink-faint">W </span>
                    {rate(disk.writeBytesPerSec)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PanelBody>
      </Panel>

      <Panel span="md">
        <PanelHeader title="Top processes" meta="by CPU" />
        <PanelBody>
          <ul className="flex flex-col gap-1.5">
            {machine.topProcesses.map((process) => (
              <li key={process.pid} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-ink-secondary">{process.name}</span>
                <span className="metric shrink-0 text-[11px] text-ink-faint">
                  {process.memory.toFixed(1)}% mem
                </span>
                <span className="metric w-14 shrink-0 text-right font-medium text-ink">
                  {process.cpu.toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        </PanelBody>
      </Panel>
    </>
  );
}

function SubtitlePanel() {
  const slot = useSlot("subtitles");
  const subtitles = slot.data;

  return (
    <Panel span="md">
      <PanelHeader title="Subtitles" icon={<Languages size={13} />} meta="Bazarr" />
      <PanelBody className="flex flex-col gap-3">
        {slot.status === "not-configured" ? (
          <NotConfigured service="Bazarr" hint="Connect Bazarr to see subtitle coverage." />
        ) : !subtitles ? (
          <div className="skeleton h-24 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-lg bg-surface-2 p-3">
                <p className="label-muted">Episodes wanted</p>
                <p className="metric mt-1 text-xl font-semibold text-ink">
                  {formatNumber(subtitles.wantedEpisodes)}
                </p>
              </div>
              <div className="rounded-lg bg-surface-2 p-3">
                <p className="label-muted">Movies wanted</p>
                <p className="metric mt-1 text-xl font-semibold text-ink">
                  {formatNumber(subtitles.wantedMovies)}
                </p>
              </div>
            </div>

            {subtitles.providers.length > 0 ? (
              <div className="border-t border-[var(--glass-border)] pt-2.5">
                <p className="label-muted mb-2">Providers</p>
                <ul className="flex flex-col gap-1.5">
                  {subtitles.providers.map((provider) => (
                    <li key={provider.name} className="flex items-center justify-between gap-2">
                      <StatusDot
                        level={provider.healthy ? "good" : "warning"}
                        label={provider.name}
                      />
                      {!provider.healthy ? (
                        <StatusBadge level="warning" label={provider.status} compact />
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

export function HealthView() {
  return (
    <>
      <ServiceStatusRow />
      <HealthWarnings />
      <MachinePanels />
      <QueuePanel limit={10} />
      <SubtitlePanel />
    </>
  );
}
