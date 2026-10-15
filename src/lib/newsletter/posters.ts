import "server-only";
import sharp from "sharp";
import { tautulli } from "@/lib/clients/tautulli";
import type { AddedItem } from "./types";

/**
 * Poster art for the email edition.
 *
 * Posters are FETCHED AND ATTACHED, not linked. The dashboard's image proxy
 * lives behind Tailscale and the LAN, so a linked poster is a broken image for
 * any recipient who isn't on the tailnet — which is most of the point of
 * mailing someone a newsletter. The server can reach the proxy; the recipient
 * doesn't have to.
 *
 * They're also resized hard. A full-size Plex poster is ~200 KB; a dozen of
 * them would make a multi-megabyte email that some providers silently clip.
 */

/** Width in the email layout is 68px; a bit over 2x for retina, no larger. */
const POSTER_WIDTH = 160;
/**
 * Has to cover everything the renderer draws, or later cards fall back to
 * lettered tiles mid-grid, which reads as breakage rather than as a limit.
 * Two sections of twelve, matching the cap in email.ts.
 */
const MAX_POSTERS = 24;
const FETCH_TIMEOUT_MS = 8_000;

export interface InlinePoster {
  /** Referenced from the HTML as src="cid:<cid>". */
  cid: string;
  filename: string;
  content: Buffer;
}

async function fetchPoster(thumb: string): Promise<Buffer | null> {
  const url = tautulli.imageUrl(thumb, POSTER_WIDTH, Math.round(POSTER_WIDTH * 1.5));
  if (!url) return null;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null;

    // Re-encoded rather than passed through: Plex's proxy doesn't always
    // honour the requested size, and JPEG at quality 72 is the difference
    // between a 300 KB email and a 3 MB one.
    return await sharp(Buffer.from(await response.arrayBuffer()))
      .resize(POSTER_WIDTH, Math.round(POSTER_WIDTH * 1.5), { fit: "cover" })
      .jpeg({ quality: 72, progressive: true })
      .toBuffer();
  } catch {
    // A missing poster is a cosmetic loss; the item still appears with its
    // title. Never let it fail the send.
    return null;
  }
}

/**
 * Returns attachments plus a map from item key to CID.
 *
 * Items without a usable poster simply don't appear in the map, and the
 * renderer falls back to a lettered tile.
 */
export async function buildPosters(
  items: AddedItem[],
): Promise<{ attachments: InlinePoster[]; cids: Map<string, string> }> {
  const attachments: InlinePoster[] = [];
  const cids = new Map<string, string>();

  const candidates = items.filter((item) => item.thumb).slice(0, MAX_POSTERS);

  const results = await Promise.all(
    candidates.map(async (item) => ({ item, buffer: await fetchPoster(item.thumb!) })),
  );

  for (const { item, buffer } of results) {
    if (!buffer) continue;
    // Deterministic, and safe as a Content-ID.
    const cid = `poster-${item.key.replace(/[^a-zA-Z0-9]/g, "")}@homelab`;
    cids.set(item.key, cid);
    attachments.push({ cid, filename: `${cid}.jpg`, content: buffer });
  }

  return { attachments, cids };
}
