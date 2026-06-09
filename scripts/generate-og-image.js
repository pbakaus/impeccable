#!/usr/bin/env node

/**
 * Generate OG Image (Neo Kinpaku brand)
 *
 * Renders the social sharing card with Playwright using the real Kinpaku
 * tokens (lacquer ground, champagne headline, kinpaku-gold accent) and the
 * kintsugi-seam hero art. Renders at 2x and downscales with sharp for crisp
 * text. The command count is read live from command-metadata.json so it can
 * never go stale.
 *
 * Output: site/public/og-image-v2.jpg (the cache-busted filename Base.astro
 * and index.astro reference). Bump the version suffix here and in those two
 * files together when you want social scrapers to re-fetch a fresh card.
 *
 * Usage: bun run og-image
 */

import { chromium } from 'playwright';
import sharp from 'sharp';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT_DIR, 'site', 'public', 'og-image-v2.jpg');
const ART_PATH = path.join(
  ROOT_DIR,
  'site', 'public', 'assets', 'neo-kinpaku', 'candidates', 'finalists', 'm-01-v2-01.png',
);

// Count sub-commands from skill/scripts/command-metadata.json (the post-v3.0
// single source of truth), so the card's "N commands" tracks the real total.
function getCommandCount() {
  const metadataPath = path.join(ROOT_DIR, 'skill', 'scripts', 'command-metadata.json');
  if (!fs.existsSync(metadataPath)) return 0;
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  return Object.keys(metadata).length;
}

async function generateOgImage() {
  const commands = getCommandCount();
  // Reference the art by file:// URL (not base64): goto + networkidle then
  // genuinely waits for it to load, where a data URL emits no network event
  // and paints black before it decodes.
  const artUrl = pathToFileURL(ART_PATH).href;
  console.log(`Detected ${commands} command(s)`);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Albert+Sans:wght@300;400;500;600;700&family=Alumni+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    --ks-kinpaku:    oklch(84% 0.19 80.46);
    --ks-lacquer:    oklch(7% 0.006 95);
    --ks-champagne:  oklch(84% 0.035 82);
    --ks-text:       oklch(81% 0.03 82);
    --ks-muted:      oklch(63% 0.024 82);
    --ks-font:       "Albert Sans", system-ui, sans-serif;
    --ks-display:    "Alumni Sans", "Albert Sans", sans-serif;
  }
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    position: relative; overflow: hidden;
    background: var(--ks-lacquer);
    font-family: var(--ks-font);
    -webkit-font-smoothing: antialiased;
  }
  /* Kintsugi seam art, full bleed, with a left-to-right lacquer scrim so the
     text column stays legible while the gold seam reads on the right. */
  .art {
    position: absolute; inset: 0; z-index: 0;
    background:
      linear-gradient(101deg,
        var(--ks-lacquer) 0%,
        var(--ks-lacquer) 30%,
        oklch(7% 0.006 95 / 0.55) 50%,
        oklch(7% 0.006 95 / 0) 78%),
      url("${artUrl}") center / cover no-repeat;
    filter: saturate(1.18) contrast(1.06);
  }
  /* Hairline gold frame inset, the kit's "oxidation edge" cue. */
  .frame { position: absolute; inset: 0; z-index: 2; box-shadow: inset 0 0 0 1px oklch(84% 0.19 80.46 / 0.16); }
  .stage { position: absolute; inset: 0; z-index: 1; padding: 76px 80px; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 6px; }
  .mark { width: 40px; height: 40px; color: var(--ks-kinpaku); display: grid; place-items: center; }
  .mark svg { width: 34px; height: 34px; display: block; }
  .wordmark {
    color: var(--ks-kinpaku); font-family: var(--ks-display); font-weight: 600;
    font-size: 27px; letter-spacing: 0.15em; text-transform: uppercase; line-height: 1;
  }
  .headline-wrap { margin-top: auto; margin-bottom: auto; }
  .headline {
    color: var(--ks-champagne); font-family: var(--ks-display); font-weight: 500;
    font-size: 82px; line-height: 1.0; letter-spacing: -0.012em; max-width: 720px;
  }
  .sub {
    margin-top: 26px; color: var(--ks-muted); font-size: 27px; font-weight: 400;
    line-height: 1.38; max-width: 540px; letter-spacing: 0.005em;
  }
  .meta { display: flex; align-items: baseline; justify-content: space-between; gap: 24px; }
  .meta-left { color: var(--ks-text); font-size: 21px; font-weight: 500; letter-spacing: 0.01em; }
  .meta-left .dot { color: var(--ks-kinpaku); padding: 0 10px; }
  .meta-left .lead { color: var(--ks-champagne); font-weight: 600; }
  .domain {
    color: var(--ks-kinpaku); font-family: var(--ks-display); font-weight: 600;
    font-size: 23px; letter-spacing: 0.06em;
  }
</style>
</head>
<body>
  <div class="art"></div>
  <div class="frame"></div>
  <div class="stage">
    <div class="brand">
      <span class="mark">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M5 2.5 L13.5 2.5 L5.5 21.5 L5 21.5 Q2.5 21.5 2.5 19 L2.5 5 Q2.5 2.5 5 2.5 Z"/>
          <path d="M16.5 2.5 L19 2.5 Q21.5 2.5 21.5 5 L21.5 19 Q21.5 21.5 19 21.5 L8.5 21.5 Z"/>
        </svg>
      </span>
      <span class="wordmark">Impeccable</span>
    </div>
    <div class="headline-wrap">
      <h1 class="headline">Design fluency for<br>every AI harness.</h1>
      <p class="sub">Stop shipping generic frontend. A design skill, CLI, and Chrome extension for the tools you already build with.</p>
    </div>
    <div class="meta">
      <div class="meta-left"><span class="lead">${commands} commands</span><span class="dot">&middot;</span>Skill<span class="dot">&middot;</span>CLI<span class="dot">&middot;</span>Extension</div>
      <div class="domain">impeccable.style</div>
    </div>
  </div>
</body>
</html>`;

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 2,
  });

  // Write to a temp file and load via file:// so networkidle waits for the
  // art (a file:// page can reference file:// resources; data: cannot).
  const tmpHtml = path.join(os.tmpdir(), `impeccable-og-${process.pid}.html`);
  fs.writeFileSync(tmpHtml, html);
  try {
    await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);

    // Screenshot at 2x (2400x1260), then downscale to 1200x630 for crisp text.
    const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 630 } });
    await browser.close();
    await sharp(buf).resize(1200, 630).jpeg({ quality: 86 }).toFile(OUTPUT_PATH);
  } finally {
    fs.rmSync(tmpHtml, { force: true });
  }

  const size = (fs.statSync(OUTPUT_PATH).size / 1024).toFixed(0);
  console.log(`Generated ${OUTPUT_PATH} (${size} KB)`);
}

generateOgImage().catch((err) => {
  console.error('Failed to generate OG image:', err);
  process.exit(1);
});
