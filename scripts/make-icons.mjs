import { readFile, writeFile, mkdir } from "node:fs/promises";
import sharp from "sharp";

const svg = await readFile("src/app/icon.svg");

// Apple touch icons must be PNG and are shown on an opaque tile, so the
// rounded corners are baked in rather than left transparent.
await writeFile("src/app/apple-icon.png", await sharp(svg).resize(180, 180).png().toBuffer());

await mkdir("public/icons", { recursive: true });
for (const size of [192, 512]) {
  await writeFile(`public/icons/icon-${size}.png`, await sharp(svg).resize(size, size).png().toBuffer());
}

// A maskable icon needs padding: Android crops to a circle, which would slice
// the corners off the tile. 20% inset keeps the mark inside the safe zone.
const inner = Math.round(512 * 0.62);
const pad = Math.round((512 - inner) / 2);
await writeFile(
  "public/icons/maskable-512.png",
  await sharp({ create: { width: 512, height: 512, channels: 4, background: "#0b0b0c" } })
    .composite([{ input: await sharp(svg).resize(inner, inner).png().toBuffer(), top: pad, left: pad }])
    .png()
    .toBuffer(),
);

console.log("icons written");
