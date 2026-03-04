#!/usr/bin/env node

/**
 * Screenshot Anti-Pattern Examples
 *
 * Takes 1080x1080 screenshots of each anti-pattern example for LinkedIn sharing.
 * Requires the dev server to be running on localhost:3000
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EXAMPLES_DIR = path.join(ROOT_DIR, 'public', 'antipattern-examples');
const OUTPUT_DIR = path.join(ROOT_DIR, 'public', 'antipattern-images');

async function screenshotAntipatterns() {
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Get all HTML files in the examples directory
  const files = fs.readdirSync(EXAMPLES_DIR)
    .filter(f => f.endsWith('.html'));

  if (files.length === 0) {
    console.log('No HTML files found in', EXAMPLES_DIR);
    return;
  }

  console.log(`📸 Taking screenshots of ${files.length} anti-pattern example(s)...\n`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1200, height: 1200 },
    deviceScaleFactor: 2, // 2x for high-res output
  });

  for (const file of files) {
    const name = path.basename(file, '.html');
    const url = `http://localhost:3000/antipattern-examples/${file}`;
    const outputPath = path.join(OUTPUT_DIR, `${name}.png`);

    console.log(`  ${name}...`);

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });

    // Wait for fonts to load
    await page.waitForTimeout(500);

    // Screenshot the .container element (1080x1080)
    const container = await page.$('.container');
    if (container) {
      await container.screenshot({
        path: outputPath,
        type: 'png',
      });
      console.log(`    ✓ Saved to ${path.relative(ROOT_DIR, outputPath)}`);
    } else {
      // Fallback: screenshot full page cropped
      await page.screenshot({
        path: outputPath,
        type: 'png',
        clip: { x: 0, y: 0, width: 1080, height: 1080 },
      });
      console.log(`    ✓ Saved (full page crop) to ${path.relative(ROOT_DIR, outputPath)}`);
    }

    await page.close();
  }

  await browser.close();
  console.log(`\n✨ Done! Screenshots saved to ${path.relative(ROOT_DIR, OUTPUT_DIR)}/`);
}

// Check if dev server is running
async function checkServer() {
  try {
    const response = await fetch('http://localhost:3000');
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  const serverRunning = await checkServer();
  if (!serverRunning) {
    console.error('❌ Dev server not running. Please start it with: bun run dev');
    process.exit(1);
  }

  await screenshotAntipatterns();
}

main().catch(console.error);
