"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clapperboard, Pause, Play, RefreshCw, Search } from "lucide-react";
import { useSlot } from "@/components/DashboardProvider";
import { ShortCard } from "@/components/shorts/ShortCard";
import { ShortPlayer } from "@/components/shorts/ShortPlayer";
import { NotConfigured, Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { InfoNote } from "@/components/ui/Status";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { scoreMatch } from "@/lib/search";
import type { ShortClip } from "@/lib/types";

type SortKey = "newest" | "score" | "duration" | "title";

const ALL = "all";

/**
 * The clip browser.
 *
 * Filtering happens client-side over the full list from /api/shorts/clips. That
 * list is a few hundred rows even on a busy library — small enough that
 * filtering in the browser is instant and far simpler than round-tripping every
 * keystroke to the server.
 */
export function ShortsView() {
  const slot = useSlot("shorts");
  const [clips, setClips] = useState<ShortClip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<ShortClip | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const [search, setSearch] = useState("");
  const [show, setShow] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [provenance, setProvenance] = useState(ALL);
  const [grouping, setGrouping] = useState(ALL);
  const [review, setReview] = useState(ALL);
  const [sort, setSort] = useState<SortKey>("newest");

  const load = useCallback(() => {
    fetch("/api/shorts/clips")
      .then((response) => response.json())
      .then((payload: { clips: ShortClip[]; error: string | null }) => {
        setClips(payload.clips ?? []);
        setError(payload.error);
      })
      .catch(() => setError("Couldn't load the clip list."));
  }, []);

  useEffect(load, [load]);

  // The slot ticks every few seconds; when the clip COUNT changes something was
  // produced or removed, so refresh the list. Refetching on every tick would
  // re-download the whole array for nothing.
  const clipCount = slot.data?.totals.clips;
  useEffect(() => {
    if (clipCount !== undefined) load();
  }, [clipCount, load]);

  const options = useMemo(() => {
    const source = clips ?? [];
    return {
      shows: [...new Set(source.map((clip) => clip.show).filter(Boolean))].sort() as string[],
      categories: [...new Set(source.map((clip) => clip.category).filter(Boolean))].sort() as string[],
      provenances: [...new Set(source.map((clip) => clip.provenance).filter(Boolean))].sort() as string[],
    };
  }, [clips]);

  const visible = useMemo(() => {
    let result = clips ?? [];

    if (show !== ALL) result = result.filter((clip) => clip.show === show);
    if (category !== ALL) result = result.filter((clip) => clip.category === category);
    if (provenance !== ALL) result = result.filter((clip) => clip.provenance === provenance);
    if (grouping === "series") result = result.filter((clip) => clip.seriesId);
    if (grouping === "single") result = result.filter((clip) => !clip.seriesId);
    if (review === "unreviewed") {
      result = result.filter((clip) => !clip.reviewStatus || clip.reviewStatus === "none");
    } else if (review !== ALL) {
      result = result.filter((clip) => clip.reviewStatus === review);
    }

    if (search.trim()) {
      // Same ranked substring matcher the command palette uses, over the
      // fields someone would actually type: the title and the quote itself.
      const needle = search.trim();
      result = result
        .map((clip) => ({
          clip,
          rank: Math.max(
            scoreMatch(clip.title ?? clip.lookupKey, needle),
            scoreMatch(clip.quote, needle),
          ),
        }))
        .filter((entry) => entry.rank > 0)
        .sort((a, b) => b.rank - a.rank)
        .map((entry) => entry.clip);

      if (sort === "newest") return result;
    }

    const sorted = [...result];
    if (sort === "score") sorted.sort((a, b) => a.score - b.score); // worst first: review these
    else if (sort === "duration") sorted.sort((a, b) => b.duration - a.duration);
    else if (sort === "title") {
      sorted.sort((a, b) =>
        (a.title ?? a.lookupKey).localeCompare(b.title ?? b.lookupKey) ||
        (a.partIndex ?? 0) - (b.partIndex ?? 0),
      );
    } else {
      // Newest first, but a SERIES is one thing: all its parts sort together by
      // the newest part, then ascending by part number. Sorting parts purely by
      // timestamp interleaves them (they're rendered seconds apart, and the
      // stored precision is whole seconds), so a four-part series would read
      // "4, 2, 1, 3" — which looks broken even though nothing is wrong.
      const seriesTime = new Map<string, number>();
      for (const clip of sorted) {
        if (!clip.seriesId) continue;
        const at = Date.parse(clip.createdAt);
        seriesTime.set(clip.seriesId, Math.max(seriesTime.get(clip.seriesId) ?? 0, at));
      }
      const groupTime = (clip: ShortClip) =>
        clip.seriesId ? (seriesTime.get(clip.seriesId) ?? 0) : Date.parse(clip.createdAt);

      sorted.sort(
        (a, b) =>
          groupTime(b) - groupTime(a) ||
          (a.seriesId ?? "").localeCompare(b.seriesId ?? "") ||
          (a.partIndex ?? 0) - (b.partIndex ?? 0),
      );
    }
    return sorted;
  }, [clips, show, category, provenance, grouping, review, search, sort]);

  const markBusy = (id: string, busy: boolean) =>
    setBusyIds((previous) => {
      const next = new Set(previous);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  async function onReview(clip: ShortClip, status: string) {
    markBusy(clip.id, true);
    // Optimistic: the round trip is local and the failure path restores it.
    setClips((previous) =>
      previous?.map((entry) =>
        entry.id === clip.id ? { ...entry, reviewStatus: status } : entry,
      ) ?? previous,
    );
    try {
      await fetch("/api/shorts/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipId: clip.id, status }),
      });
    } finally {
      markBusy(clip.id, false);
      load();
    }
  }

  async function onDelete(clip: ShortClip) {
    const confirmed = window.confirm(
      `Delete this clip?\n\n${clip.title ?? clip.lookupKey}\n\n` +
        `This removes the generated .mp4 and its thumbnail. ` +
        `The source file in your library is not touched.`,
    );
    if (!confirmed) return;

    markBusy(clip.id, true);
    try {
      await fetch("/api/shorts/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "delete", payload: { clip_ids: [clip.id] } }),
      });
      // The worker does the unlinking, so the row lingers until it runs. Hide
      // it now rather than leaving something that looks like a failed click.
      setClips((previous) => previous?.filter((entry) => entry.id !== clip.id) ?? previous);
    } finally {
      markBusy(clip.id, false);
    }
  }

  if (slot.status === "not-configured") {
    return (
      <Panel span="full">
        <PanelHeader title="Shorts" icon={<Clapperboard size={14} aria-hidden />} />
        <PanelBody>
          <NotConfigured
            service="Shorts"
            hint="Set SHORTS_DB_PATH to the pipeline's shorts.db, then run `python -m src.pipeline audit --deep`."
          />
        </PanelBody>
      </Panel>
    );
  }

  const worker = slot.data?.worker;

  return (
    <>
      {worker ? <WorkerBanner paused={worker.paused} reason={worker.reason} /> : null}

      <Panel span="full">
        <PanelHeader
          title="Clips"
          meta={
            clips
              ? `${formatNumber(visible.length)}${
                  visible.length !== clips.length ? ` of ${formatNumber(clips.length)}` : ""
                }`
              : undefined
          }
          icon={<Clapperboard size={14} aria-hidden />}
          action={
            <button
              type="button"
              onClick={load}
              aria-label="Refresh clip list"
              title="Refresh clip list"
              className="grid size-7 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink-secondary"
            >
              <RefreshCw size={13} aria-hidden />
            </button>
          }
        />
        <PanelBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative flex min-w-[180px] flex-1 items-center">
              <Search size={13} aria-hidden className="absolute left-2.5 text-ink-faint" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search titles and quotes"
                aria-label="Search clips"
                className="w-full rounded-lg bg-surface-2 py-1.5 pr-2.5 pl-7 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:ring-1 focus:ring-[var(--glass-border-strong)]"
              />
            </label>

            <Select label="Show" value={show} onChange={setShow} options={options.shows} />
            <Select label="Category" value={category} onChange={setCategory} options={options.categories} />
            <Select
              label="Captions from"
              value={provenance}
              onChange={setProvenance}
              options={options.provenances}
              render={(value) => value.replace(/_/g, " ")}
            />
            <Select
              label="Type"
              value={grouping}
              onChange={setGrouping}
              options={["series", "single"]}
            />
            <Select
              label="Review"
              value={review}
              onChange={setReview}
              options={["unreviewed", "approved", "rejected", "favourite"]}
            />
            <Select
              label="Sort"
              value={sort}
              onChange={(value) => setSort(value as SortKey)}
              options={["newest", "score", "duration", "title"]}
              includeAll={false}
              render={(value) =>
                value === "score" ? "lowest match first" : value
              }
            />
          </div>

          {error ? <InfoNote>{error}</InfoNote> : null}

          {clips === null ? (
            <p className="py-10 text-center text-sm text-ink-muted">Loading clips…</p>
          ) : visible.length === 0 ? (
            <EmptyState hasAny={clips.length > 0} />
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {visible.map((clip) => (
                <ShortCard
                  key={clip.id}
                  clip={clip}
                  busy={busyIds.has(clip.id)}
                  onPlay={() => setPlaying(clip)}
                  onReview={(status) => onReview(clip, status)}
                  onDelete={() => onDelete(clip)}
                />
              ))}
            </div>
          )}
        </PanelBody>
      </Panel>

      {playing ? <ShortPlayer clip={playing} onClose={() => setPlaying(null)} /> : null}
    </>
  );
}

function WorkerBanner({ paused, reason }: { paused: boolean; reason: string }) {
  return (
    <Panel span="full">
      <PanelBody className="flex items-center gap-2.5 py-3">
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-lg",
            paused ? "bg-surface-3 text-warning" : "bg-surface-2 text-good",
          )}
        >
          {paused ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink">
            Pipeline {paused ? "paused" : "ready"}
          </p>
          <p className="truncate text-[11px] text-ink-muted">
            {reason}
            {paused
              ? " — work resumes on its own once the lab is quiet."
              : null}
          </p>
        </div>
      </PanelBody>
    </Panel>
  );
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm text-ink-muted">
        {hasAny ? "No clips match these filters." : "No clips yet."}
      </p>
      {!hasAny ? (
        <p className="mt-1 text-xs text-ink-faint">
          Run <code className="metric">python -m src.pipeline make --count 5</code>, or
          queue a render from the Pipeline panel.
        </p>
      ) : null}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  includeAll = true,
  render,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  includeAll?: boolean;
  render?: (value: string) => string;
}) {
  if (options.length === 0) return null;
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-ink-faint">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="rounded-lg bg-surface-2 px-2 py-1.5 text-xs text-ink-secondary focus:outline-none focus:ring-1 focus:ring-[var(--glass-border-strong)]"
      >
        {includeAll ? <option value={ALL}>All</option> : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {render ? render(option) : option}
          </option>
        ))}
      </select>
    </label>
  );
}
