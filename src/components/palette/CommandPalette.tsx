"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Clapperboard,
  Cpu,
  HardDrive,
  LayoutGrid,
  Library,
  RefreshCw,
  Search,
  Settings2,
  Tv,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { rank } from "@/lib/search";
import { usePalette } from "./PaletteProvider";

/**
 * Command palette.
 *
 * Three kinds of result in one list — pages, library titles, and actions —
 * because the question "where is X" and "do Y to X" are the same keystroke as
 * far as the user is concerned.
 *
 * Actions go through the existing /api/action allowlist. No new action types
 * are introduced here, so the guarantee that nothing in this codebase can
 * delete anything still holds.
 */

type Result =
  | { kind: "page"; id: string; label: string; hint: string; href: string; Icon: typeof LayoutGrid }
  | { kind: "title"; id: string; label: string; hint: string; itemId: number; media: "movie" | "series" }
  | { kind: "action"; id: string; label: string; hint: string; action: string; params: Record<string, unknown> };

const PAGES: Extract<Result, { kind: "page" }>[] = [
  { kind: "page", id: "p-overview", label: "Overview", hint: "Streams, capacity, health", href: "/", Icon: LayoutGrid },
  { kind: "page", id: "p-storage", label: "Storage", hint: "Mounts, growth, what's eating space", href: "/storage", Icon: HardDrive },
  { kind: "page", id: "p-library", label: "Library", hint: "Every movie and series", href: "/library", Icon: Library },
  { kind: "page", id: "p-activity", label: "Activity", hint: "Now playing and history", href: "/activity", Icon: Activity },
  { kind: "page", id: "p-health", label: "Health", hint: "Machine and service health", href: "/health", Icon: Cpu },
  { kind: "page", id: "p-setup", label: "Setup", hint: "Service connections", href: "/setup", Icon: Settings2 },
];

const GLOBAL_ACTIONS: Extract<Result, { kind: "action" }>[] = [
  {
    kind: "action",
    id: "a-missing",
    label: "Search for all missing episodes",
    hint: "Sonarr",
    action: "sonarr.searchMissing",
    params: {},
  },
];

const MAX_TITLES = 8;

/**
 * Mounts the dialog only while open.
 *
 * That's what resets the query and selection between openings — a palette
 * that remembers last time's search is one you have to clear before you can
 * use it. Doing it by mount rather than by an effect that calls setState on
 * `open` avoids a cascading render, and there's no state worth preserving
 * while it's closed.
 */
export function CommandPalette() {
  const { open } = usePalette();
  if (!open) return null;
  return <PaletteDialog />;
}

function PaletteDialog() {
  const { setOpen, items, loading, error } = usePalette();
  const router = useRouter();
  const [query, setQuery] = useState("");
  /**
   * The highlighted row, tagged with the query it belongs to.
   *
   * Selection must reset to the top whenever the query changes — otherwise you
   * type "sev", arrow down to the fourth row, keep typing, and stay on row
   * four of a completely different list. Storing the query alongside the index
   * lets that reset be DERIVED during render rather than corrected afterwards
   * by an effect.
   */
  const [selection, setSelection] = useState<{ query: string; index: number }>({
    query: "",
    index: 0,
  });
  const [running, setRunning] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  /**
   * Last real pointer position.
   *
   * Rows rendering underneath a STATIONARY cursor fire mousemove, which would
   * otherwise yank the selection away from whatever the keyboard had
   * highlighted — type a query, the list re-renders under your resting mouse,
   * and the highlight jumps to whichever row happens to be beneath it.
   * Selection only follows the mouse when the mouse has actually moved.
   */
  const pointer = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    // rAF so the input exists before we reach for it. Focusing the DOM is a
    // genuine external-system effect, unlike resetting state.
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const results = useMemo<Result[]>(() => {
    const pages = rank(PAGES, query, (page) => page.label, 6);

    const titles: Result[] = rank(items ?? [], query, (item) => item.title, MAX_TITLES).map(
      (item) => ({
        kind: "title" as const,
        id: `t-${item.kind}-${item.id}`,
        label: item.title,
        hint: [item.year, item.kind === "movie" ? "Film" : "TV"].filter(Boolean).join(" · "),
        itemId: item.id,
        media: item.kind,
      }),
    );

    // Per-title actions appear once the query is specific enough to have
    // produced a single obvious target.
    const perTitle: Result[] =
      query.trim() && titles.length > 0 && titles[0].kind === "title"
        ? [
            {
              kind: "action" as const,
              id: `a-search-${titles[0].itemId}`,
              label: `Search for "${titles[0].label}"`,
              hint: titles[0].media === "movie" ? "Radarr" : "Sonarr",
              action: titles[0].media === "movie" ? "radarr.search" : "sonarr.search",
              params: { id: titles[0].itemId },
            },
            {
              kind: "action" as const,
              id: `a-refresh-${titles[0].itemId}`,
              label: `Refresh "${titles[0].label}"`,
              hint: titles[0].media === "movie" ? "Radarr" : "Sonarr",
              action: titles[0].media === "movie" ? "radarr.refresh" : "sonarr.refresh",
              params: { id: titles[0].itemId },
            },
          ]
        : [];

    const globals = rank(GLOBAL_ACTIONS, query, (entry) => entry.label, 2);

    return [...pages, ...titles, ...perTitle, ...globals];
  }, [items, query]);

  // Clamped during render rather than corrected afterwards in an effect:
  // typing narrows the list, and the highlight has to stay in range on the
  // very same render, not one render later.
  const active =
    selection.query !== query || results.length === 0
      ? 0
      : Math.min(selection.index, results.length - 1);

  const moveTo = (index: number) => setSelection({ query, index });

  const run = async (result: Result) => {
    if (result.kind === "page") {
      router.push(result.href);
      setOpen(false);
      return;
    }

    if (result.kind === "title") {
      // The library page owns the table; deep-link with the title so it lands
      // pre-filtered rather than dumping you at the top of 1,054 rows.
      router.push(`/library?q=${encodeURIComponent(result.label)}`);
      setOpen(false);
      return;
    }

    setRunning(result.id);
    setMessage(null);
    try {
      const response = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: result.action, params: result.params }),
      });
      const payload = (await response.json()) as { ok: boolean; message: string };
      setMessage(payload.message);
      if (payload.ok) setTimeout(() => setOpen(false), 900);
    } catch {
      setMessage("Couldn't reach the dashboard server.");
    } finally {
      setRunning(null);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    // Stepping from the CLAMPED index, not the raw one. After the list
    // narrows, the raw index can sit past the end; wrapping from it would skip
    // rows rather than moving one at a time.
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveTo(results.length === 0 ? 0 : (active + 1) % results.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveTo(results.length === 0 ? 0 : (active - 1 + results.length) % results.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = results[active];
      if (result) void run(result);
    }
  };

  // Keep the highlighted row in view during keyboard navigation.
  useEffect(() => {
    const node = listRef.current?.children[active] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[12vh]"
      role="presentation"
      onMouseDown={(event) => {
        // Click-outside closes; mousedown on the panel itself must not.
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="absolute inset-0 bg-[rgba(4,4,5,0.72)] backdrop-blur-sm" aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        className="glass relative w-full max-w-[640px] overflow-hidden shadow-[var(--elev-3)]"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-[var(--glass-border)] px-4">
          <Search size={16} className="shrink-0 text-ink-muted" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles, pages and actions…"
            aria-label="Search titles, pages and actions"
            aria-controls="palette-results"
            aria-activedescendant={results[active]?.id}
            autoComplete="off"
            spellCheck={false}
            // No focus ring here: this input is auto-focused as the dialog's
            // sole control, so the ring adds a heavy box without telling anyone
            // anything. Focus is still restored to the trigger on close.
            className="w-full bg-transparent py-3.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus-visible:outline-none"
          />
          <kbd className="metric hidden shrink-0 rounded border border-[var(--glass-border)] px-1.5 py-0.5 text-[10px] text-ink-faint sm:block">
            esc
          </kbd>
        </div>

        <ul
          id="palette-results"
          ref={listRef}
          role="listbox"
          aria-label="Results"
          className="max-h-[52vh] overflow-y-auto p-1.5"
        >
          {results.map((result, index) => {
            const selected = index === active;
            return (
              <li
                key={result.id}
                id={result.id}
                role="option"
                aria-selected={selected}
                onMouseMove={(event) => {
                  const moved =
                    !pointer.current ||
                    pointer.current.x !== event.clientX ||
                    pointer.current.y !== event.clientY;
                  pointer.current = { x: event.clientX, y: event.clientY };
                  if (moved) moveTo(index);
                }}
                onClick={() => void run(result)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
                  selected ? "bg-surface-3 text-ink" : "text-ink-secondary",
                )}
              >
                <span className="shrink-0 text-ink-muted" aria-hidden>
                  {result.kind === "page" ? (
                    <result.Icon size={15} />
                  ) : result.kind === "title" ? (
                    result.media === "movie" ? (
                      <Clapperboard size={15} />
                    ) : (
                      <Tv size={15} />
                    )
                  ) : (
                    <RefreshCw size={15} className={running === result.id ? "animate-spin" : ""} />
                  )}
                </span>

                <span className="min-w-0 flex-1 truncate">{result.label}</span>

                <span className="metric shrink-0 text-[11px] text-ink-faint">{result.hint}</span>
              </li>
            );
          })}

          {results.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-ink-muted">
              {loading
                ? "Loading library…"
                : error
                  ? error
                  : query
                    ? `Nothing matches "${query}"`
                    : "Type to search"}
            </li>
          ) : null}
        </ul>

        {message ? (
          <p
            role="status"
            className="border-t border-[var(--glass-border)] px-4 py-2.5 text-xs text-ink-secondary"
          >
            {message}
          </p>
        ) : (
          <div className="flex items-center gap-4 border-t border-[var(--glass-border)] px-4 py-2 text-[10px] text-ink-faint">
            <span>↑↓ navigate</span>
            <span>↵ select</span>
            <span>esc close</span>
            {items ? <span className="ml-auto metric">{items.length} titles</span> : null}
          </div>
        )}
      </div>
    </div>
  );
}
