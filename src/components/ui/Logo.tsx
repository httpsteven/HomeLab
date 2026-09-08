/**
 * The Home Lab mark.
 *
 * Kept as inline SVG rather than an <img> of icon.svg so it inherits the
 * theme tokens — if the accent changes, the roofline follows automatically
 * instead of drifting out of sync with the rest of the UI.
 *
 * The favicon and app icons are generated from src/app/icon.svg, which is the
 * same geometry with the colours hardcoded (a favicon has no CSS to inherit).
 * Change one, run `node scripts/make-icons.mjs`, and update the other.
 */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <rect width="32" height="32" rx="7.5" fill="var(--surface-3)" />
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="7"
        stroke="#fff"
        strokeOpacity="0.10"
      />
      <path
        d="M8 14.5 L16 8 L24 14.5"
        stroke="var(--accent)"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="9" y="16.9" width="14" height="2.9" rx="1.45" fill="var(--text-secondary)" />
      <rect x="9" y="21.6" width="8.5" height="2.9" rx="1.45" fill="var(--text-muted)" />
    </svg>
  );
}
