import { importingEnabled, readGapRuns } from "@/lib/collect/gap-schedule";

/**
 * What the gap filler last decided, and whether it is allowed to act.
 *
 * Separate from the SSE stream: this changes once a day and only one panel
 * reads it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET() {
  const runs = await readGapRuns();
  const last = runs[0]?.at ?? null;

  return Response.json(
    {
      // The distinction the UI has to make obvious: a run that reports what
      // it WOULD do looks identical to one that did it, unless you say so.
      applying: importingEnabled(),
      lastRunAt: last,
      nextDueAt: last === null ? null : last + DAY_MS,
      runs: runs.slice(0, 2),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
