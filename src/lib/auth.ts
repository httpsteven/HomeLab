/**
 * A single shared password, and a signed cookie to remember it.
 *
 * Deliberately not accounts, roles or OAuth. This guards one person's home
 * lab on a tailnet; the threat is a device on the LAN reaching port 3000, not
 * a hostile tenant. A password plus a signed session is proportionate, and
 * every extra concept here is one more thing to get wrong.
 *
 * AUTH IS OFF UNTIL A PASSWORD IS SET. That is the same shape as every other
 * service in this project — unconfigured means "not in use", not "broken" —
 * and it matters more here than elsewhere, because the failure mode of a
 * half-configured auth layer is being locked out of your own dashboard.
 *
 * The session secret derives from the password when none is given separately,
 * which has a useful property: changing the password invalidates every
 * existing session, with no store to clear.
 */

const COOKIE = "homelab_session";
/** Long enough not to be a nuisance on a phone, short enough to expire. */
const SESSION_DAYS = 30;

export function authPassword(): string | null {
  return process.env.DASHBOARD_PASSWORD?.trim() || null;
}

/** Whether the dashboard is gated at all. */
export function authConfigured(): boolean {
  return authPassword() !== null;
}

export const SESSION_COOKIE = COOKIE;

function secret(): string {
  const explicit = process.env.DASHBOARD_SECRET?.trim();
  if (explicit) return explicit;
  // Falling back to the password keeps one-variable setup working. The
  // password is never transmitted in the cookie — only an HMAC made with it.
  return `derived:${authPassword() ?? ""}`;
}

async function hmac(message: string): Promise<string> {
  // Web Crypto rather than node:crypto, so this works unchanged whichever
  // runtime the proxy ends up on.
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return Buffer.from(signature).toString("base64url");
}

/** Length-independent comparison, so a mismatch leaks no timing signal. */
function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  // Compare a fixed number of bytes regardless of input length.
  let diff = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

export async function checkPassword(candidate: string): Promise<boolean> {
  const expected = authPassword();
  if (!expected) return false;
  return constantTimeEqual(candidate, expected);
}

/** `<expiry>.<signature>` — no identity to carry, so none is stored. */
export async function createSession(): Promise<{ value: string; maxAge: number }> {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const expires = Date.now() + maxAge * 1000;
  const payload = String(expires);
  return { value: `${payload}.${await hmac(payload)}`, maxAge };
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  // Signature first: an expired-but-valid token and a forged one should take
  // the same path, and the expiry is only trustworthy once it's been signed.
  if (!constantTimeEqual(signature, await hmac(payload))) return false;

  const expires = Number(payload);
  return Number.isFinite(expires) && expires > Date.now();
}
