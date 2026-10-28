import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authConfigured, verifySession } from "@/lib/auth";

/**
 * The gate.
 *
 * `proxy.ts` is what Next 16 calls what used to be middleware — same
 * behaviour, new name and location.
 *
 * Next's own guidance is that this layer is for OPTIMISTIC checks, not the
 * whole authorization story, and that's how it's used here: it keeps an
 * unauthenticated browser off the pages, while /api/action verifies the
 * session again on its own before running anything. A redirect is a
 * convenience; the check that actually matters sits next to the side effect.
 *
 * With no password configured this is a no-op, so the dashboard behaves
 * exactly as it did before anyone opted in.
 */

/** Reachable without a session: the login flow and the icons the page needs. */
const PUBLIC_PATHS = new Set(["/login", "/api/auth", "/icon.svg", "/manifest.webmanifest"]);

export async function proxy(request: NextRequest) {
  if (!authConfigured()) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith("/apple-icon")) {
    return NextResponse.next();
  }

  if (await verifySession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  // An API caller gets a status it can act on; a browser gets the login page.
  // Redirecting fetch() to HTML is how a 401 turns into a confusing parse
  // error three layers away.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  // Come back to where they were aiming, but only ever to a path on this
  // site — an absolute URL here would make this an open redirect.
  if (pathname !== "/") login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next's own static output and the public files it serves
  // directly; those carry no data worth gating and matching them would put
  // this function in front of every image request.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|newsletter/banner.png).*)"],
};
