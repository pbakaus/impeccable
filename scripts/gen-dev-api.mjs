#!/usr/bin/env node

/**
 * Dev-only prebuild: write the `_data/api/*.json` payloads into site/public/
 * so `bun run dev` (astro dev) serves them. In production these are generated
 * by scripts/build.js; the plain `astro dev` server never runs that build, so
 * without this step app.js 404s on /_data/api/commands.json and patterns.json.
 *
 * site/public/_data/ is gitignored, so this only ever produces local artifacts.
 * Reuses the exact production generator (scripts/lib/api-data.js) so dev output
 * matches prod. Runs once at dev startup; editing command-metadata.json or the
 * pattern catalog mid-session needs a dev-server restart (same as other
 * source edits under skill/ and site/content/).
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { readSourceFiles, readPatterns } from './lib/utils.js';
import { generateApiData } from './lib/api-data.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { skills } = readSourceFiles(ROOT_DIR);
const patterns = readPatterns(ROOT_DIR);
generateApiData(path.join(ROOT_DIR, 'site', 'public'), skills, patterns, ROOT_DIR);
