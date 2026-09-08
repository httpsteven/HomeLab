import "server-only";
import sharp from "sharp";

/**
 * Samples a dominant color from a poster and normalizes it into an accent
 * that actually works on a near-black surface.
 *
 * A raw dominant color is usually unusable: posters are full of muddy browns,
 * near-blacks and blown-out whites. So we downsample, discard pixels that are
 * too dark, too light or too gray to carry identity, average what's left in a
 * hue-aware way, then clamp saturation and lightness into a band that reads as
 * a deliberate accent rather than a smear.
 *
 * This only ever drives the decorative ambient wash — never a data mark.
 */

/**
 * Negative results are cached too (as null).
 *
 * Without that, a poster that can't be fetched or has no usable color would
 * re-run the download AND the sharp decode on every single activity poll —
 * every 2 seconds, forever, for a decorative background tint.
 */
const CACHE_MAX = 200;
const cache = new Map<string, string | null>();

function remember(key: string, value: string | null): string | null {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
  return value;
}

/** Accent band: vivid enough to register, never so bright it competes. */
const MIN_SATURATION = 0.45;
const MAX_SATURATION = 0.9;
const MIN_LIGHTNESS = 0.45;
const MAX_LIGHTNESS = 0.68;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;

  if (max === min) return [0, 0, lightness];

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let hue: number;
  if (max === rn) hue = ((gn - bn) / delta + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) hue = ((bn - rn) / delta + 2) / 6;
  else hue = ((rn - gn) / delta + 4) / 6;

  return [hue, saturation, lightness];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const value = Math.round(l * 255);
    return [value, value, value];
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
}

export async function extractAccentColor(imageUrl: string, cacheKey: string): Promise<string | null> {
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;

  try {
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (!response.ok) return remember(cacheKey, null);

    const buffer = Buffer.from(await response.arrayBuffer());

    // 32x32 is plenty — we want the overall cast, not detail.
    const { data, info } = await sharp(buffer)
      .resize(32, 32, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Average hue on the unit circle so reds either side of 0° don't cancel
    // out to cyan — the classic bug in naive hue averaging.
    let sinSum = 0;
    let cosSum = 0;
    let satSum = 0;
    let lightSum = 0;
    let weightSum = 0;

    const channels = info.channels;
    for (let i = 0; i < data.length; i += channels) {
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);

      // Skip pixels that can't carry identity: letterboxing, blown highlights,
      // and near-grays (which would just drag everything toward mud).
      if (l < 0.12 || l > 0.92 || s < 0.15) continue;

      // Weight by saturation — the vivid pixels are what a viewer perceives
      // as "the color of this poster".
      const weight = s * s;
      const angle = h * Math.PI * 2;
      sinSum += Math.sin(angle) * weight;
      cosSum += Math.cos(angle) * weight;
      satSum += s * weight;
      lightSum += l * weight;
      weightSum += weight;
    }

    // A poster with nothing colorful in it (black-and-white, heavy grade)
    // gets no accent rather than a made-up one.
    if (weightSum < 0.5) return remember(cacheKey, null);

    let hue = Math.atan2(sinSum / weightSum, cosSum / weightSum) / (Math.PI * 2);
    if (hue < 0) hue += 1;

    const saturation = Math.min(Math.max(satSum / weightSum, MIN_SATURATION), MAX_SATURATION);
    const lightness = Math.min(Math.max(lightSum / weightSum, MIN_LIGHTNESS), MAX_LIGHTNESS);

    const [r, g, b] = hslToRgb(hue, saturation, lightness);
    return remember(cacheKey, toHex(r, g, b));
  } catch {
    // An accent color is pure decoration — never let it break the page, and
    // never let a failing poster cost a fetch every poll.
    return remember(cacheKey, null);
  }
}

/** Hex → "r, g, b" so the client can build rgba() glows at any opacity. */
export function hexToRgbTriplet(hex: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const int = parseInt(match[1], 16);
  return `${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}`;
}
