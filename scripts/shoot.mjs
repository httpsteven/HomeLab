/**
 * Screenshot every page at desktop and phone widths.
 *
 * Uses the system Chrome via puppeteer-core (no bundled browser download).
 * Screenshots on a timer rather than waiting for network idle — the dashboard
 * holds an SSE connection open forever, so "idle" never arrives.
 *
 *   node scripts/shoot.mjs [outDir] [baseUrl]
 */

import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const OUT = process.argv[2] ?? "shots";
const BASE = process.argv[3] ?? "http://localhost:3000";

const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const PAGES = [
  ["overview", "/"],
  ["storage", "/storage"],
  ["library", "/library"],
  ["activity", "/activity"],
  ["health", "/health"],
  ["setup", "/setup"],
];

const VIEWPORTS = [
  ["desktop", { width: 1440, height: 900, deviceScaleFactor: 2 }],
  ["phone", { width: 375, height: 812, deviceScaleFactor: 3, isMobile: true }],
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--hide-scrollbars", "--force-color-profile=srgb"],
});

await mkdir(OUT, { recursive: true });

try {
  for (const [viewportName, viewport] of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport(viewport);

    for (const [name, path] of PAGES) {
      try {
        await page.goto(`${BASE}${path}`, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        // Let the SSE snapshot land and any count-up animation settle.
        await wait(3500);
        await page.screenshot({
          path: `${OUT}/${name}-${viewportName}.png`,
          fullPage: true,
        });
        console.log(`✓ ${name} @ ${viewportName}`);
      } catch (error) {
        console.error(`✗ ${name} @ ${viewportName}: ${error.message}`);
      }
    }

    await page.close();
  }
} finally {
  await browser.close();
}
