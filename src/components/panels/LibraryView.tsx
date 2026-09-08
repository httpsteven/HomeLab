"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { useSlot } from "@/components/DashboardProvider";
import { Freshness } from "@/components/shell/ConnectionIndicator";
import { ActionButton } from "@/components/ui/ActionButton";
import { StackedBar } from "@/components/ui/CapacityBar";
import { NotConfigured, Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { InfoNote } from "@/components/ui/Status";
import { SortButton, ariaSort } from "@/components/ui/SortButton";
import { cn } from "@/lib/cn";
import { formatBytes, formatNumber, formatPercent } from "@/lib/format";
import type { LibraryItem, QualityBucket } from "@/lib/types";

/**
 * The library database view.
 *
 * Distribution charts use the categorical palette in fixed slot order and
 * fold everything past the 8th into "Other" — a 9th generated hue would break
 * the validated separation guarantees.
 */

const SERIES_COLORS = [
  "var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)",
  "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)",
];

function foldToEight(buckets: QualityBucket[]): { name: string; bytes: number; count: number; color: string }[] {
  const top = buckets.slice(0, 7);
  const rest = buckets.slice(7);

  const folded = top.map((bucket, index) => ({ ...bucket, color: SERIES_COLORS[index] }));

  if (rest.length > 0) {
    folded.push({
      name: `Other (${rest.length})`,
      bytes: rest.reduce((sum, bucket) => sum + bucket.bytes, 0),
      count: rest.reduce((sum, bucket) => sum + bucket.count, 0),
      color: "var(--text-faint)",
    });
  }

  return folded;
}

function Distribution({ title, buckets }: { title: string; buckets: QualityBucket[] }) {
  const folded = foldToEight(buckets);
  const total = folded.reduce((sum, bucket) => sum + bucket.bytes, 0);

  if (folded.length === 0) {
    return (
      <Panel span="md">
        <PanelHeader title={title} />
        <PanelBody>
          <p className="py-6 text-center text-sm text-ink-muted">No data yet.</p>
        </PanelBody>
      </Panel>
    );
  }

  return (
    <Panel span="md">
      <PanelHeader title={title} meta={`${folded.length}`} />
      <PanelBody className="flex flex-col gap-3">
        <StackedBar
          segments={folded.map((bucket) => ({
            label: bucket.name,
            value: bucket.bytes,
            color: bucket.color,
          }))}
          height={12}
        />
        {/* Direct-labelled rows: identity never rests on the color chip alone. */}
        <ul className="flex flex-col gap-1.5">
          {folded.map((bucket) => (
            <li key={bucket.name} className="flex items-center gap-2 text-xs">
              <span
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ background: bucket.color }}
                aria-hidden
              />
              <span className="truncate text-ink-secondary">{bucket.name}</span>
              <span className="metric ml-auto shrink-0 text-[11px] text-ink-faint">
                {formatNumber(bucket.count)}
              </span>
              <span className="metric w-20 shrink-0 text-right font-medium text-ink">
                {formatBytes(bucket.bytes)}
              </span>
              <span className="metric w-12 shrink-0 text-right text-[11px] text-ink-faint">
                {total > 0 ? formatPercent(bucket.bytes / total, 0) : "—"}
              </span>
            </li>
          ))}
        </ul>
      </PanelBody>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

type SortKey = "title" | "size" | "completeness" | "added";
type KindFilter = "all" | "movie" | "series";

/**
 * Fetches the full item list once per mount.
 *
 * The live state carries counts, not the array — see LibraryState.itemCount.
 */
function useLibraryItems() {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/library-items")
      .then((response) => response.json())
      .then((payload: { items: LibraryItem[]; error: string | null }) => {
        if (cancelled) return;
        setItems(payload.items ?? []);
        setError(payload.error);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the library list.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { items, error };
}

function ItemTable({ items }: { items: LibraryItem[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [descending, setDescending] = useState(false);
  const [limit, setLimit] = useState(60);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items
      .filter((item) => (kind === "all" ? true : item.kind === kind))
      .filter((item) => (term ? item.title.toLowerCase().includes(term) : true))
      .filter((item) => (onlyProblems ? item.completeness < 1 : true))
      .sort((a, b) => {
        let comparison: number;
        switch (sortKey) {
          case "size":
            comparison = a.size - b.size;
            break;
          case "completeness":
            comparison = a.completeness - b.completeness;
            break;
          case "added":
            comparison =
              new Date(a.added ?? 0).getTime() - new Date(b.added ?? 0).getTime();
            break;
          default:
            comparison = a.title.localeCompare(b.title);
        }
        return descending ? -comparison : comparison;
      });
  }, [items, query, kind, onlyProblems, sortKey, descending]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setDescending((value) => !value);
    else {
      setSortKey(key);
      setDescending(key !== "title");
    }
  };

  const visible = rows.slice(0, limit);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-surface-2 p-0.5">
          {(["all", "movie", "series"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                kind === value ? "bg-surface-3 text-ink" : "text-ink-muted hover:text-ink-secondary",
              )}
            >
              {value === "all" ? "All" : value === "movie" ? "Movies" : "Series"}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setOnlyProblems((value) => !value)}
          className={cn(
            "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
            onlyProblems
              ? "bg-[var(--status-warning-dim)] text-[var(--status-warning)]"
              : "bg-surface-2 text-ink-muted hover:text-ink-secondary",
          )}
        >
          Incomplete only
        </button>

        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search titles…"
          aria-label="Search titles"
          className="min-w-[140px] flex-1 rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
        />

        <span className="metric text-[11px] text-ink-faint">
          {formatNumber(rows.length)} shown
        </span>
      </div>

      {/* --- Desktop --- */}
      <div className="hidden sm:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--glass-border)]">
              <th
                className="py-2 pr-3 text-left text-[11px] font-medium"
                aria-sort={ariaSort(sortKey === "title", descending)}
              >
                <SortButton
                  column="title"
                  label="Title"
                  activeColumn={sortKey}
                  descending={descending}
                  onSort={toggleSort}
                />
              </th>
              <th className="py-2 pr-3 text-left text-[11px] font-medium text-ink-muted">Quality</th>
              <th
                className="py-2 pr-3 text-right text-[11px] font-medium"
                aria-sort={ariaSort(sortKey === "completeness", descending)}
              >
                <span className="flex justify-end">
                  <SortButton
                    column="completeness"
                    label="Complete"
                    activeColumn={sortKey}
                    descending={descending}
                    onSort={toggleSort}
                  />
                </span>
              </th>
              <th
                className="py-2 pr-3 text-right text-[11px] font-medium"
                aria-sort={ariaSort(sortKey === "size", descending)}
              >
                <span className="flex justify-end">
                  <SortButton
                    column="size"
                    label="Size"
                    activeColumn={sortKey}
                    descending={descending}
                    onSort={toggleSort}
                  />
                </span>
              </th>
              <th className="w-[190px] py-2 text-right text-[11px] font-medium text-ink-muted">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr
                key={`${item.kind}-${item.id}`}
                className="border-b border-[var(--glass-border)] transition-colors last:border-0 hover:bg-surface-2"
              >
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase"
                      style={{
                        background:
                          item.kind === "movie" ? "rgba(57,135,229,0.16)" : "rgba(217,89,38,0.16)",
                        color: item.kind === "movie" ? "var(--series-1)" : "var(--series-2)",
                      }}
                    >
                      {item.kind === "movie" ? "Film" : "TV"}
                    </span>
                    <span className="truncate font-medium text-ink">{item.title}</span>
                    {item.year ? (
                      <span className="metric shrink-0 text-[11px] text-ink-faint">{item.year}</span>
                    ) : null}
                    {!item.monitored ? (
                      <span className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[9px] font-medium text-ink-faint uppercase">
                        Unmonitored
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="truncate py-2 pr-3 text-xs text-ink-muted">
                  {item.quality ?? "—"}
                  {item.codec ? ` · ${item.codec}` : ""}
                </td>
                <td className="py-2 pr-3 text-right">
                  {item.kind === "series" ? (
                    <span
                      className="metric text-xs"
                      style={{
                        color:
                          item.completeness >= 1 ? "var(--text-secondary)" : "var(--status-warning)",
                      }}
                    >
                      {item.episodeFileCount}/{item.episodeCount}
                    </span>
                  ) : (
                    <span
                      className="metric text-xs"
                      style={{
                        color:
                          item.completeness >= 1 ? "var(--text-secondary)" : "var(--status-warning)",
                      }}
                    >
                      {item.completeness >= 1 ? "Yes" : "Missing"}
                    </span>
                  )}
                </td>
                <td className="metric py-2 pr-3 text-right text-xs font-medium text-ink">
                  {item.size > 0 ? formatBytes(item.size) : "—"}
                </td>
                <td className="py-2">
                  <div className="flex items-center justify-end gap-1">
                    <ActionButton
                      action={item.kind === "movie" ? "radarr.search" : "sonarr.search"}
                      params={{ id: item.id }}
                      label="Search"
                      icon={<Search size={10} aria-hidden />}
                      size="xs"
                    />
                    <ActionButton
                      action={item.kind === "movie" ? "radarr.refresh" : "sonarr.refresh"}
                      params={{ id: item.id }}
                      label="Refresh"
                      icon={<RefreshCw size={10} aria-hidden />}
                      size="xs"
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* --- Phone --- */}
      <ul className="flex flex-col gap-1.5 sm:hidden">
        {visible.map((item) => (
          <li key={`${item.kind}-${item.id}`} className="rounded-lg bg-surface-2 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{item.title}</p>
                <p className="metric mt-0.5 text-[11px] text-ink-faint">
                  {item.kind === "movie" ? "Film" : "TV"}
                  {item.year ? ` · ${item.year}` : ""}
                  {item.quality ? ` · ${item.quality}` : ""}
                </p>
                <p className="metric mt-0.5 text-[11px]">
                  <span className="text-ink-secondary">
                    {item.size > 0 ? formatBytes(item.size) : "no file"}
                  </span>
                  {item.kind === "series" ? (
                    <span
                      style={{
                        color:
                          item.completeness >= 1 ? "var(--text-faint)" : "var(--status-warning)",
                      }}
                    >
                      {" "}
                      · {item.episodeFileCount}/{item.episodeCount} eps
                    </span>
                  ) : null}
                </p>
              </div>
              <ActionButton
                action={item.kind === "movie" ? "radarr.search" : "sonarr.search"}
                params={{ id: item.id }}
                label="Search"
                size="xs"
              />
            </div>
          </li>
        ))}
      </ul>

      {rows.length > limit ? (
        <button
          type="button"
          onClick={() => setLimit((value) => value + 100)}
          className="mx-auto rounded-lg bg-surface-2 px-4 py-2 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-3 hover:text-ink"
        >
          Show 100 more ({formatNumber(rows.length - limit)} remaining)
        </button>
      ) : null}

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-muted">Nothing matches those filters.</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function LibraryView() {
  const slot = useSlot("library");
  const library = slot.data;
  const { items, error: itemsError } = useLibraryItems();

  if (slot.status === "not-configured") {
    return (
      <Panel span="full">
        <PanelBody>
          <NotConfigured
            service="Sonarr / Radarr"
            hint="Connect either one to see your library."
          />
        </PanelBody>
      </Panel>
    );
  }

  if (!library) {
    return (
      <Panel span="full">
        <PanelBody>
          <div className="skeleton h-64 w-full" />
        </PanelBody>
      </Panel>
    );
  }

  const { movies, series, plexLibraries } = library;

  // Plex and the *arr apps counting differently is a real signal (files Plex
  // hasn't scanned), so it's surfaced rather than reconciled away.
  const plexMovies = plexLibraries.find((entry) => entry.type === "movie");
  const plexShows = plexLibraries.find((entry) => entry.type === "show");
  const movieDrift = plexMovies ? movies.withFile - plexMovies.count : null;

  return (
    <>
      <Panel span="full">
        <PanelHeader
          title="Totals"
          meta="Sonarr + Radarr"
          action={<Freshness fetchedAt={slot.fetchedAt} mode={slot.mode} />}
        />
        <PanelBody>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {[
              {
                label: "Movies",
                value: formatNumber(movies.total),
                sub: `${formatNumber(movies.withFile)} on disk · ${formatNumber(movies.missing)} missing`,
              },
              {
                label: "Series",
                value: formatNumber(series.total),
                sub: `${formatNumber(series.continuing)} continuing · ${formatNumber(series.ended)} ended`,
              },
              {
                label: "Episodes",
                value: formatNumber(series.episodeFileCount),
                sub: `${formatNumber(series.missingEpisodes)} missing of ${formatNumber(series.episodeCount)}`,
              },
              {
                label: "Unmonitored",
                value: formatNumber(movies.unmonitored + series.unmonitored),
                sub: `${formatNumber(movies.unmonitored)} films · ${formatNumber(series.unmonitored)} series`,
              },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl bg-surface-2 p-3.5">
                <p className="label-muted">{stat.label}</p>
                <p className="metric mt-1.5 text-2xl leading-none font-semibold text-ink sm:text-[28px]">
                  {stat.value}
                </p>
                <p className="metric mt-1.5 text-[11px] text-ink-faint">{stat.sub}</p>
              </div>
            ))}
          </div>

          {plexLibraries.length > 0 ? (
            <div className="mt-4 border-t border-[var(--glass-border)] pt-3">
              <p className="label-muted mb-2">Plex&apos;s own count</p>
              <div className="flex flex-wrap gap-4">
                {plexLibraries.map((entry) => (
                  <div key={entry.name} className="flex items-baseline gap-2">
                    <span className="text-sm text-ink-secondary">{entry.name}</span>
                    <span className="metric text-sm font-semibold text-ink">
                      {formatNumber(entry.count)}
                    </span>
                    {entry.childCount ? (
                      <span className="metric text-[11px] text-ink-faint">
                        {formatNumber(entry.childCount)} episodes
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
              {movieDrift !== null && Math.abs(movieDrift) > 0 ? (
                <div className="mt-2">
                  <InfoNote>
                    Radarr has {Math.abs(movieDrift)} {Math.abs(movieDrift) === 1 ? "film" : "films"}{" "}
                    {movieDrift > 0 ? "more" : "fewer"} than Plex. Usually means Plex hasn&apos;t
                    scanned recent imports yet — worth a library scan if it persists.
                  </InfoNote>
                </div>
              ) : null}
              {plexShows ? null : null}
            </div>
          ) : null}
        </PanelBody>
      </Panel>

      <Distribution title="By quality" buckets={library.byQuality} />
      <Distribution title="By codec" buckets={library.byCodec} />

      <Panel span="full">
        <PanelHeader title="Everything" meta={`${formatNumber(library.itemCount)} titles`} />
        <PanelBody>
          {itemsError ? (
            <p className="py-8 text-center text-sm text-ink-muted">{itemsError}</p>
          ) : items === null ? (
            <div className="skeleton h-64 w-full" />
          ) : (
            <ItemTable items={items} />
          )}
        </PanelBody>
      </Panel>
    </>
  );
}
