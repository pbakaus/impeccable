#!/usr/bin/env node

/**
 * Build System for Cross-Provider Design Skills
 *
 * Transforms source skills into provider-specific formats:
 * - Cursor: .cursor/skills/
 * - Claude Code: .claude/skills/
 * - Gemini: .gemini/skills/
 * - Codex: .codex/skills/
 * - Agents: .agents/skills/ (Codex app, VS Code Copilot + Antigravity)
 *
 * Also assembles a universal ZIP containing all providers,
 * and builds Tailwind CSS for production deployment.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { readSourceFiles, readPatterns } from './lib/utils.js';
import { createTransformer, PROVIDERS } from './lib/transformers/index.js';
import { createAllZips } from './lib/zip.js';
import { execSync } from 'child_process';

/**
 * Copy directory recursively
 */
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

/**
 * Build Tailwind CSS using the CLI
 * Tailwind v4 uses @theme directive which Bun's CSS bundler doesn't understand
 */
function buildTailwindCSS() {
  const inputFile = path.join(ROOT_DIR, 'public', 'css', 'main.css');
  const outputFile = path.join(ROOT_DIR, 'public', 'css', 'styles.css');

  console.log('🎨 Building Tailwind CSS...');
  try {
    execSync(`bunx @tailwindcss/cli -i "${inputFile}" -o "${outputFile}" --minify`, {
      cwd: ROOT_DIR,
      stdio: 'inherit'
    });
    console.log('✓ Tailwind CSS compiled\n');
  } catch (error) {
    console.error('Failed to build Tailwind CSS:', error.message);
    process.exit(1);
  }
}

/**
 * Build static site using Bun's HTML bundler
 * CSS is pre-compiled by Tailwind CLI, then bundled with HTML/JS
 */
async function buildStaticSite() {
  const entrypoints = [
    path.join(ROOT_DIR, 'public', 'index.html'),
    path.join(ROOT_DIR, 'public', 'cheatsheet.html'),
  ];
  const outdir = path.join(ROOT_DIR, 'build');

  console.log('📦 Building static site with Bun...');

  try {
    const result = await Bun.build({
      entrypoints: entrypoints,
      outdir: outdir,
      minify: true,
      sourcemap: 'linked',
    });

    if (!result.success) {
      console.error('Build failed:');
      for (const log of result.logs) {
        console.error(log.message || log);
        if (log.position) {
          console.error(`  at ${log.position.file}:${log.position.line}:${log.position.column}`);
        }
      }
      process.exit(1);
    }

    // Calculate total size
    const totalSize = result.outputs.reduce((sum, o) => sum + o.size, 0);
    const jsFiles = result.outputs.filter(o => o.path.endsWith('.js'));
    const cssFiles = result.outputs.filter(o => o.path.endsWith('.css'));

    console.log(`✓ Static site built to ./build/`);
    console.log(`  HTML: 1 file`);
    console.log(`  JS: ${jsFiles.length} file(s) (${(jsFiles.reduce((s, f) => s + f.size, 0) / 1024).toFixed(1)} KB)`);
    console.log(`  CSS: ${cssFiles.length} file(s) (${(cssFiles.reduce((s, f) => s + f.size, 0) / 1024).toFixed(1)} KB)`);
    console.log(`  Total: ${(totalSize / 1024).toFixed(1)} KB\n`);

    return result;
  } catch (error) {
    console.error('Failed to build static site:', error.message);
    console.error(error.stack);
    if (error.logs) {
      for (const log of error.logs) {
        console.error(log.message || log);
      }
    }
    process.exit(1);
  }
}

/**
 * Assemble universal directory from all provider outputs
 */
function assembleUniversal(distDir, suffix = '') {
  const universalDir = path.join(distDir, `universal${suffix}`);

  // Clean and recreate
  if (fs.existsSync(universalDir)) {
    fs.rmSync(universalDir, { recursive: true, force: true });
  }

  const providerConfigs = Object.values(PROVIDERS);

  for (const { provider, configDir } of providerConfigs) {
    const src = path.join(distDir, `${provider}${suffix}`, configDir);
    const dest = path.join(universalDir, configDir);
    if (fs.existsSync(src)) {
      copyDirSync(src, dest);
    }
  }

  // Add a visible README so macOS users don't see an empty folder
  // (all provider dirs are dotfiles, hidden by default in Finder)
  const prefixNote = suffix ? '\nSkills in this bundle are prefixed with i- (e.g. /i-audit) to avoid conflicts.\n' : '';
  fs.writeFileSync(path.join(universalDir, 'README.txt'),
`Impeccable — Design fluency for AI harnesses
https://impeccable.style
${prefixNote}
This folder contains skills for all supported tools:

  .cursor/    → Cursor
  .claude/    → Claude Code
  .gemini/    → Gemini CLI
  .codex/     → Codex CLI
  .agents/    → Codex app, VS Code Copilot, Antigravity
  .kiro/      → Kiro
  .opencode/  → OpenCode
  .pi/        → Pi
  .trae-cn/   → Trae China
  .trae/      → Trae International

To install, copy the relevant folder(s) into your project root.
These are hidden folders (dotfiles) — press Cmd+Shift+. in Finder to see them.
`);

  const label = suffix ? ' (prefixed)' : '';
  console.log(`✓ Assembled universal${label} directory (${providerConfigs.length} providers; .agents is shared by Codex app, Copilot, and Antigravity)`);
}

/**
 * Generate static API data for Cloudflare Pages deployment.
 * Pre-builds all API responses as JSON files so they can be served
 * as static assets via _redirects rewrites (no function invocations needed).
 */
function generateApiData(buildDir, skills, patterns) {
  const apiDir = path.join(buildDir, '_data', 'api');
  fs.mkdirSync(apiDir, { recursive: true });

  // skills.json
  const skillsData = skills.map(s => ({
    id: path.basename(path.dirname(s.filePath)),
    name: s.name,
    description: s.description,
    userInvocable: s.userInvocable,
  }));
  fs.writeFileSync(path.join(apiDir, 'skills.json'), JSON.stringify(skillsData));

  // commands.json (user-invocable skills only)
  const commandsData = skillsData.filter(s => s.userInvocable);
  fs.writeFileSync(path.join(apiDir, 'commands.json'), JSON.stringify(commandsData));

  // patterns.json
  fs.writeFileSync(path.join(apiDir, 'patterns.json'), JSON.stringify(patterns));

  // command-source/{id}.json (one per skill)
  const cmdSourceDir = path.join(apiDir, 'command-source');
  fs.mkdirSync(cmdSourceDir, { recursive: true });
  for (const skill of skills) {
    const id = path.basename(path.dirname(skill.filePath));
    const content = fs.readFileSync(skill.filePath, 'utf-8');
    fs.writeFileSync(
      path.join(cmdSourceDir, `${id}.json`),
      JSON.stringify({ content })
    );
  }

  console.log(`✓ Generated static API data (${skillsData.length} skills, ${commandsData.length} commands)`);
}

/**
 * Copy dist files to build output for Cloudflare Pages Functions access.
 * Download functions use env.ASSETS.fetch() to read these files.
 */
function copyDistToBuild(distDir, buildDir) {
  const destDir = path.join(buildDir, '_data', 'dist');
  copyDirSync(distDir, destDir);
  console.log('✓ Copied dist files to build output');
}

/**
 * Generate Cloudflare Pages config files (_headers, _redirects)
 */
function generateCFConfig(buildDir) {
  // _headers: security + cache headers
  const headers = `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY

# HTML pages: browser always revalidates, CDN caches 1h
/*.html
  Cache-Control: public, max-age=0, s-maxage=3600, stale-while-revalidate=600

# Hashed JS/CSS bundles: immutable (filename changes on content change)
/assets/*.js
  Cache-Control: public, max-age=31536000, immutable

/assets/*.css
  Cache-Control: public, max-age=31536000, immutable

# Static images and logos: 1 week + 1 day stale
/assets/*.png
  Cache-Control: public, max-age=604800, stale-while-revalidate=86400

/assets/*.svg
  Cache-Control: public, max-age=604800, stale-while-revalidate=86400

/assets/*.webp
  Cache-Control: public, max-age=604800, stale-while-revalidate=86400

/antipattern-images/*
  Cache-Control: public, max-age=604800, stale-while-revalidate=86400

# Root static assets (favicon, og-image, etc.)
/favicon.svg
  Cache-Control: public, max-age=604800, stale-while-revalidate=86400

/og-image.jpg
  Cache-Control: public, max-age=604800, stale-while-revalidate=86400

/apple-touch-icon.png
  Cache-Control: public, max-age=604800, stale-while-revalidate=86400

# ZIP downloads: 1h cache
/dist/*.zip
  Cache-Control: public, max-age=3600, stale-while-revalidate=600

# API routes: CDN caches 24h
/api/*
  Cache-Control: public, s-maxage=86400, stale-while-revalidate=3600

/_data/api/*
  Cache-Control: public, s-maxage=86400, stale-while-revalidate=3600
`;
  fs.writeFileSync(path.join(buildDir, '_headers'), headers);

  // _redirects: rewrite JSON API routes to static files (200 = rewrite, not redirect)
  const redirects = `/api/skills /_data/api/skills.json 200
/api/commands /_data/api/commands.json 200
/api/patterns /_data/api/patterns.json 200
/api/command-source/:id /_data/api/command-source/:id.json 200
`;
  fs.writeFileSync(path.join(buildDir, '_redirects'), redirects);

  // _routes.json: tell Cloudflare Pages which paths invoke Functions
  // Without this, the SPA fallback serves index.html for function routes
  const routes = {
    version: 1,
    include: ['/api/download/*'],
    exclude: [],
  };
  fs.writeFileSync(path.join(buildDir, '_routes.json'), JSON.stringify(routes, null, 2));

  console.log('✓ Generated Cloudflare Pages config (_headers, _redirects, _routes.json)');
}

/**
 * Main build process
 */
async function build() {
  console.log('🔨 Building cross-provider design skills...\n');

  // Build CSS with Tailwind CLI (handles @theme directive)
  buildTailwindCSS();

  // Bundle HTML, JS, and compiled CSS with Bun
  await buildStaticSite();

  // Copy root-level static assets that need stable (unhashed) URLs
  const staticAssets = ['og-image.jpg', 'robots.txt', 'sitemap.xml', 'favicon.svg', 'apple-touch-icon.png'];
  const buildDir = path.join(ROOT_DIR, 'build');
  for (const asset of staticAssets) {
    const src = path.join(ROOT_DIR, 'public', asset);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(buildDir, asset));
    }
  }

  // Read source files (unified skills architecture)
  const { skills } = readSourceFiles(ROOT_DIR);
  const patterns = readPatterns(ROOT_DIR);
  const userInvocableCount = skills.filter(s => s.userInvocable).length;
  console.log(`📖 Read ${skills.length} skills (${userInvocableCount} user-invocable) and ${patterns.patterns.length + patterns.antipatterns.length} pattern categories\n`);

  // Transform for each provider (unprefixed + prefixed)
  for (const config of Object.values(PROVIDERS)) {
    const transform = createTransformer(config);
    transform(skills, DIST_DIR);
    transform(skills, DIST_DIR, { prefix: 'i-', outputSuffix: '-prefixed' });
  }

  // Assemble universal directory (unprefixed and prefixed)
  assembleUniversal(DIST_DIR);
  assembleUniversal(DIST_DIR, '-prefixed');

  // Create ZIP bundles (individual + universal)
  await createAllZips(DIST_DIR);

  // Generate static API data and Cloudflare Pages config
  generateApiData(buildDir, skills, patterns);
  copyDistToBuild(DIST_DIR, buildDir);
  generateCFConfig(buildDir);

  // Copy all provider outputs to project root for local testing
  const syncConfigs = Object.values(PROVIDERS);

  for (const { provider, configDir } of syncConfigs) {
    const skillsSrc = path.join(DIST_DIR, provider, configDir, 'skills');
    const skillsDest = path.join(ROOT_DIR, configDir, 'skills');

    if (fs.existsSync(skillsSrc)) {
      if (fs.existsSync(skillsDest)) fs.rmSync(skillsDest, { recursive: true });
      copyDirSync(skillsSrc, skillsDest);
    }
  }

  console.log(`📋 Synced skills to: ${syncConfigs.map(p => p.configDir).join(', ')}`);

  console.log('\n✨ Build complete!');
}

// Run the build
build();
