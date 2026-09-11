import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The bento tile.
 *
 * `span` maps a tile to columns/rows on the 12-column bento grid. Tile size
 * is meant to track *importance*, and importance changes with state — a mount
 * at 94% promotes itself to a wider tile. That's why span is a prop rather
 * than a fixed layout: pages compute it from data.
 */

export type PanelSpan = "sm" | "md" | "lg" | "xl" | "full";

/**
 * Span is a size PREFERENCE, not a fixed column count.
 *
 * A rigid 12-column grid can't tile tiles whose spans change with state: an
 * "all clear" health tile shrinking from 6 columns to 3 leaves a hole that
 * nothing else fits into, and dense packing can only fill it if some later
 * tile happens to be exactly the right width. The result is ragged rows with
 * dead space on the right.
 *
 * So the grid is flex-wrap instead. Each tile declares a preferred width as a
 * flex-basis and is allowed to grow: whatever slack is left on a row gets
 * distributed across the tiles in it, so every row reaches the right edge no
 * matter which combination of sizes lands there. Relative importance still
 * shows, because a tile that prefers 760px stays visibly wider than one that
 * prefers 360px.
 */
const SPAN_CLASSES: Record<PanelSpan, string> = {
  // Mobile is a single column; the basis only takes effect from `sm` up.
  sm: "basis-full sm:basis-[260px]",
  md: "basis-full sm:basis-[360px]",
  lg: "basis-full sm:basis-[540px]",
  xl: "basis-full sm:basis-[780px]",
  full: "basis-full",
};

interface PanelProps {
  children: ReactNode;
  className?: string;
  span?: PanelSpan;
  /** Adds the live glow — reserved for tiles showing actively updating data. */
  live?: boolean;
  as?: "section" | "div" | "article";
}

export function Panel({ children, className, span = "md", live = false, as = "section" }: PanelProps) {
  const Component = as;
  return (
    <Component
      className={cn(
        // min-w-0 matters: without it a long unbroken string (a release name)
        // sets the flex base size and blows the tile past its share.
        "glass flex min-w-0 grow flex-col overflow-hidden",
        SPAN_CLASSES[span],
        live && "is-live",
        className,
      )}
    >
      {children}
    </Component>
  );
}

interface PanelHeaderProps {
  title: string;
  /** Short qualifier — a count, a source, a scope. */
  meta?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function PanelHeader({ title, meta, icon, action, className }: PanelHeaderProps) {
  return (
    <header
      className={cn(
        "flex items-center gap-2.5 px-4 pt-3.5 pb-2 sm:px-5",
        className,
      )}
    >
      {icon ? <span className="text-ink-muted shrink-0">{icon}</span> : null}
      <h2 className="label-muted truncate">{title}</h2>
      {meta ? <span className="metric text-[11px] text-ink-faint shrink-0">{meta}</span> : null}
      {action ? <div className="ml-auto shrink-0">{action}</div> : null}
    </header>
  );
}

export function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex-1 px-4 pb-4 sm:px-5 sm:pb-5", className)}>{children}</div>;
}

/**
 * Column layout, for pages whose tiles vary wildly in height.
 *
 * Rows are the problem: in both a grid and a flex-wrap, a row is as tall as
 * its tallest member, so a short tile beside a tall one leaves dead space
 * underneath it that nothing can fill. Columns don't have rows — each one
 * stacks independently and is exactly as tall as its own contents, so the only
 * empty space left is below the shortest column.
 *
 * Tiles are assigned to a column deliberately rather than flowed
 * automatically. With data updating every couple of seconds, automatic
 * balancing (CSS `columns`) would let a tile jump between columns whenever its
 * height changed, which is far more distracting than a little raggedness at
 * the bottom.
 *
 * The child overrides neutralise the flex-basis each Panel carries for the
 * wrap layout; inside a column a tile simply fills the width.
 */
const COLUMN = "flex min-w-0 flex-col gap-3 sm:gap-4 [&>*]:!basis-auto [&>*]:!grow-0 [&>*]:w-full";

export function BentoColumns({
  primary,
  secondary,
  footer,
}: {
  primary: ReactNode;
  secondary: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row">
        {/* Wider, because it carries the tiles with the most to show. */}
        <div className={cn(COLUMN, "flex-1 lg:flex-[1.35]")}>{primary}</div>
        <div className={cn(COLUMN, "flex-1")}>{secondary}</div>
      </div>
      {footer ? <div className={COLUMN}>{footer}</div> : null}
    </div>
  );
}

/** The 12-column bento grid every page composes into. */
export function BentoGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        // items-start stops a tall tile from stretching its neighbours into
        // hundreds of pixels of dead space — an 11-warning health list was
        // doing exactly that to the capacity tile beside it.
        "flex flex-wrap items-start gap-3 sm:gap-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Empty state for a service that isn't wired up. Deliberately calm — an
 * unconfigured service is a normal state, not an error, so it must not look
 * like one.
 */
export function NotConfigured({ service, hint }: { service: string; hint?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-8 text-center">
      <p className="text-sm text-ink-muted">{service} isn&apos;t connected</p>
      <p className="max-w-[28ch] text-xs text-ink-faint">
        {hint ?? "Add its URL and API key, then reload."}
      </p>
      <a
        href="/setup"
        className="mt-1 rounded-md px-2 py-1 text-xs font-medium text-accent underline underline-offset-4 hover:bg-surface-3"
      >
        Open setup
      </a>
    </div>
  );
}

export function PanelError({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-8 text-center">
      <p className="text-sm text-[var(--status-serious)]">Couldn&apos;t load this</p>
      <p className="max-w-[36ch] text-xs text-ink-faint">{message}</p>
    </div>
  );
}
