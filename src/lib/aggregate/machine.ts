import "server-only";
import { glances } from "@/lib/clients/glances";
import type { MachineState } from "@/lib/types";

/**
 * Machine metrics from Glances.
 *
 * Every sub-call is independent and optional — `sensors` in particular is
 * absent in a lot of VM and container setups, and `percpu` varies by
 * platform. A missing section renders as absent, never as an error.
 */

export async function buildMachineState(): Promise<MachineState> {
  const [cpu, mem, swap, load, sensors, network, diskio, uptime, system, percpu, processes] =
    await Promise.all([
      glances.cpu(),
      glances.mem(),
      glances.swap(),
      glances.load(),
      glances.sensors(),
      glances.network(),
      glances.diskio(),
      glances.uptime(),
      glances.system(),
      glances.percpu(),
      glances.processList(),
    ]);

  return {
    hostname: system.ok ? (system.data?.hostname ?? null) : null,
    os: system.ok
      ? [system.data?.os_name, system.data?.os_version].filter(Boolean).join(" ") || null
      : null,
    uptime: uptime.ok ? (typeof uptime.data === "string" ? uptime.data : null) : null,

    cpu: cpu.ok
      ? {
          total: cpu.data?.total ?? 0,
          user: cpu.data?.user ?? 0,
          system: cpu.data?.system ?? 0,
          iowait: cpu.data?.iowait ?? null,
        }
      : { total: 0, user: 0, system: 0, iowait: null },

    perCore:
      percpu.ok && Array.isArray(percpu.data)
        ? percpu.data.map((core) => core.total ?? 0)
        : [],

    load: load.ok && load.data
      ? {
          min1: load.data.min1,
          min5: load.data.min5,
          min15: load.data.min15,
          cores: load.data.cpucore ?? null,
        }
      : null,

    memory: mem.ok && mem.data
      ? {
          total: mem.data.total,
          used: mem.data.used,
          free: mem.data.free,
          percent: mem.data.percent,
        }
      : null,

    swap: swap.ok && swap.data
      ? { total: swap.data.total, used: swap.data.used, percent: swap.data.percent }
      : null,

    sensors:
      sensors.ok && Array.isArray(sensors.data)
        ? sensors.data
            // Temperature and fan readings only; Glances also returns battery
            // and voltage rows that are noise on a server.
            .filter((sensor) => sensor.unit === "C" || sensor.unit === "R")
            .map((sensor) => ({
              label: sensor.label,
              value: sensor.value,
              unit: sensor.unit,
              critical: sensor.critical ?? null,
            }))
        : [],

    network:
      network.ok && Array.isArray(network.data)
        ? network.data
            .filter((iface) => iface.interface_name !== "lo" && !iface.interface_name.startsWith("veth"))
            .map((iface) => ({
              name: iface.interface_name,
              rxBytesPerSec: iface.bytes_recv_rate_per_sec ?? 0,
              txBytesPerSec: iface.bytes_sent_rate_per_sec ?? 0,
            }))
            .sort((a, b) => b.rxBytesPerSec + b.txBytesPerSec - (a.rxBytesPerSec + a.txBytesPerSec))
            .slice(0, 4)
        : [],

    diskIO:
      diskio.ok && Array.isArray(diskio.data)
        ? diskio.data
            .map((disk) => ({
              name: disk.disk_name,
              readBytesPerSec: disk.read_bytes_rate_per_sec ?? 0,
              writeBytesPerSec: disk.write_bytes_rate_per_sec ?? 0,
            }))
            .sort(
              (a, b) =>
                b.readBytesPerSec + b.writeBytesPerSec - (a.readBytesPerSec + a.writeBytesPerSec),
            )
            .slice(0, 6)
        : [],

    topProcesses:
      processes.ok && Array.isArray(processes.data)
        ? processes.data
            .slice()
            .sort((a, b) => (b.cpu_percent ?? 0) - (a.cpu_percent ?? 0))
            .slice(0, 6)
            .map((process) => ({
              name: process.name,
              cpu: process.cpu_percent ?? 0,
              memory: process.memory_percent ?? 0,
              pid: process.pid,
            }))
        : [],
  };
}
