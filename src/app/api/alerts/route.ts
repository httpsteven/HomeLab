import { alertsStatus } from "@/lib/alerts";

/**
 * Alert configuration and history, for the Health page.
 *
 * Not part of the SSE stream: it changes rarely, and only one panel needs it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await alertsStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
