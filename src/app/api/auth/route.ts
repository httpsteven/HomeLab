import {
  SESSION_COOKIE,
  authConfigured,
  checkPassword,
  createSession,
  verifySession,
} from "@/lib/auth";

/**
 * Sign in and out.
 *
 * Public by necessity — it's what the proxy lets through so a password can be
 * offered in the first place.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!authConfigured()) {
    return Response.json(
      { ok: false, message: "No password is set, so there is nothing to sign in to." },
      { status: 400 },
    );
  }

  let body: { password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: "Invalid request." }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (!(await checkPassword(password))) {
    // Deliberately vague, and deliberately slow enough to make a script
    // tedious without making a human wait.
    await new Promise((resolve) => setTimeout(resolve, 400));
    return Response.json({ ok: false, message: "Wrong password." }, { status: 401 });
  }

  const session = await createSession();
  const response = Response.json({ ok: true, message: "Signed in." });
  response.headers.append(
    "Set-Cookie",
    [
      `${SESSION_COOKIE}=${session.value}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${session.maxAge}`,
      // Secure is set only when the request arrived over HTTPS: the tailnet
      // name is HTTPS, but a LAN visit over plain http would silently drop a
      // Secure cookie and leave you unable to sign in at all.
      new URL(request.url).protocol === "https:" ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; "),
  );
  return response;
}

export async function DELETE() {
  const response = Response.json({ ok: true, message: "Signed out." });
  response.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
  return response;
}

/** Whether the dashboard is gated, and whether this caller is through it. */
export async function GET(request: Request) {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);

  return Response.json(
    { configured: authConfigured(), signedIn: await verifySession(token) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
