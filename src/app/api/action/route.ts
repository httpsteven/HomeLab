import { cookies } from "next/headers";
import { ACTIONS, isKnownAction } from "@/lib/actions";
import { SESSION_COOKIE, authConfigured, verifySession } from "@/lib/auth";

/**
 * The only write endpoint in the app.
 *
 * It accepts an action NAME plus parameters, looks the name up in the
 * allowlist, and runs the handler. There is no passthrough: an unknown name
 * is rejected outright, so the browser cannot reach an arbitrary Servarr
 * command or URL even if this route is called by hand.
 *
 * The session is checked HERE as well as in the proxy. Next's own guidance is
 * that the proxy layer is an optimistic check rather than an authorization
 * boundary, and this is the one route in the app with side effects — the
 * check belongs next to the thing it protects, not only in front of it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (authConfigured()) {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!(await verifySession(token))) {
      return Response.json({ ok: false, message: "Not signed in." }, { status: 401 });
    }
  }

  let body: { action?: unknown; params?: unknown };

  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const name = typeof body.action === "string" ? body.action : "";
  if (!name || !isKnownAction(name)) {
    return Response.json(
      { ok: false, message: `Unknown action "${name}".` },
      { status: 400 },
    );
  }

  const params =
    body.params && typeof body.params === "object" && !Array.isArray(body.params)
      ? (body.params as Record<string, unknown>)
      : {};

  try {
    const result = await ACTIONS[name]({ params });
    return Response.json(result, { status: result.ok ? 200 : 502 });
  } catch (error) {
    // Handlers throw on bad parameters — that's a client error, not a crash.
    return Response.json(
      { ok: false, message: error instanceof Error ? error.message : "Action failed." },
      { status: 400 },
    );
  }
}
