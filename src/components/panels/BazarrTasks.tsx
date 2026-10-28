"use client";

import { useCallback, useEffect, useState } from "react";
import { Captions, RefreshCw } from "lucide-react";
import { ActionButton } from "@/components/ui/ActionButton";
import { NotConfigured, Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { InfoNote } from "@/components/ui/Status";
import { BAZARR_TASKS } from "@/lib/bazarr-tasks";

/**
 * Bazarr's own scheduled jobs, runnable now.
 *
 * Bazarr polls Sonarr and Radarr on an hour's timer, which is fine until the
 * moment you've just added something and want it picked up. Everything here
 * is a job Bazarr already runs on its own — pressing one only changes WHEN,
 * never what.
 *
 * The schedule is shown next to each button because "did that do anything?"
 * is otherwise unanswerable: the jobs are queued rather than awaited, so the
 * only visible proof is the next run time moving.
 */

interface TaskRow {
  name: string;
  job_id: string;
  interval: string;
  next_run_in?: string;
  next_run_time?: string;
  job_running?: boolean;
}

export function BazarrTasks() {
  const [rows, setRows] = useState<TaskRow[] | null>(null);
  const [configured, setConfigured] = useState(true);

  const load = useCallback(() => {
    fetch("/api/bazarr-tasks")
      .then((response) => response.json())
      .then((payload: { ok: boolean; tasks?: TaskRow[] }) => {
        if (!payload.ok) {
          setConfigured(false);
          return;
        }
        setRows(payload.tasks ?? []);
      })
      .catch(() => {});
  }, []);

  useEffect(load, [load]);

  if (!configured) {
    return (
      <Panel span="md">
        <PanelHeader title="Subtitle tasks" icon={<Captions size={13} />} />
        <PanelBody>
          <NotConfigured
            service="Bazarr"
            hint="Set BAZARR_URL and BAZARR_API_KEY to run its tasks from here."
          />
        </PanelBody>
      </Panel>
    );
  }

  const scheduleFor = (id: string) => {
    const row = rows?.find((entry) => entry.job_id === id);
    if (!row) return null;
    const next = row.next_run_in ?? row.next_run_time;
    if (row.job_running) return "running now";
    // "Never" is Bazarr's own word for a job with no interval, and it is the
    // single most useful thing this panel can tell you.
    return next && next !== "Never" ? `next ${next}` : "never runs on its own";
  };

  const unscheduled = BAZARR_TASKS.filter(
    (task) => scheduleFor(task.id) === "never runs on its own",
  );

  return (
    <Panel span="md">
      <PanelHeader
        title="Subtitle tasks"
        icon={<Captions size={13} />}
        meta={rows ? `${rows.length}` : undefined}
        action={
          <button
            type="button"
            onClick={load}
            aria-label="Refresh task schedule"
            className="grid size-7 place-items-center rounded-md text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink-secondary"
          >
            <RefreshCw size={11} aria-hidden />
          </button>
        }
      />
      <PanelBody className="flex flex-col gap-2">
        {unscheduled.length > 0 ? (
          <InfoNote>
            {unscheduled.map((task) => task.label).join(" and ")}{" "}
            {unscheduled.length === 1 ? "has" : "have"} no schedule in Bazarr, so{" "}
            {unscheduled.length === 1 ? "it only runs" : "they only run"} when you press
            the button.
          </InfoNote>
        ) : null}

        <ul className="flex flex-col gap-1.5">
          {BAZARR_TASKS.map((task) => {
            const schedule = scheduleFor(task.id);
            return (
              <li
                key={task.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-ink">{task.label}</p>
                  <p className="metric mt-0.5 truncate text-[10px] text-ink-faint">
                    {schedule ?? task.hint}
                  </p>
                </div>
                <ActionButton
                  action="bazarr.runTask"
                  params={{ task: task.id }}
                  label="Run"
                  size="xs"
                  onDone={() => setTimeout(load, 1500)}
                />
              </li>
            );
          })}
        </ul>
      </PanelBody>
    </Panel>
  );
}
