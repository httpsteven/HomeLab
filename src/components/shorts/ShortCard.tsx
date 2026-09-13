"use client";

import { Check, Film, Play, Star, Trash2, X } from "lucide-react";
import type { ShortClip } from "@/lib/types";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";

/** Low-confidence matches are the ones most worth watching before uploading. */
const LOW_SCORE = 80;

export function ShortCard({
  clip,
  onPlay,
  onReview,
  onDelete,
  busy,
}: {
  clip: ShortClip;
  onPlay: () => void;
  onReview: (status: string) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const thumbnail = clip.thumbnail
    ? `/api/shorts/media?kind=thumb&id=${encodeURIComponent(clip.id)}`
    : null;

  return (
    <article
      className={cn(
        "group glass flex flex-col overflow-hidden transition-opacity",
        busy && "opacity-50",
        clip.reviewStatus === "rejected" && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={onPlay}
        className="relative aspect-[9/16] w-full overflow-hidden bg-surface-2"
        aria-label={`Play ${clip.title ?? clip.lookupKey}`}
      >
        {thumbnail ? (
          /* A plain <img>: these are small JPEGs served by our own route from
             the same box, so next/image would add an optimisation hop that
             costs more than it saves. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="grid size-full place-items-center text-ink-faint">
            <Film size={28} aria-hidden />
          </div>
        )}

        <span className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
          <span className="grid size-11 place-items-center rounded-full bg-white/90 text-black">
            <Play size={18} aria-hidden className="ml-0.5" />
          </span>
        </span>

        {clip.partIndex ? (
          <span className="metric absolute top-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {clip.partIndex}/{clip.partTotal}
          </span>
        ) : null}

        <span className="metric absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
          {formatDuration(clip.duration * 1000)}
        </span>

        {clip.reviewStatus && clip.reviewStatus !== "none" ? (
          <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white capitalize">
            {clip.reviewStatus}
          </span>
        ) : null}
      </button>

      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <p className="truncate text-xs font-medium text-ink" title={clip.title ?? clip.lookupKey}>
          {clip.title ?? clip.lookupKey}
        </p>
        <p className="line-clamp-2 text-[11px] leading-snug text-ink-muted" title={clip.quote}>
          “{clip.quote}”
        </p>

        <div className="mt-auto flex items-center gap-1.5 pt-1">
          <span
            className={cn(
              "metric text-[10px]",
              clip.score < LOW_SCORE ? "text-warning" : "text-ink-faint",
            )}
            title={
              clip.score < LOW_SCORE
                ? "Low match confidence — worth watching before you upload it"
                : "Match confidence"
            }
          >
            {Math.round(clip.score)}
          </span>
          {clip.category ? (
            <span className="truncate rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-muted">
              {clip.category}
            </span>
          ) : null}

          <div className="ml-auto flex items-center gap-0.5">
            <IconButton
              label="Mark as favourite"
              active={clip.reviewStatus === "favourite"}
              onClick={() => onReview(clip.reviewStatus === "favourite" ? "none" : "favourite")}
              disabled={busy}
            >
              <Star size={13} aria-hidden />
            </IconButton>
            <IconButton
              label="Approve"
              active={clip.reviewStatus === "approved"}
              onClick={() => onReview(clip.reviewStatus === "approved" ? "none" : "approved")}
              disabled={busy}
            >
              <Check size={13} aria-hidden />
            </IconButton>
            <IconButton
              label="Reject"
              active={clip.reviewStatus === "rejected"}
              onClick={() => onReview(clip.reviewStatus === "rejected" ? "none" : "rejected")}
              disabled={busy}
            >
              <X size={13} aria-hidden />
            </IconButton>
            <IconButton label="Delete clip" onClick={onDelete} disabled={busy} danger>
              <Trash2 size={13} aria-hidden />
            </IconButton>
          </div>
        </div>
      </div>
    </article>
  );
}

function IconButton({
  children,
  label,
  onClick,
  active,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        "grid size-6 place-items-center rounded transition-colors",
        "text-ink-faint hover:bg-surface-2 hover:text-ink-secondary",
        active && "bg-surface-3 text-ink",
        danger && "hover:text-critical",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {children}
    </button>
  );
}
