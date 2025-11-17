/**
 * ZIP Generation Utilities
 * 
 * Creates ZIP bundles for each provider's distribution
 */

import { $ } from 'bun';
import path from 'path';
import { existsSync, readdirSync, statSync } from 'fs';

/**
 * Create ZIP file for a provider directory
 * @param {string} providerDir - Path to provider directory
 * @param {string} distDir - Path to dist directory
 * @param {string} providerName - Name of the provider
 */
export async function createProviderZip(providerDir, distDir, providerName) {
  const zipFileName = `${providerName}.zip`;
  const zipPath = path.join(distDir, zipFileName);
  
  // Check if provider directory exists
  if (!existsSync(providerDir)) {
    console.warn(`⚠️  Provider directory not found: ${providerDir}`);
    return;
  }
  
  // Remove existing zip if present
  if (existsSync(zipPath)) {
    await $`rm ${zipPath}`.quiet();
  }
  
  try {
    // Create zip using bun's shell
    // cd into provider dir and zip all contents
    await $`cd ${providerDir} && zip -r ../${zipFileName} . -x "*.DS_Store"`.quiet();
    
    // Get file size for reporting
    const stats = statSync(zipPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    
    console.log(`  📦 ${zipFileName} (${sizeMB} MB)`);
  } catch (error) {
    console.error(`  ❌ Failed to create ${zipFileName}:`, error.message);
  }
}

/**
 * Create ZIP files for all providers
 * @param {string} distDir - Path to dist directory
 */
export async function createAllZips(distDir) {
  console.log('\n📦 Creating ZIP bundles...');
  
  const providers = ['cursor', 'claude-code', 'gemini', 'codex'];
  
  for (const provider of providers) {
    const providerDir = path.join(distDir, provider);
    await createProviderZip(providerDir, distDir, provider);
  }
}

