"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Sortable column header.
 *
 * Defined at module scope on purpose. Declaring this inside a table
 * component's render creates a brand-new component type every render, so
 * React unmounts and remounts the button on each state change — which throws
 * away keyboard focus mid-interaction and makes the header unusable without
 * a mouse.
 *
 * `aria-sort` belongs on the <th>, not on the button (the role doesn't
 * support it), so the header cell owns that and this owns the label.
 */

export type SortDirection = "asc" | "desc";

export function SortButton<T extends string>({
  column,
  label,
  activeColumn,
  descending,
  onSort,
  align = "left",
}: {
  column: T;
  label: string;
  activeColumn: T;
  descending: boolean;
  onSort: (column: T) => void;
  align?: "left" | "right";
}) {
  const isActive = activeColumn === column;

  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className={cn(
        "flex items-center gap-1 transition-colors hover:text-ink",
        align === "right" && "ml-auto",
        isActive ? "text-ink" : "text-ink-muted",
      )}
      title={`Sort by ${label}`}
    >
      {label}
      {isActive ? (
        descending ? (
          <ArrowDown size={11} aria-hidden />
        ) : (
          <ArrowUp size={11} aria-hidden />
        )
      ) : null}
      <span className="sr-only">
        {isActive ? `, sorted ${descending ? "descending" : "ascending"}` : ""}
      </span>
    </button>
  );
}

/** The aria-sort value for a header cell. */
export function ariaSort(
  isActive: boolean,
  descending: boolean,
): "ascending" | "descending" | "none" {
  if (!isActive) return "none";
  return descending ? "descending" : "ascending";
}
