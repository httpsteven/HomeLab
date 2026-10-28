import { bazarr } from "@/lib/clients/bazarr";

/**
 * Bazarr's task schedule.
 *
 * Read-only, and separate from the SSE stream: this changes on the scale of
 * hours and only one panel wants it, so streaming it to every client would
 * cost more than it's worth.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await bazarr.tasks();

  if (!result.ok) {
    return Response.json(
      { ok: false, message: result.message },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    { ok: true, tasks: result.data?.data ?? [] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
