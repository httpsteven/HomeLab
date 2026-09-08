import "server-only";
import { tautulli, type StreamSession } from "@/lib/clients/tautulli";
import { extractAccentColor } from "@/lib/color";
import type { ActivityState, StreamView } from "@/lib/types";

/**
 * Now-playing aggregation.
 *
 * Tautulli is the source here rather than Plex directly: Plex's /status/sessions
 * tells you a transcode is happening, but Tautulli tells you *what* is being
 * transcoded and why, plus real bandwidth — which is the part you actually
 * want when a stream is struggling.
 */

function toTranscodeLabel(session: StreamSession): StreamView["transcode"] {
  const decision = session.transcode_decision;
  if (decision === "transcode") return "transcode";
  if (decision === "copy") return "direct stream";
  return "direct play";
}

/**
 * "4K HEVC → 1080p H.264" — the one-line answer to "why is my server hot".
 * Only shows an arrow when something is actually being converted.
 */
function qualitySummary(session: StreamSession): string | null {
  const source = [session.video_resolution, session.video_codec?.toUpperCase()]
    .filter(Boolean)
    .join(" ");
  if (!source) return null;

  const isTranscoding = session.transcode_decision === "transcode";
  if (!isTranscoding) return source;

  const target = [session.stream_video_resolution, session.quality_profile]
    .filter(Boolean)
    .join(" ");
  return target ? `${source} → ${target}` : source;
}

function subtitleFor(session: StreamSession): string | null {
  if (session.media_type === "episode") {
    const show = session.grandparent_title;
    const episode = session.parent_title ? `${session.parent_title} · ${session.title}` : session.title;
    return show ? `${show} — ${episode}` : episode;
  }
  if (session.media_type === "track") {
    return [session.grandparent_title, session.parent_title].filter(Boolean).join(" — ") || null;
  }
  return session.year || null;
}

function displayTitle(session: StreamSession): string {
  if (session.media_type === "episode") return session.grandparent_title || session.full_title;
  return session.title || session.full_title;
}

export class ActivityUnavailableError extends Error {}

export async function buildActivityState(): Promise<ActivityState> {
  const result = await tautulli.activity();

  const empty: ActivityState = {
    streams: [],
    totalBandwidthKbps: 0,
    lanBandwidthKbps: 0,
    wanBandwidthKbps: 0,
    counts: { total: 0, directPlay: 0, directStream: 0, transcode: 0 },
    accent: null,
  };

  // A reachable Tautulli with nothing playing is an empty result, which is
  // fine. An unreachable one must surface as a failure so the collector backs
  // off instead of retrying a dead host every 2 seconds forever.
  if (!result.ok) throw new ActivityUnavailableError(result.message);
  if (!result.data) return empty;

  const activity = result.data;
  const sessions = activity.sessions ?? [];

  const streams: StreamView[] = sessions.map((session) => {
    const thumb =
      session.media_type === "episode"
        ? session.grandparent_thumb || session.thumb
        : session.thumb || session.parent_thumb;

    return {
      id: session.session_key || session.session_id,
      title: displayTitle(session),
      subtitle: subtitleFor(session),
      user: session.friendly_name || session.user,
      player: session.player,
      platform: session.platform,
      state: session.state,
      progress: Number(session.progress_percent) / 100 || 0,
      durationMs: Number(session.duration) || 0,
      positionMs: Number(session.view_offset) || 0,
      bandwidthKbps: Number(session.bandwidth) || 0,
      transcode: toTranscodeLabel(session),
      videoDecision: session.video_decision || null,
      audioDecision: session.audio_decision || null,
      qualitySummary: qualitySummary(session),
      location: session.location === "lan" ? "lan" : session.location === "wan" ? "wan" : "unknown",
      isSecure: session.secure === 1,
      // Routed through our own proxy so the Tautulli key never hits the browser.
      posterUrl: thumb ? `/api/image?img=${encodeURIComponent(thumb)}` : null,
      mediaType: session.media_type,
      ratingKey: session.rating_key || null,
    };
  });

  /* --- Ambient accent -------------------------------------------------
     Sampled from whatever is playing. Multiple streams: the first playing
     one wins, so the color doesn't flicker between sessions. */
  let accent: string | null = null;
  const primary = streams.find((stream) => stream.state === "playing") ?? streams[0];
  if (primary?.ratingKey) {
    const session = sessions.find(
      (s) => (s.session_key || s.session_id) === primary.id,
    );
    const thumb =
      session &&
      (session.media_type === "episode"
        ? session.grandparent_thumb || session.thumb
        : session.thumb || session.parent_thumb);
    const directUrl = thumb ? tautulli.imageUrl(thumb, 200, 300) : null;
    if (directUrl) {
      accent = await extractAccentColor(directUrl, primary.ratingKey);
    }
  }

  return {
    streams,
    totalBandwidthKbps: activity.total_bandwidth ?? 0,
    lanBandwidthKbps: activity.lan_bandwidth ?? 0,
    wanBandwidthKbps: activity.wan_bandwidth ?? 0,
    counts: {
      total: Number(activity.stream_count) || streams.length,
      directPlay: activity.stream_count_direct_play ?? 0,
      directStream: activity.stream_count_direct_stream ?? 0,
      transcode: activity.stream_count_transcode ?? 0,
    },
    accent,
  };
}
