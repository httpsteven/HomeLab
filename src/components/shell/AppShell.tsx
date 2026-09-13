"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  HardDrive,
  LayoutGrid,
  Library,
  Settings2,
  Cpu,
  Clapperboard,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Search } from "lucide-react";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { Logo } from "@/components/ui/Logo";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { PaletteProvider, usePalette } from "@/components/palette/PaletteProvider";

const NAV = [
  { href: "/", label: "Overview", Icon: LayoutGrid },
  { href: "/storage", label: "Storage", Icon: HardDrive },
  { href: "/library", label: "Library", Icon: Library },
  { href: "/activity", label: "Activity", Icon: Activity },
  { href: "/health", label: "Health", Icon: Cpu },
  { href: "/shorts", label: "Shorts", Icon: Clapperboard },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <PaletteProvider>
      <Shell>{children}</Shell>
      <CommandPalette />
    </PaletteProvider>
  );
}

/**
 * The palette trigger.
 *
 * Shows the keyboard shortcut on desktop, where that's the fast path, and
 * collapses to an icon button on mobile — where there is no ⌘K, so the button
 * IS the only way in.
 */
function PaletteTrigger() {
  const { setOpen } = usePalette();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // Explicit name: the visible label sits beside a ⌘K hint, and relying
        // on concatenated content left this button unnamed in the
        // accessibility tree.
        aria-label="Search titles, pages and actions"
        aria-keyshortcuts="Meta+K Control+K"
        className="hidden items-center gap-2 rounded-lg bg-surface-2 py-1.5 pr-2 pl-2.5 text-xs text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink-secondary md:flex"
      >
        <Search size={13} aria-hidden />
        <span>Search</span>
        <kbd className="metric rounded border border-[var(--glass-border)] px-1.5 py-0.5 text-[10px]">
          ⌘K
        </kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search titles, pages and actions"
        className="grid size-9 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink-secondary md:hidden"
      >
        <Search size={16} aria-hidden />
      </button>
    </>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="relative z-10 flex min-h-dvh flex-col">
      {/* --- Top bar. On mobile this holds only identity + connection state;
              navigation moves to the bottom bar where thumbs are. --- */}
      <header className="sticky top-0 z-30 border-b border-[var(--glass-border)] bg-[rgba(11,11,12,0.72)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Home lab dashboard, overview">
            <Logo size={26} />
            <span className="hidden text-sm font-semibold tracking-tight sm:block">Home Lab</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-0.5 md:flex" aria-label="Primary">
            {NAV.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive(href)
                    ? "bg-surface-3 text-ink"
                    : "text-ink-muted hover:bg-surface-2 hover:text-ink-secondary",
                )}
              >
                <Icon size={15} strokeWidth={2} aria-hidden />
                {label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <PaletteTrigger />
            <ConnectionIndicator />
            <Link
              href="/setup"
              aria-current={pathname.startsWith("/setup") ? "page" : undefined}
              aria-label="Setup and connections"
              className={cn(
                "grid size-9 place-items-center rounded-lg transition-colors",
                pathname.startsWith("/setup")
                  ? "bg-surface-3 text-ink"
                  : "text-ink-muted hover:bg-surface-2 hover:text-ink-secondary",
              )}
            >
              <Settings2 size={16} strokeWidth={2} aria-hidden />
            </Link>
          </div>
        </div>
      </header>

      <main
        id="main"
        className="mx-auto w-full max-w-[1600px] flex-1 px-3 pt-4 pb-24 sm:px-6 sm:pb-8"
      >
        {children}
      </main>

      {/* --- Mobile bottom nav. 44px+ touch targets, safe-area aware. --- */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--glass-border)] bg-[rgba(11,11,12,0.9)] backdrop-blur-xl md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-stretch justify-around">
          {NAV.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className={cn(
                "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors",
                isActive(href) ? "text-accent" : "text-ink-muted",
              )}
            >
              <Icon size={19} strokeWidth={2} aria-hidden />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {description ? (
          <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
