"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { ShortClip } from "@/lib/types";
import { formatDuration } from "@/lib/format";

/**
 * Full-screen preview for one clip.
 *
 * The video is served by /api/shorts/media, which supports range requests —
 * without that the scrubber is decorative, because seeking needs a 206.
 */
export function ShortPlayer({
  clip,
  onClose,
}: {
  clip: ShortClip;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // The page behind shouldn't scroll while a modal is open.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${clip.title ?? clip.lookupKey}`}
    >
      <div
        className="flex max-h-full w-full max-w-sm flex-col gap-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">
              {clip.title ?? clip.lookupKey}
              {clip.partIndex ? (
                <span className="ml-2 text-white/60">
                  Part {clip.partIndex}/{clip.partTotal}
                </span>
              ) : null}
            </p>
            <p className="metric text-[11px] text-white/50">
              {formatDuration(clip.duration * 1000)} · match {Math.round(clip.score)} ·{" "}
              {clip.provenance?.replace(/_/g, " ")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="ml-auto grid size-8 shrink-0 place-items-center rounded-lg bg-white/10 text-white/80 transition-colors hover:bg-white/20"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        {/* Captions are burned into the video itself, so there is no separate
            track file to attach. */}
        <video
          ref={videoRef}
          src={`/api/shorts/media?id=${encodeURIComponent(clip.id)}`}
          poster={
            clip.thumbnail
              ? `/api/shorts/media?kind=thumb&id=${encodeURIComponent(clip.id)}`
              : undefined
          }
          controls
          autoPlay
          playsInline
          className="max-h-[70vh] w-full rounded-xl bg-black"
        />

        <p className="rounded-lg bg-white/5 px-3 py-2 text-xs leading-relaxed text-white/70">
          “{clip.quote}”
        </p>
      </div>
    </div>
  );
}
