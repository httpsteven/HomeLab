"use client";

import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";

/**
 * Only rendered once a password is actually configured.
 *
 * A sign-out control on an ungated dashboard is a button that logs you out of
 * nothing, which reads as a broken feature rather than an absent one.
 */
export function SignOutButton() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    fetch("/api/auth")
      .then((response) => response.json())
      .then((payload: { configured: boolean; signedIn: boolean }) =>
        setShow(payload.configured && payload.signedIn),
      )
      .catch(() => {});
  }, []);

  if (!show) return null;

  return (
    <button
      type="button"
      aria-label="Sign out"
      title="Sign out"
      onClick={async () => {
        await fetch("/api/auth", { method: "DELETE" }).catch(() => {});
        // A hard reload, deliberately: router.push would keep the SSE stream
        // and every cached fetch from the session that just ended.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = "/login";
      }}
      className="grid size-9 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink-secondary"
    >
      <LogOut size={16} strokeWidth={2} aria-hidden />
    </button>
  );
}
