"use client";

import { useCallback, useEffect, useState } from "react";
import { FolderSync, Play } from "lucide-react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { InfoNote, StatusBadge } from "@/components/ui/Status";
import { formatRelativeTime } from "@/lib/format";

/**
 * The gap filler, made visible.
 *
 * This panel exists because the job was invisible: it ran on a timer, wrote
 * to a log nobody reads, and the only way to learn whether it had acted was
 * to open a terminal. An automation you cannot observe is one you cannot
 * trust, and one you cannot trust gets turned off.
 *
 * So it shows three things in order of what you'd actually ask: is it allowed
 * to write, when did it last run, and what did it decide. The skipped list is
 * not an error log — those are the folders it refused to guess at, and each
 * one is a decision worth reading.
 */

interface GapRun {
  at: number;
  service: "sonarr" | "radarr";
  imported: { folder: string; title: string }[];
  skipped: { folder: string; reason: string }[];
  failed: { folder: string; reason: string }[];
  dryRun: boolean;
}

interface Payload {
  applying: boolean;
  lastRunAt: number | null;
  nextDueAt: number | null;
  runs: GapRun[];
}

export function LibraryAutomation() {
  const [data, setData] = useState<Payload | null>(null);

  const load = useCallback(() => {
    fetch("/api/library-gaps")
      .then((response) => response.json())
      .then((payload: Payload) => setData(payload))
      .catch(() => {});
  }, []);

  useEffect(load, [load]);

  const imported = data?.runs.reduce((sum, run) => sum + run.imported.length, 0) ?? 0;
  const skipped = data?.runs.reduce((sum, run) => sum + run.skipped.length, 0) ?? 0;
  const failed = data?.runs.reduce((sum, run) => sum + run.failed.length, 0) ?? 0;
  const applying = data?.applying ?? false;

  return (
    <Panel span="md">
      <PanelHeader
        title="Library gaps"
        icon={<FolderSync size={13} />}
        meta={data?.lastRunAt ? formatRelativeTime(data.lastRunAt) : "never run"}
        action={
          <ActionButton
            action="library.fillGaps"
            label="Run now"
            size="xs"
            icon={<Play size={10} aria-hidden />}
            onDone={() => setTimeout(load, 2500)}
          />
        }
      />
      <PanelBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            level={applying ? "good" : "unknown"}
            label={applying ? "Importing" : "Preview only"}
            compact
          />
          {failed > 0 ? (
            <StatusBadge level="serious" label={`${failed} failed`} compact />
          ) : null}
          <span className="metric text-[11px] text-ink-faint">
            {applying ? `${imported} imported` : `${imported} would import`} · {skipped} skipped
          </span>
        </div>

        {!applying ? (
          <InfoNote>
            Reporting only — nothing is written to Sonarr or Radarr until
            <code className="metric"> IMPORT_FILL_GAPS=1</code>. Runs daily either way.
          </InfoNote>
        ) : null}

        {data === null ? <div className="skeleton h-20 w-full" /> : null}

        {data?.runs.map((run) => (
          <div key={`${run.service}-${run.at}`} className="flex flex-col gap-1.5">
            <p className="label-muted capitalize">
              {run.service} · {run.imported.length} in, {run.skipped.length} skipped
            </p>

            {run.imported.length > 0 ? (
              <ul className="flex flex-col gap-0.5">
                {run.imported.slice(0, 4).map((row) => (
                  <li key={row.folder} className="truncate text-[11px] text-ink-secondary">
                    + {row.title}
                  </li>
                ))}
                {run.imported.length > 4 ? (
                  <li className="text-[11px] text-ink-faint">
                    and {run.imported.length - 4} more
                  </li>
                ) : null}
              </ul>
            ) : null}

            {/* The refusals, with their reasons — the part worth reading. */}
            {run.skipped.map((row) => (
              <div key={row.folder} className="rounded-lg bg-surface-2 px-2.5 py-1.5">
                <p className="truncate text-[11px] font-medium text-ink-secondary">{row.folder}</p>
                <p className="mt-0.5 text-[10px] leading-snug text-ink-faint">{row.reason}</p>
              </div>
            ))}

            {run.failed.map((row) => (
              <div
                key={row.folder}
                className="rounded-lg px-2.5 py-1.5"
                style={{ background: "var(--status-serious-dim)" }}
              >
                <p className="truncate text-[11px] font-medium text-ink-secondary">{row.folder}</p>
                <p
                  className="mt-0.5 text-[10px] leading-snug"
                  style={{ color: "var(--status-serious)" }}
                >
                  {row.reason}
                </p>
              </div>
            ))}
          </div>
        ))}

        {data !== null && data.runs.length === 0 ? (
          <p className="text-xs text-ink-muted">
            Hasn&apos;t run yet. It checks daily, or press Run now.
          </p>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
