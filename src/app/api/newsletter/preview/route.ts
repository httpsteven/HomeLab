import {
  BANNER_URL,
  proxyPosterSrc,
  renderIssueHtml,
  renderIssueText,
} from "@/lib/newsletter/email";
import { latestIssue, loadIssue } from "@/lib/newsletter/store";
import type { Edition } from "@/lib/newsletter/types";

/**
 * Renders an issue exactly as the email will, in a browser.
 *
 * The same renderer the mailer uses — not a second copy, which would drift.
 * Only the image source differs: the preview points at the dashboard's proxy,
 * since `cid:` references only resolve inside a mail client.
 *
 * Worth having beyond testing: it's the one way to see what a viewer will
 * receive before anyone receives it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const edition: Edition = params.get("edition") === "viewer" ? "viewer" : "admin";
  const id = params.get("id");

  const issue = id ? await loadIssue(id) : await latestIssue();
  if (!issue) {
    return new Response("No issue yet. Generate one first.", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (params.get("format") === "text") {
    return new Response(renderIssueText(issue, edition), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  return new Response(
    renderIssueHtml(issue, edition, {
      posterSrc: proxyPosterSrc,
      dashboardUrl: null,
      // The preview loads it over HTTP; a real send attaches it.
      bannerSrc: BANNER_URL,
    }),
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}
