import { ACTIONS, isKnownAction } from "@/lib/actions";

/**
 * The only write endpoint in the app.
 *
 * It accepts an action NAME plus parameters, looks the name up in the
 * allowlist, and runs the handler. There is no passthrough: an unknown name
 * is rejected outright, so the browser cannot reach an arbitrary Servarr
 * command or URL even if this route is called by hand.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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
