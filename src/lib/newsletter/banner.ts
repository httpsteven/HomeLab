import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The masthead image.
 *
 * Attached inline for the same reason posters are: the dashboard is behind
 * Tailscale, so a linked image is a broken image for anyone who isn't on the
 * tailnet. The file lives in public/ so the in-browser preview can load it
 * over HTTP while the email carries its own copy.
 *
 * Read once and held — it's a few hundred KB and it never changes while the
 * process runs. Missing is not an error: the renderer falls back to a text
 * masthead, which is also what a plain-text-only client sees.
 */

const PATH = join(process.cwd(), "public", "newsletter", "banner.png");

export const BANNER_CID = "masthead@homelab";
export const BANNER_URL = "/newsletter/banner.png";

let cached: Buffer | null | undefined;

export async function bannerAttachment(): Promise<{
  cid: string;
  filename: string;
  content: Buffer;
} | null> {
  if (cached === undefined) {
    try {
      cached = await readFile(PATH);
    } catch {
      cached = null;
    }
  }

  return cached ? { cid: BANNER_CID, filename: "banner.png", content: cached } : null;
}
