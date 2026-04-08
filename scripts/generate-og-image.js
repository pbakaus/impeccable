#!/usr/bin/env node

/**
 * Generate OG Image
 *
 * Renders the OG image using Playwright with proper Google Fonts.
 * Counts commands dynamically from the source/ directory and composes
 * the wordmark alongside a real screenshot of the Chrome extension
 * detection panel from public/assets/extension-detection.png.
 *
 * Usage: bun run og-image
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT_DIR, 'public', 'og-image.jpg');
const EXTENSION_IMAGE_PATH = path.join(
  ROOT_DIR,
  'public',
  'assets',
  'extension-detection.png',
);

// Count user-invocable, non-deprecated skills from source/skills/
// (In v2.0, commands and skills were unified — every command is a skill.)
function getCommandCount() {
  const skillsDir = path.join(ROOT_DIR, 'source', 'skills');
  if (!fs.existsSync(skillsDir)) return 0;

  let count = 0;
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;

    const content = fs.readFileSync(skillFile, 'utf8');
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) continue;

    const frontmatter = fm[1];
    const isUserInvocable = /^user-invocable:\s*true\s*$/m.test(frontmatter);
    const isDeprecated = /^description:\s*["']?DEPRECATED/mi.test(frontmatter);

    if (isUserInvocable && !isDeprecated) count++;
  }
  return count;
}

// Load extension screenshot as base64 data URL so setContent is self-contained
function getExtensionDataUrl() {
  const buf = fs.readFileSync(EXTENSION_IMAGE_PATH);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

async function generateOgImage() {
  const commands = getCommandCount();
  const extensionDataUrl = getExtensionDataUrl();
  console.log(`Detected ${commands} command(s)`);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400;1,500&family=Instrument+Sans:wght@400;500;600&family=Space+Grotesk:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      width: 1200px;
      height: 630px;
      overflow: hidden;
      background: #f5f2ee;
      position: relative;
      font-family: 'Instrument Sans', system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
      color: #1a1a1a;
    }

    /* Soft brand glow for depth — subtle magenta accents in opposite corners */
    body::before {
      content: '';
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at 15% 8%, rgba(200, 50, 120, 0.07) 0%, transparent 55%),
        radial-gradient(circle at 90% 95%, rgba(200, 50, 120, 0.05) 0%, transparent 60%);
      pointer-events: none;
    }

    .container {
      position: relative;
      width: 100%;
      height: 100%;
      padding: 72px 80px;
    }

    .content {
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 100%;
      max-width: 560px;
      z-index: 2;
    }

    .top {
      display: flex;
      flex-direction: column;
      gap: 22px;
    }

    .title {
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 108px;
      font-weight: 300;
      font-style: italic;
      color: #1a1a1a;
      letter-spacing: -0.03em;
      line-height: 0.95;
    }

    .tagline {
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 34px;
      font-weight: 400;
      font-style: italic;
      color: #3a3a3a;
      line-height: 1.3;
      max-width: 480px;
    }

    .bottom {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .features {
      display: flex;
      align-items: center;
      gap: 14px;
      font-family: 'Space Grotesk', monospace;
      font-size: 19px;
      font-weight: 500;
      color: #1a1a1a;
      letter-spacing: 0.005em;
    }

    .feature-sep {
      color: #c83278;
      font-weight: 400;
      font-size: 22px;
      line-height: 1;
    }

    .url {
      font-family: 'Space Grotesk', monospace;
      font-size: 16px;
      color: #999;
      letter-spacing: 0.02em;
    }

    /* Extension panel — floating product shot, anchored right-center */
    .panel {
      position: absolute;
      right: 54px;
      top: 50%;
      width: 500px;
      transform: translateY(-50%) rotate(-2deg);
      border-radius: 14px;
      overflow: hidden;
      box-shadow:
        0 1px 2px rgba(0, 0, 0, 0.05),
        0 6px 14px rgba(0, 0, 0, 0.06),
        0 24px 48px -10px rgba(30, 15, 25, 0.18),
        0 48px 100px -20px rgba(200, 50, 120, 0.14);
      z-index: 1;
    }

    .panel::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 14px;
      border: 1px solid rgba(0, 0, 0, 0.08);
      pointer-events: none;
    }

    .panel img {
      display: block;
      width: 100%;
      height: auto;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="content">
      <div class="top">
        <div class="title">Impeccable</div>
        <div class="tagline">Design fluency for AI harnesses</div>
      </div>
      <div class="bottom">
        <div class="features">
          <span>${commands} commands</span>
          <span class="feature-sep">·</span>
          <span>Chrome extension</span>
          <span class="feature-sep">·</span>
          <span>CLI</span>
        </div>
        <div class="url">impeccable.style</div>
      </div>
    </div>
    <div class="panel">
      <img src="${extensionDataUrl}" alt="Impeccable Chrome extension detection panel">
    </div>
  </div>
</body>
</html>`;

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });

  await page.setContent(html, { waitUntil: 'networkidle' });

  // Wait for fonts to load
  await page.evaluate(() => document.fonts.ready);

  await page.screenshot({
    path: OUTPUT_PATH,
    type: 'jpeg',
    quality: 90,
  });

  await browser.close();

  const size = (fs.statSync(OUTPUT_PATH).size / 1024).toFixed(0);
  console.log(`Generated ${OUTPUT_PATH} (${size} KB)`);
}

generateOgImage().catch((err) => {
  console.error('Failed to generate OG image:', err);
  process.exit(1);
});
