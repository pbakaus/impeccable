#!/usr/bin/env node

/**
 * Build System for Cross-Provider Design Skills & Commands
 * 
 * Transforms feature-rich source files into provider-specific formats:
 * - Cursor: Downgraded (no frontmatter/args)
 * - Claude Code: Full featured (frontmatter + body)
 * - Gemini: Full featured (TOML + modular skills)
 * - Codex: Full featured (custom prompts + modular skills)
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { readSourceFiles } from './lib/utils.js';
import {
  transformCursor,
  transformClaudeCode,
  transformGemini,
  transformCodex
} from './lib/transformers/index.js';
import { createAllZips } from './lib/zip.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

/**
 * Main build process
 */
async function build() {
  console.log('🔨 Building cross-provider design plugins...\n');
  
  // Read source files
  const { commands, skills } = readSourceFiles(ROOT_DIR);
  console.log(`📖 Read ${commands.length} commands and ${skills.length} skills\n`);
  
  // Transform for each provider
  transformCursor(commands, skills, DIST_DIR);
  transformClaudeCode(commands, skills, DIST_DIR);
  transformGemini(commands, skills, DIST_DIR);
  transformCodex(commands, skills, DIST_DIR);
  
  // Create ZIP bundles
  await createAllZips(DIST_DIR);
  
  console.log('\n✨ Build complete!');
}

// Run the build
build();
