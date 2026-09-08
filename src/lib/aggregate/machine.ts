import "server-only";
import { glances, type GlancesAll } from "@/lib/clients/glances";
import type { MachineState } from "@/lib/types";

/**
 * Machine metrics from Glances.
 *
 * ONE request per poll, not one per panel. The earlier version fanned out to
 * eleven endpoints every two seconds — 330 requests/minute at a 2s cadence,
 * which slowed down both this dashboard and the machine it was measuring, and
 * meant a single unreachable host cost eleven simultaneous 10s timeouts.
 *
 * Throws when Glances is unreachable so the collector can back off, rather
 * than quietly returning an empty shell forever.
 */

export class MachineUnavailableError extends Error {}

function build(data: GlancesAll): MachineState {
  return {
    hostname: data.system?.hostname ?? null,
    os: [data.system?.os_name, data.system?.os_version].filter(Boolean).join(" ") || null,
    uptime: typeof data.uptime === "string" ? data.uptime : null,

    cpu: {
      total: data.cpu?.total ?? 0,
      user: data.cpu?.user ?? 0,
      system: data.cpu?.system ?? 0,
      iowait: data.cpu?.iowait ?? null,
    },

    perCore: Array.isArray(data.percpu) ? data.percpu.map((core) => core.total ?? 0) : [],

    load: data.load
      ? {
          min1: data.load.min1,
          min5: data.load.min5,
          min15: data.load.min15,
          cores: data.load.cpucore ?? null,
        }
      : null,

    memory: data.mem
      ? {
          total: data.mem.total,
          used: data.mem.used,
          free: data.mem.free,
          percent: data.mem.percent,
        }
      : null,

    swap: data.memswap
      ? { total: data.memswap.total, used: data.memswap.used, percent: data.memswap.percent }
      : null,

    sensors: Array.isArray(data.sensors)
      ? data.sensors
          // Temperature and fan readings only; Glances also reports battery
          // and voltage rows that are noise on a server.
          .filter((sensor) => sensor.unit === "C" || sensor.unit === "R")
          .map((sensor) => ({
            label: sensor.label,
            value: sensor.value,
            unit: sensor.unit,
            critical: sensor.critical ?? null,
          }))
      : [],

    network: Array.isArray(data.network)
      ? data.network
          .filter(
            (iface) =>
              iface.interface_name !== "lo" && !iface.interface_name.startsWith("veth"),
          )
          .map((iface) => ({
            name: iface.interface_name,
            rxBytesPerSec: iface.bytes_recv_rate_per_sec ?? 0,
            txBytesPerSec: iface.bytes_sent_rate_per_sec ?? 0,
          }))
          .sort(
            (a, b) => b.rxBytesPerSec + b.txBytesPerSec - (a.rxBytesPerSec + a.txBytesPerSec),
          )
          .slice(0, 4)
      : [],

    diskIO: Array.isArray(data.diskio)
      ? data.diskio
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

    topProcesses: Array.isArray(data.processlist)
      ? data.processlist
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

export async function buildMachineState(): Promise<MachineState> {
  const result = await glances.all();

  if (!result.ok) {
    throw new MachineUnavailableError(result.message);
  }

  return build(result.data ?? {});
}
