import { mailConfig } from "@/lib/newsletter/send";
import { latestIssue, listIssues, loadIssue } from "@/lib/newsletter/store";

/**
 * The current issue, or one from the archive via ?id=YYYY-MM-DD.
 *
 * Separate from the SSE stream: issues change weekly, and only one page wants
 * them.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  const issue = id ? await loadIssue(id) : await latestIssue();
  const config = await mailConfig();

  return Response.json(
    {
      issue,
      archive: await listIssues(),
      mail: {
        // Never the credentials — only whether they're present, which is all
        // the UI needs to tell you what to fix.
        configured: config.configured,
        enabled: config.enabled,
        viewerRecipients: config.viewerRecipients.length,
        adminRecipients: config.adminRecipients.length,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
