#!/usr/bin/env node

/**
 * Build System for Cross-Provider Design Skills
 *
 * Transforms source skills into provider-specific formats:
 * - Cursor: .cursor/skills/
 * - Claude Code: .claude/skills/
 * - Gemini: .gemini/skills/
 * - Codex: .codex/skills/
 * - Agents: .agents/skills/ (VS Code Copilot + Antigravity)
 *
 * Also assembles a universal ZIP containing all providers,
 * and builds Tailwind CSS for production deployment.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { readSourceFiles, readPatterns } from './lib/utils.js';
import {
  transformCursor,
  transformClaudeCode,
  transformGemini,
  transformCodex,
  transformAgents
} from './lib/transformers/index.js';
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
function assembleUniversal(distDir) {
  const universalDir = path.join(distDir, 'universal');

  // Clean and recreate
  if (fs.existsSync(universalDir)) {
    fs.rmSync(universalDir, { recursive: true, force: true });
  }

  const providerMappings = [
    { provider: 'cursor', configDir: '.cursor' },
    { provider: 'claude-code', configDir: '.claude' },
    { provider: 'gemini', configDir: '.gemini' },
    { provider: 'codex', configDir: '.codex' },
    { provider: 'agents', configDir: '.agents' },
  ];

  for (const { provider, configDir } of providerMappings) {
    const src = path.join(distDir, provider, configDir);
    const dest = path.join(universalDir, configDir);
    if (fs.existsSync(src)) {
      copyDirSync(src, dest);
    }
  }

  // Add a visible README so macOS users don't see an empty folder
  // (all provider dirs are dotfiles, hidden by default in Finder)
  fs.writeFileSync(path.join(universalDir, 'README.txt'),
`Impeccable — Design fluency for AI harnesses
https://impeccable.style

This folder contains skills for all supported tools:

  .cursor/    → Cursor
  .claude/    → Claude Code
  .gemini/    → Gemini CLI
  .codex/     → Codex CLI
  .agents/    → VS Code Copilot, Antigravity

To install, copy the relevant folder(s) into your project root.
These are hidden folders (dotfiles) — press Cmd+Shift+. in Finder to see them.
`);

  console.log(`✓ Assembled universal directory (${providerMappings.length} providers)`);
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
  const userInvokableCount = skills.filter(s => s.userInvokable).length;
  console.log(`📖 Read ${skills.length} skills (${userInvokableCount} user-invokable) and ${patterns.patterns.length + patterns.antipatterns.length} pattern categories\n`);

  // Transform for each provider
  transformCursor(skills, DIST_DIR, patterns);
  transformClaudeCode(skills, DIST_DIR, patterns);
  transformGemini(skills, DIST_DIR, patterns);
  transformCodex(skills, DIST_DIR, patterns);
  transformAgents(skills, DIST_DIR, patterns);

  // Assemble universal directory
  assembleUniversal(DIST_DIR);

  // Create ZIP bundles (individual + universal)
  await createAllZips(DIST_DIR);

  // Copy Claude Code output to project's .claude directory for local development
  const claudeCodeSrc = path.join(DIST_DIR, 'claude-code', '.claude');
  const claudeCodeDest = path.join(ROOT_DIR, '.claude');

  // Copy skills directory (preserves other files like settings.local.json)
  const skillsSrc = path.join(claudeCodeSrc, 'skills');
  const skillsDest = path.join(claudeCodeDest, 'skills');

  // Remove existing and copy fresh
  if (fs.existsSync(skillsDest)) fs.rmSync(skillsDest, { recursive: true });

  copyDirSync(skillsSrc, skillsDest);

  console.log(`📋 Synced to .claude/: skills`);

  console.log('\n✨ Build complete!');
}

// Run the build
build();
