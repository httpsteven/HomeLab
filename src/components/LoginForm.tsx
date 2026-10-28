"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, LogIn } from "lucide-react";

/**
 * The sign-in form.
 *
 * A full navigation rather than a client-side push on success: the whole app
 * below this point assumes a session, and a soft transition would leave the
 * SSE stream and every cached fetch holding results from before the cookie
 * existed.
 */
export function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState("working");
    setMessage(null);

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = (await response.json()) as { ok: boolean; message: string };

      if (!result.ok) {
        setState("error");
        setMessage(result.message);
        setPassword("");
        return;
      }

      // Only ever a path on this site. A `next` of "https://elsewhere" would
      // turn the login page into someone else's redirector.
      const next = params.get("next");
      const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
      // Hard reload for the reason in the comment above the component.
      window.location.href = target;
    } catch {
      setState("error");
      setMessage("Couldn't reach the dashboard.");
    }
  };

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="label-muted">Password</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          autoFocus
          required
          className="rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:ring-1 focus:ring-[var(--glass-border)] focus:outline-none"
        />
      </label>

      <button
        type="submit"
        disabled={state === "working" || password === ""}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-surface-3 px-3 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-[#2b2b30] disabled:opacity-50"
      >
        {state === "working" ? (
          <Loader2 size={14} className="animate-spin" aria-hidden />
        ) : (
          <LogIn size={14} aria-hidden />
        )}
        Sign in
      </button>

      {message ? (
        <p role="alert" className="text-xs" style={{ color: "var(--status-serious)" }}>
          {message}
        </p>
      ) : null}
    </form>
  );
}
