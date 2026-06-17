/**
 * ZIP Generation Utilities
 *
 * Creates ZIP bundles for each provider's distribution
 * Uses archiver instead of shell `zip` for cross-platform compatibility
 * (Cloudflare Pages build environment may not have zip installed)
 */

import path from 'path';
import { createWriteStream, existsSync, statSync } from 'fs';
// archiver v8 is ESM and exports format-specific classes (no factory function).
import { ZipArchive } from 'archiver';

/**
 * Create ZIP file for a provider directory
 * @param {string} providerDir - Path to provider directory
 * @param {string} distDir - Path to dist directory
 * @param {string} providerName - Name of the provider
 */
export async function createProviderZip(providerDir, distDir, providerName) {
  const zipFileName = `${providerName}.zip`;
  const zipPath = path.join(distDir, zipFileName);

  if (!existsSync(providerDir)) {
    throw new Error(`Cannot create ${zipFileName}: provider directory not found: ${providerDir}`);
  }

  // Fail loud, never soft. This artifact ships to `npx impeccable skills
  // install` via the bundle endpoint; a build that can't produce a real zip
  // must exit non-zero rather than deploy an empty one. (archiver v8's ESM
  // break previously failed here silently and shipped a 0-byte universal.zip.)
  let entryCount = 0;
  await new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('entry', () => { entryCount += 1; });

    archive.pipe(output);
    archive.glob('**/*', {
      cwd: providerDir,
      dot: true,
      ignore: ['**/.DS_Store'],
    });
    archive.finalize();
  });

  if (entryCount === 0) {
    throw new Error(`Created ${zipFileName} but it contains no entries (source: ${providerDir}).`);
  }
  const { size } = statSync(zipPath);
  if (size === 0) {
    throw new Error(`Created ${zipFileName} but it is 0 bytes.`);
  }

  const sizeMB = (size / 1024 / 1024).toFixed(2);
  console.log(`  📦 ${zipFileName} (${sizeMB} MB)`);
}

/**
 * Create ZIP files for all providers + universal
 * @param {string} distDir - Path to dist directory
 */
export async function createAllZips(distDir) {
  console.log('\n📦 Creating ZIP bundles...');

  await createProviderZip(path.join(distDir, 'universal'), distDir, 'universal');
}
