"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { formatBytes, formatNumber } from "@/lib/format";
import type { LargestItem } from "@/lib/types";

/**
 * "What's eating the space" — ranked, sortable.
 *
 * Sorting by size per episode is the point of this table: a 400 GB show is
 * unremarkable at 200 episodes and alarming at 10, and only the per-episode
 * column makes that difference visible.
 *
 * On phones the table becomes list rows — a horizontally scrolling grid on a
 * 375px screen is unusable, so the columns collapse into a stacked card.
 */

type SortKey = "size" | "sizePerEpisode" | "title";
type Filter = "all" | "movie" | "series";

export function LargestItems({ items, limit = 40 }: { items: LargestItem[]; limit?: number }) {
  const [sortKey, setSortKey] = useState<SortKey>("size");
  const [descending, setDescending] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items
      .filter((item) => (filter === "all" ? true : item.kind === filter))
      .filter((item) => (term ? item.title.toLowerCase().includes(term) : true))
      .sort((a, b) => {
        let comparison: number;
        if (sortKey === "title") {
          comparison = a.title.localeCompare(b.title);
        } else if (sortKey === "sizePerEpisode") {
          // Movies have no per-episode value; sort them to the end rather
          // than letting null masquerade as zero.
          comparison = (a.sizePerEpisode ?? -1) - (b.sizePerEpisode ?? -1);
        } else {
          comparison = a.size - b.size;
        }
        return descending ? -comparison : comparison;
      })
      .slice(0, limit);
  }, [items, sortKey, descending, filter, query, limit]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setDescending((value) => !value);
    } else {
      setSortKey(key);
      setDescending(true);
    }
  };

  const SortButton = ({ column, label }: { column: SortKey; label: string }) => (
    <button
      type="button"
      onClick={() => toggleSort(column)}
      className={cn(
        "flex items-center gap-1 transition-colors hover:text-ink",
        sortKey === column ? "text-ink" : "text-ink-muted",
      )}
      aria-label={`Sort by ${label}`}
      aria-sort={sortKey === column ? (descending ? "descending" : "ascending") : "none"}
    >
      {label}
      {sortKey === column ? (
        descending ? (
          <ArrowDown size={11} aria-hidden />
        ) : (
          <ArrowUp size={11} aria-hidden />
        )
      ) : null}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Filters in one row above the data. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-surface-2 p-0.5">
          {(["all", "movie", "series"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                filter === value
                  ? "bg-surface-3 text-ink"
                  : "text-ink-muted hover:text-ink-secondary",
              )}
            >
              {value === "all" ? "All" : `${value}s`}
            </button>
          ))}
        </div>

        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by title…"
          aria-label="Filter by title"
          className="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
        />
      </div>

      {/* --- Desktop table --- */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--glass-border)]">
              <th className="w-8 py-2 pr-2 text-left text-[11px] font-medium text-ink-faint">#</th>
              <th className="py-2 pr-3 text-left text-[11px] font-medium">
                <SortButton column="title" label="Title" />
              </th>
              <th className="py-2 pr-3 text-left text-[11px] font-medium text-ink-muted">Quality</th>
              <th className="py-2 pr-3 text-right text-[11px] font-medium">
                <span className="flex justify-end">
                  <SortButton column="sizePerEpisode" label="Per episode" />
                </span>
              </th>
              <th className="py-2 text-right text-[11px] font-medium">
                <span className="flex justify-end">
                  <SortButton column="size" label="Size" />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item, index) => (
              <tr
                key={`${item.kind}-${item.id}`}
                className="border-b border-[var(--glass-border)] transition-colors last:border-0 hover:bg-surface-2"
              >
                <td className="metric py-2 pr-2 text-[11px] text-ink-faint">{index + 1}</td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase"
                      style={{
                        background:
                          item.kind === "movie"
                            ? "rgba(57,135,229,0.16)"
                            : "rgba(217,89,38,0.16)",
                        color: item.kind === "movie" ? "var(--series-1)" : "var(--series-2)",
                      }}
                    >
                      {item.kind === "movie" ? "Film" : "TV"}
                    </span>
                    <span className="truncate font-medium text-ink">{item.title}</span>
                    {item.year ? (
                      <span className="metric shrink-0 text-[11px] text-ink-faint">
                        {item.year}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="py-2 pr-3 text-xs text-ink-muted">
                  {item.quality ?? (item.episodeCount ? `${formatNumber(item.episodeCount)} eps` : "—")}
                </td>
                <td className="metric py-2 pr-3 text-right text-xs text-ink-secondary">
                  {item.sizePerEpisode ? formatBytes(item.sizePerEpisode) : "—"}
                </td>
                <td className="metric py-2 text-right text-xs font-semibold text-ink">
                  {formatBytes(item.size)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* --- Phone list rows --- */}
      <ul className="flex flex-col gap-1.5 sm:hidden">
        {rows.map((item, index) => (
          <li key={`${item.kind}-${item.id}`} className="rounded-lg bg-surface-2 p-2.5">
            <div className="flex items-start gap-2">
              <span className="metric mt-0.5 w-5 shrink-0 text-[11px] text-ink-faint">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{item.title}</p>
                <p className="metric mt-0.5 text-[11px] text-ink-faint">
                  {item.kind === "movie" ? "Film" : "TV"}
                  {item.quality ? ` · ${item.quality}` : ""}
                  {item.sizePerEpisode ? ` · ${formatBytes(item.sizePerEpisode)}/ep` : ""}
                </p>
              </div>
              <span className="metric shrink-0 text-sm font-semibold text-ink">
                {formatBytes(item.size)}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-muted">Nothing matches that filter.</p>
      ) : null}
    </div>
  );
}
