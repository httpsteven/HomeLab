/**
 * Renders the newsletter banner to public/newsletter/banner.png.
 *
 * A generator rather than a checked-in design file because the banner has to
 * exist as a PNG: the email attaches it inline (see posters.ts for why
 * anything linked is a broken image outside the tailnet), and mail clients
 * can't render a gradient or a web font. This bakes both into pixels once.
 *
 * It renders at 2x and the email displays it at 600px, which is what keeps it
 * sharp on a phone.
 *
 *   node scripts/make-banner.mjs
 *
 * To use your own artwork instead, just overwrite public/newsletter/banner.png
 * — nothing reads this script at runtime.
 */

import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const OUT = "public/newsletter/banner.png";
const WIDTH = 1200;
const HEIGHT = 420;

const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#0b0b0d;}
  .card{
    position:relative;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;
    background:
      radial-gradient(120% 150% at 44% -25%,  #ff2cf0 0%, #d916e8 22%, rgba(140,20,200,0) 58%),
      radial-gradient(90% 130% at -8% 42%,    #22c8ff 0%, #1e74e8 34%, rgba(20,60,200,0) 66%),
      radial-gradient(120% 140% at 112% 72%,  #050a3c 0%, #071356 38%, rgba(7,19,86,0) 74%),
      linear-gradient(118deg, #0a53c8 0%, #7a18d8 38%, #3a0c94 64%, #050b40 100%);
  }
  /* The wordmark sits optically centred, not mathematically — the italic's
     overhang on the right makes dead centre read as left-shifted. */
  .mark{
    position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    color:#ececeb;white-space:nowrap;
  }
  .steven{
    font-family:Didot,"Playfair Display",Georgia,serif;font-style:italic;
    font-size:176px;letter-spacing:-.005em;
    /* Overlaps the 'p', the way the original does. */
    margin-right:-42px;position:relative;z-index:2;
  }
  .plex{
    font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-weight:700;
    font-size:168px;letter-spacing:-.045em;position:relative;z-index:1;
  }
</style></head><body>
  <div class="card"><div class="mark"><span class="steven">steven</span><span class="plex">plex</span></div></div>
</body></html>`;

await mkdir("public/newsletter", { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--hide-scrollbars", "--force-color-profile=srgb"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  await page.setContent(HTML, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT, omitBackground: false });
  console.log(`✓ ${OUT} (${WIDTH}×${HEIGHT})`);
} finally {
  await browser.close();
}
