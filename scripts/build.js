#!/usr/bin/env node

/**
 * Build System for Cross-Provider Design Skills & Commands
 *
 * Transforms feature-rich source files into provider-specific formats:
 * - Cursor: Downgraded (no frontmatter/args)
 * - Claude Code: Full featured (frontmatter + body)
 * - Gemini: Full featured (TOML + modular skills)
 * - Codex: Full featured (custom prompts + modular skills)
 *
 * Also builds Tailwind CSS for production deployment.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { readSourceFiles, readPatterns } from './lib/utils.js';
import {
  transformCursor,
  transformClaudeCode,
  transformGemini,
  transformCodex
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
 * Build Tailwind CSS for production
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
    console.log('✓ Tailwind CSS compiled to public/css/styles.css\n');
  } catch (error) {
    console.error('Failed to build Tailwind CSS:', error.message);
    process.exit(1);
  }
}

/**
 * Main build process
 */
async function build() {
  console.log('🔨 Building cross-provider design plugins...\n');

  // Build Tailwind CSS first
  buildTailwindCSS();

  // Read source files
  const { commands, skills } = readSourceFiles(ROOT_DIR);
  const patterns = readPatterns(ROOT_DIR);
  console.log(`📖 Read ${commands.length} commands, ${skills.length} skills, and ${patterns.patterns.length + patterns.antipatterns.length} pattern categories\n`);

  // Transform for each provider
  transformCursor(commands, skills, DIST_DIR, patterns);
  transformClaudeCode(commands, skills, DIST_DIR, patterns);
  transformGemini(commands, skills, DIST_DIR, patterns);
  transformCodex(commands, skills, DIST_DIR, patterns);
  
  // Create ZIP bundles
  await createAllZips(DIST_DIR);

  // Copy Claude Code output to project's .claude directory for local development
  const claudeCodeSrc = path.join(DIST_DIR, 'claude-code', '.claude');
  const claudeCodeDest = path.join(ROOT_DIR, '.claude');

  // Copy commands and skills directories (preserves other files like settings.local.json)
  const commandsSrc = path.join(claudeCodeSrc, 'commands');
  const skillsSrc = path.join(claudeCodeSrc, 'skills');
  const commandsDest = path.join(claudeCodeDest, 'commands');
  const skillsDest = path.join(claudeCodeDest, 'skills');

  // Remove existing and copy fresh
  if (fs.existsSync(commandsDest)) fs.rmSync(commandsDest, { recursive: true });
  if (fs.existsSync(skillsDest)) fs.rmSync(skillsDest, { recursive: true });

  copyDirSync(commandsSrc, commandsDest);
  copyDirSync(skillsSrc, skillsDest);

  console.log(`📋 Synced to .claude/: commands + skills`);

  console.log('\n✨ Build complete!');
}

// Run the build
build();
