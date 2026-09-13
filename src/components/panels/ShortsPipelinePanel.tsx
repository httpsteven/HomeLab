"use client";

import { useState } from "react";
import { CheckCircle2, CircleDashed, Loader2, Terminal, XCircle } from "lucide-react";
import { useSlot } from "@/components/DashboardProvider";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { InfoNote } from "@/components/ui/Status";
import { cn } from "@/lib/cn";
import { formatNumber, formatRelativeTime } from "@/lib/format";
import type { ShortsJob } from "@/lib/types";

/**
 * Jobs, run history and test results.
 *
 * Queued work is deliberately visible even while the pipeline is paused: a
 * queue that does nothing for an hour because someone is watching a film is
 * correct behaviour, but indistinguishable from a broken worker unless the UI
 * says which.
 */
export function ShortsPipelinePanel() {
  const slot = useSlot("shorts");
  const [note, setNote] = useState<string | null>(null);
  const [queueing, setQueueing] = useState(false);

  const data = slot.data;

  async function enqueue(type: string, payload: Record<string, unknown>) {
    setQueueing(true);
    try {
      const response = await fetch("/api/shorts/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, payload }),
      });
      const body = await response.json();
      setNote(
        body.error
          ? `Couldn't queue: ${body.error}`
          : data?.worker.paused
            ? `Queued. It will start once the lab is quiet (${data.worker.reason}).`
            : "Queued.",
      );
    } catch {
      setNote("Couldn't reach the queue.");
    } finally {
      setQueueing(false);
    }
  }

  return (
    <>
      <Panel span="lg">
        <PanelHeader
          title="Pipeline"
          meta={data ? `${formatNumber(data.totals.clips)} clips` : undefined}
          icon={<Terminal size={14} aria-hidden />}
        />
        <PanelBody className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <QueueButton
              label="Re-audit library"
              hint="Extract and validate every subtitle track"
              disabled={queueing}
              onClick={() => enqueue("audit", { deep: true })}
            />
            <QueueButton
              label="Render pending"
              hint="Produce shorts for anything with quotes and a transcript"
              disabled={queueing}
              onClick={() => enqueue("render", {})}
            />
          </div>

          {note ? <InfoNote>{note}</InfoNote> : null}

          {data && data.jobs.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {data.jobs.slice(0, 8).map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
            </ul>
          ) : (
            <p className="py-4 text-center text-sm text-ink-muted">No jobs yet.</p>
          )}
        </PanelBody>
      </Panel>

      <Panel span="md">
        <PanelHeader title="Recent runs" icon={<Terminal size={14} aria-hidden />} />
        <PanelBody>
          {data && data.runs.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {data.runs.slice(0, 6).map((run) => (
                <li key={run.id} className="text-xs">
                  <div className="flex items-baseline gap-2">
                    <span className="metric truncate text-ink">{run.command}</span>
                    <span className="metric ml-auto shrink-0 text-[11px] text-ink-faint">
                      {formatRelativeTime(Date.parse(run.startedAt))}
                    </span>
                  </div>
                  <p className="text-[11px] text-ink-muted">
                    {run.produced} produced · {run.skipped} skipped of {run.itemsSeen}
                  </p>
                  {/* The reasons are the useful part: a run that produced
                      nothing should say why, not just report zero. */}
                  {run.reasons.length > 0 ? (
                    <p className="metric truncate text-[10px] text-ink-faint">
                      {run.reasons.map((r) => `${r.count} ${r.reason}`).join(" · ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-center text-sm text-ink-muted">No runs recorded.</p>
          )}
        </PanelBody>
      </Panel>

      <Panel span="sm">
        <PanelHeader title="Tests" icon={<CheckCircle2 size={14} aria-hidden />} />
        <PanelBody>
          {data && data.tests.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {data.tests.slice(0, 5).map((run) => (
                <li key={run.id} className="flex items-center gap-2 text-xs">
                  {run.failed === 0 ? (
                    <CheckCircle2 size={13} aria-hidden className="text-good" />
                  ) : (
                    <XCircle size={13} aria-hidden className="text-critical" />
                  )}
                  <span className="text-ink">{run.suite}</span>
                  <span className="metric ml-auto text-[11px] text-ink-faint">
                    {run.passed} passed
                    {run.failed > 0 ? `, ${run.failed} failed` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-center text-xs text-ink-muted">
              No test runs recorded yet.
            </p>
          )}
        </PanelBody>
      </Panel>
    </>
  );
}

function JobRow({ job }: { job: ShortsJob }) {
  const running = job.status === "running";
  const failed = job.status === "failed";

  return (
    <li className="flex items-center gap-2 text-xs">
      <span className="shrink-0">
        {running ? (
          <Loader2 size={13} aria-hidden className="animate-spin text-accent" />
        ) : failed ? (
          <XCircle size={13} aria-hidden className="text-critical" />
        ) : job.status === "queued" ? (
          <CircleDashed size={13} aria-hidden className="text-ink-faint" />
        ) : (
          <CheckCircle2 size={13} aria-hidden className="text-good" />
        )}
      </span>

      <span className="metric shrink-0 text-ink">{job.type}</span>

      <span className={cn("truncate text-[11px]", failed ? "text-critical" : "text-ink-muted")}>
        {job.error ?? job.detail ?? job.status}
      </span>

      {running ? (
        <span className="metric ml-auto shrink-0 text-[11px] text-ink-faint">
          {Math.round(job.progress * 100)}%
        </span>
      ) : (
        <span className="metric ml-auto shrink-0 text-[11px] text-ink-faint">
          {formatRelativeTime(Date.parse(job.finishedAt ?? job.createdAt))}
        </span>
      )}
    </li>
  );
}

function QueueButton({
  label,
  hint,
  onClick,
  disabled,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={cn(
        "rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-ink-secondary transition-colors",
        "hover:bg-surface-3 hover:text-ink",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {label}
    </button>
  );
}
