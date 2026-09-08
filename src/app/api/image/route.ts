import { tautulli } from "@/lib/clients/tautulli";

/**
 * Poster proxy.
 *
 * Posters live behind the Tautulli API key. Rather than put that key in an
 * <img src> where it would sit in the browser's DOM, network log and history,
 * the browser asks us and we fetch it server-side.
 *
 * The `img` parameter is constrained to Plex metadata paths — it must never
 * become a general-purpose "fetch any URL through my server" endpoint.
 */

export const runtime = "nodejs";

/** Plex thumb paths look like /library/metadata/1234/thumb/1700000000. */
const ALLOWED_IMG_PATH = /^\/library\/[a-zA-Z0-9/_.-]+$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const img = url.searchParams.get("img");
  const width = Number(url.searchParams.get("w")) || 300;
  const height = Number(url.searchParams.get("h")) || 450;

  if (!img || !ALLOWED_IMG_PATH.test(img)) {
    return new Response("Invalid image path", { status: 400 });
  }

  // Clamp: an unbounded size parameter is a cheap way to make the server do
  // expensive work on someone else's behalf.
  const safeWidth = Math.min(Math.max(width, 40), 1200);
  const safeHeight = Math.min(Math.max(height, 40), 1800);

  const target = tautulli.imageUrl(img, safeWidth, safeHeight);
  if (!target) {
    return new Response("Tautulli not configured", { status: 503 });
  }

  try {
    const upstream = await fetch(target, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });

    if (!upstream.ok || !upstream.body) {
      return new Response("Image unavailable", { status: 502 });
    }

    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
        // Posters are immutable for a given rating key; caching them keeps
        // the poster wall from re-fetching on every poll.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Image request failed", { status: 502 });
  }
}
