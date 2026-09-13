"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Captions, Upload, Wand2 } from "lucide-react";
import { useSlot } from "@/components/DashboardProvider";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { InfoNote } from "@/components/ui/Status";
import { StackedBar } from "@/components/ui/CapacityBar";
import { cn } from "@/lib/cn";
import { formatNumber, formatPercent } from "@/lib/format";
import type { SubtitleAuditRow } from "@/lib/types";

const SERIES_COLORS = [
  "var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)",
  "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)",
];

/**
 * "Do I have subtitles?", for the whole library.
 *
 * The reason codes are the point. "Skipped" is undiagnosable; "only image-based
 * subtitles" tells you the item needs OCR or transcription, and
 * "LOW_COVERAGE_LIKELY_FORCED" tells you the track that IS there is a forced
 * one covering foreign dialogue only — which looks perfectly healthy until you
 * check how far through the film it stops.
 */
export function SubtitleAuditPanel() {
  const slot = useSlot("shorts");
  const [rows, setRows] = useState<SubtitleAuditRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const uploadFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetch("/api/shorts/audit")
      .then((response) => response.json())
      .then((payload: { rows: SubtitleAuditRow[] }) => setRows(payload.rows ?? []))
      .catch(() => setRows([]));
  }, []);

  useEffect(load, [load]);

  const totals = slot.data?.totals;
  const byReason = slot.data?.byReason ?? [];
  const unusable = (rows ?? []).filter((row) => !row.usable);

  async function queueTranscribe(path: string) {
    setBusy(path);
    try {
      const form = new FormData();
      form.set("path", path);
      form.set("forceWhisper", "true");
      await fetch("/api/shorts/caption-source", { method: "POST", body: form });
      setNote("Queued for transcription. It will run when nobody is streaming.");
    } finally {
      setBusy(null);
    }
  }

  async function onFileChosen(file: File) {
    const path = uploadFor.current;
    if (!path) return;
    setBusy(path);
    try {
      const form = new FormData();
      form.set("path", path);
      form.set("file", file);
      const response = await fetch("/api/shorts/caption-source", {
        method: "POST",
        body: form,
      });
      const payload = await response.json();
      setNote(
        payload.error
          ? `Upload failed: ${payload.error}`
          : "Uploaded. It will be validated like any other track, then used first.",
      );
      load();
    } finally {
      setBusy(null);
      uploadFor.current = null;
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <Panel span="full">
      <PanelHeader
        title="Subtitle coverage"
        meta={totals ? `${formatNumber(totals.audited)} audited` : undefined}
        icon={<Captions size={14} aria-hidden />}
      />
      <PanelBody className="flex flex-col gap-3">
        {totals ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Stat label="Usable" value={formatNumber(totals.usable)} />
            <Stat
              label="Coverage"
              value={
                totals.audited
                  ? formatPercent(totals.usable / totals.audited, 0)
                  : "—"
              }
            />
            <Stat label="Need another route" value={formatNumber(totals.needsWhisper)} />
            {slot.data && slot.data.estWhisperHours > 0 ? (
              <Stat
                label="Est. transcription"
                value={`${slot.data.estWhisperHours.toFixed(1)}h`}
                hint="Rough estimate at ~10x realtime on the GPU — measure on the real box"
              />
            ) : null}
          </div>
        ) : null}

        {byReason.length > 0 ? (
          <>
            <StackedBar
              segments={byReason.slice(0, 8).map((entry, index) => ({
                label: entry.reason,
                value: entry.count,
                color: SERIES_COLORS[index % SERIES_COLORS.length],
              }))}
              height={10}
            />
            <ul className="flex flex-col gap-1">
              {byReason.map((entry, index) => (
                <li key={entry.reason} className="flex items-start gap-2 text-xs">
                  <span
                    className="mt-1 size-2.5 shrink-0 rounded-[3px]"
                    style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }}
                    aria-hidden
                  />
                  <span className="metric shrink-0 text-[11px] text-ink">{entry.count}</span>
                  <span className="metric shrink-0 text-[11px] text-ink-secondary">
                    {entry.reason}
                  </span>
                  {entry.explanation ? (
                    <span className="text-ink-faint">— {entry.explanation}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {note ? <InfoNote>{note}</InfoNote> : null}

        {unusable.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="text-left text-[11px] text-ink-faint">
                  <th className="pb-1.5 font-normal">Item</th>
                  <th className="pb-1.5 font-normal">Reason</th>
                  <th className="pb-1.5 text-right font-normal">Cues</th>
                  <th className="pb-1.5 text-right font-normal">Coverage</th>
                  <th className="pb-1.5 text-right font-normal">Fix</th>
                </tr>
              </thead>
              <tbody>
                {unusable.slice(0, 60).map((row) => (
                  <tr key={row.path} className="border-t border-[var(--glass-border)]">
                    <td className="max-w-[260px] truncate py-1.5 text-ink" title={row.path}>
                      {row.title ?? row.path}
                      {row.show ? (
                        <span className="ml-1.5 text-ink-faint">{row.show}</span>
                      ) : null}
                    </td>
                    <td className="metric py-1.5 text-[11px] text-ink-secondary" title={row.explanation ?? ""}>
                      {row.reason}
                    </td>
                    <td className="metric py-1.5 text-right text-[11px] text-ink-faint">
                      {row.cueCount ?? "—"}
                    </td>
                    <td className="metric py-1.5 text-right text-[11px] text-ink-faint">
                      {row.coverage === null ? "—" : formatPercent(row.coverage, 0)}
                    </td>
                    <td className="py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        <TinyButton
                          label="Upload a subtitle file"
                          disabled={busy === row.path}
                          onClick={() => {
                            uploadFor.current = row.path;
                            fileInput.current?.click();
                          }}
                        >
                          <Upload size={12} aria-hidden />
                        </TinyButton>
                        <TinyButton
                          label="Transcribe with Whisper"
                          disabled={busy === row.path}
                          onClick={() => queueTranscribe(row.path)}
                        >
                          <Wand2 size={12} aria-hidden />
                        </TinyButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {unusable.length > 60 ? (
              <p className="pt-2 text-[11px] text-ink-faint">
                Showing 60 of {formatNumber(unusable.length)}. The full list is in the
                audit CSV.
              </p>
            ) : null}
          </div>
        ) : rows === null ? (
          <p className="py-6 text-center text-sm text-ink-muted">Loading audit…</p>
        ) : (
          <p className="py-6 text-center text-sm text-ink-muted">
            Every audited item has a usable transcript.
          </p>
        )}

        <input
          ref={fileInput}
          type="file"
          accept=".srt,.ass,.ssa,.vtt"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFileChosen(file);
          }}
        />
      </PanelBody>
    </Panel>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div title={hint}>
      <p className="label-muted">{label}</p>
      <p className="metric text-lg font-medium text-ink">{value}</p>
    </div>
  );
}

function TinyButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-6 place-items-center rounded text-ink-faint transition-colors",
        "hover:bg-surface-2 hover:text-ink-secondary",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {children}
    </button>
  );
}
