"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CompactLibraryItem } from "@/app/api/library-items/route";

/**
 * Open state, the global hotkey, and the lazily-fetched title index.
 *
 * The index is fetched on FIRST OPEN, not on mount. The compact payload is
 * still ~60 KB, and a palette nobody opens should cost nothing — loading it
 * eagerly on every page would tax the common case to speed up the rare one.
 * Once fetched it stays in memory for the session.
 */

interface PaletteContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  items: CompactLibraryItem[] | null;
  loading: boolean;
  error: string | null;
}

const PaletteContext = createContext<PaletteContextValue>({
  open: false,
  setOpen: () => {},
  items: null,
  loading: false,
  error: null,
});

export function PaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const [items, setItems] = useState<CompactLibraryItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Remembers what had focus so it can be restored on close — otherwise
  // dismissing the palette drops keyboard users at the top of the document.
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const fetchStarted = useRef(false);

  const loadIndex = useCallback(() => {
    if (fetchStarted.current) return;
    fetchStarted.current = true;
    setLoading(true);

    fetch("/api/library-items?compact=1")
      .then((response) => response.json())
      .then((payload: { items: CompactLibraryItem[]; error: string | null }) => {
        setItems(payload.items ?? []);
        setError(payload.error);
      })
      .catch(() => {
        setError("Couldn't load the library index.");
        // Allow a retry on the next open rather than failing permanently.
        fetchStarted.current = false;
      })
      .finally(() => setLoading(false));
  }, []);

  const setOpen = useCallback(
    (next: boolean) => {
      if (next) {
        restoreFocusTo.current = document.activeElement as HTMLElement | null;
        loadIndex();
      } else {
        restoreFocusTo.current?.focus?.();
      }
      setOpenState(next);
    },
    [loadIndex],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isPaletteKey = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isPaletteKey) {
        event.preventDefault();
        setOpen(!open);
        return;
      }

      // "/" is the other conventional search key, but only when the user
      // isn't already typing into something.
      if (event.key === "/" && !open) {
        const target = event.target as HTMLElement | null;
        const typing =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target?.isContentEditable;
        if (!typing) {
          event.preventDefault();
          setOpen(true);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  const value = useMemo(
    () => ({ open, setOpen, items, loading, error }),
    [open, setOpen, items, loading, error],
  );

  return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>;
}

export function usePalette() {
  return useContext(PaletteContext);
}
