"use client";

import { Check, Loader2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Fires one allowlisted action and reports what happened inline.
 *
 * The result appears on the button itself rather than in a toast that flies
 * away — these actions are fire-and-forget against another service, and
 * "did that work?" needs to stay answerable for more than two seconds.
 *
 * `confirm` gates anything disruptive (currently only stopping a stream)
 * behind a second, deliberate click.
 */

type State = "idle" | "loading" | "success" | "error";

interface ActionButtonProps {
  action: string;
  params?: Record<string, unknown>;
  label: string;
  icon?: ReactNode;
  size?: "xs" | "sm";
  variant?: "default" | "danger";
  /** Requires a second click, with this text as the confirmation label. */
  confirm?: string;
  className?: string;
}

export function ActionButton({
  action,
  params = {},
  label,
  icon,
  size = "sm",
  variant = "default",
  confirm,
  className,
}: ActionButtonProps) {
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);

  const run = async () => {
    if (confirm && !awaitingConfirm) {
      setAwaitingConfirm(true);
      // Reverts on its own so a stray click doesn't leave the button armed.
      setTimeout(() => setAwaitingConfirm(false), 5000);
      return;
    }

    setAwaitingConfirm(false);
    setState("loading");
    setMessage(null);

    try {
      const response = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, params }),
      });
      const result = (await response.json()) as { ok: boolean; message: string };

      setState(result.ok ? "success" : "error");
      setMessage(result.message);

      if (result.ok) {
        setTimeout(() => {
          setState("idle");
          setMessage(null);
        }, 4000);
      }
    } catch {
      setState("error");
      setMessage("Couldn't reach the dashboard server.");
    }
  };

  const sizing =
    size === "xs" ? "px-2 py-1 text-[10px] gap-1" : "px-2.5 py-1.5 text-xs gap-1.5";

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={state === "loading"}
        // 44px touch target on coarse pointers without bloating the desktop
        // button — the padding is in the pseudo-element, not the visual box.
        className={cn(
          "relative inline-flex items-center rounded-md font-medium transition-colors",
          "after:absolute after:inset-0 after:-m-2 after:content-[''] sm:after:hidden",
          sizing,
          awaitingConfirm
            ? "bg-[var(--status-critical-dim)] text-[var(--status-critical-text)]"
            : variant === "danger"
              ? "bg-surface-3 text-[var(--status-serious)] hover:bg-[var(--status-serious-dim)]"
              : "bg-surface-3 text-ink-secondary hover:bg-[#2b2b30] hover:text-ink",
          state === "loading" && "cursor-wait opacity-70",
          className,
        )}
        aria-label={awaitingConfirm ? confirm : label}
      >
        {state === "loading" ? (
          <Loader2 size={size === "xs" ? 10 : 12} className="animate-spin" aria-hidden />
        ) : state === "success" ? (
          <Check size={size === "xs" ? 10 : 12} aria-hidden />
        ) : state === "error" ? (
          <X size={size === "xs" ? 10 : 12} aria-hidden />
        ) : (
          icon
        )}
        {awaitingConfirm ? confirm : label}
      </button>

      {message ? (
        <span
          role="status"
          className="max-w-[26ch] text-right text-[10px] leading-tight"
          style={{
            color: state === "error" ? "var(--status-serious)" : "var(--text-faint)",
          }}
        >
          {message}
        </span>
      ) : null}
    </span>
  );
}
