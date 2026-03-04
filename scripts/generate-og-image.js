#!/usr/bin/env node

/**
 * Generate OG Image
 *
 * Renders the OG image using Playwright with proper Google Fonts.
 * Counts skills and commands dynamically from the source/ directory.
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

// Count skills and commands from source directory
function getCounts() {
  const skillsDir = path.join(ROOT_DIR, 'source', 'skills');
  const commandsDir = path.join(ROOT_DIR, 'source', 'commands');

  const skills = fs.existsSync(skillsDir)
    ? fs.readdirSync(skillsDir).filter(f => fs.statSync(path.join(skillsDir, f)).isDirectory()).length
    : 0;

  const commands = fs.existsSync(commandsDir)
    ? fs.readdirSync(commandsDir).filter(f => f.endsWith('.md')).length
    : 0;

  return { skills, commands };
}

async function generateOgImage() {
  const { skills, commands } = getCounts();
  console.log(`Detected ${skills} skill(s), ${commands} command(s)`);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600;700&family=Instrument+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      width: 1200px;
      height: 630px;
      overflow: hidden;
      background: #f5f2ee;
      position: relative;
    }

    /* Subtle noise texture via radial gradient */
    body::before {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse at 30% 20%, rgba(200, 50, 120, 0.04) 0%, transparent 60%),
                  radial-gradient(ellipse at 80% 80%, rgba(200, 50, 120, 0.03) 0%, transparent 50%);
    }

    .container {
      position: relative;
      width: 100%;
      height: 100%;
      padding: 72px 80px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    /* Decorative slash */
    .slash {
      position: absolute;
      right: 60px;
      bottom: -40px;
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 500px;
      font-weight: 300;
      color: rgba(0, 0, 0, 0.04);
      line-height: 1;
      user-select: none;
    }

    .top {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .title {
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 108px;
      font-weight: 400;
      color: #1a1a1a;
      letter-spacing: -0.02em;
      line-height: 1;
    }

    .tagline {
      font-family: 'Instrument Sans', system-ui, sans-serif;
      font-size: 32px;
      font-weight: 400;
      color: #888;
      margin-top: 4px;
    }

    .bottom {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .stats {
      display: flex;
      align-items: center;
      gap: 24px;
      font-family: 'Space Grotesk', monospace;
      font-size: 22px;
    }

    .stat {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .stat-number {
      font-weight: 600;
      color: #1a1a1a;
    }

    .stat-label {
      color: #888;
      font-weight: 400;
    }

    .stat-sep {
      color: #ccc;
      font-size: 18px;
    }

    .url {
      font-family: 'Space Grotesk', monospace;
      font-size: 18px;
      color: #aaa;
      letter-spacing: 0.02em;
    }
  </style>
</head>
<body>
  <div class="slash">/</div>
  <div class="container">
    <div class="top">
      <div class="title">Impeccable</div>
      <div class="tagline">Design fluency for AI harnesses</div>
    </div>
    <div class="bottom">
      <div class="stats">
        <div class="stat">
          <span class="stat-number">${skills}</span>
          <span class="stat-label">${skills === 1 ? 'skill' : 'skills'}</span>
        </div>
        <span class="stat-sep">+</span>
        <div class="stat">
          <span class="stat-number">${commands}</span>
          <span class="stat-label">${commands === 1 ? 'command' : 'commands'}</span>
        </div>
        <span class="stat-sep">+</span>
        <div class="stat">
          <span class="stat-label">anti-patterns</span>
        </div>
      </div>
      <div class="url">impeccable.style</div>
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
    quality: 85,
  });

  await browser.close();

  const size = (fs.statSync(OUTPUT_PATH).size / 1024).toFixed(0);
  console.log(`Generated ${OUTPUT_PATH} (${size} KB)`);
}

generateOgImage().catch(err => {
  console.error('Failed to generate OG image:', err);
  process.exit(1);
});
