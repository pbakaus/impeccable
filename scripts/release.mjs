#!/usr/bin/env node
// Tags and publishes a GitHub release for one of three independently versioned
// components: skill, cli, extension.
//
// Usage: node scripts/release.mjs <skill|cli|extension> [--dry-run]
//
// Refuses on a dirty tree, an unpushed HEAD, or a missing changelog entry.
// For the skill component, also reruns `bun run build` and refuses if the
// regenerated harness directories drift from what is committed.

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const COMPONENTS = {
  skill: {
    manifest: '.claude-plugin/plugin.json',
    sibling: '.claude-plugin/marketplace.json',
    siblingVersion: (m) => m.plugins?.[0]?.version,
    tagPrefix: 'skill-v',
    label: 'Skill',
    changelogLabel: 'v',
    buildCmd: 'bun run build',
    artifacts: ['dist/universal.zip'],
    postReleaseHint: null,
    tweetHeader: (v) => `Impeccable v${v} is out.`,
    tweetCta: 'Install / update: npx skills add pbakaus/impeccable',
  },
  cli: {
    manifest: 'package.json',
    tagPrefix: 'cli-v',
    label: 'CLI',
    changelogLabel: 'CLI v',
    buildCmd: null,
    artifacts: [],
    postReleaseHint: 'Run `npm publish` next to push the package to the npm registry.',
    tweetHeader: (v) => `Impeccable CLI v${v} is out.`,
    tweetCta: 'npm i -g impeccable',
  },
  extension: {
    manifest: 'extension/manifest.json',
    tagPrefix: 'ext-v',
    label: 'Extension',
    changelogLabel: 'Extension v',
    buildCmd: 'bun run build:extension',
    artifacts: ['dist/extension.zip'],
    postReleaseHint: 'Upload `dist/extension.zip` to the Chrome Web Store dashboard to publish.',
    tweetHeader: (v) => `Impeccable Chrome extension v${v} is out.`,
    tweetCta: null,
  },
};

const REPO_URL = 'https://github.com/pbakaus/impeccable';
const TWEET_LIMIT = 280;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const component = args.find((a) => !a.startsWith('--'));

if (!component || !COMPONENTS[component]) {
  console.error('usage: release.mjs <skill|cli|extension> [--dry-run]');
  process.exit(1);
}
const cfg = COMPONENTS[component];

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`✓ ${msg}`);
}
function step(msg) {
  console.log(`\n→ ${msg}`);
}
function run(cmd) {
  return execSync(cmd, { cwd: repoRoot, encoding: 'utf8' }).trim();
}
function runMutating(cmd) {
  if (dryRun) {
    console.log(`  [dry-run] ${cmd}`);
    return;
  }
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit' });
}

step(`Reading version from ${cfg.manifest}`);
const manifest = JSON.parse(readFileSync(path.join(repoRoot, cfg.manifest), 'utf8'));
const version = manifest.version;
if (!version) fail(`No version field in ${cfg.manifest}`);
ok(`${cfg.label} ${version}`);

if (cfg.sibling) {
  const sibling = JSON.parse(readFileSync(path.join(repoRoot, cfg.sibling), 'utf8'));
  const siblingVersion = cfg.siblingVersion(sibling);
  if (siblingVersion !== version) {
    fail(`${cfg.manifest} (${version}) and ${cfg.sibling} (${siblingVersion}) disagree. Bump both.`);
  }
  ok(`${cfg.sibling} agrees`);
}

const tag = `${cfg.tagPrefix}${version}`;

step('Checking working tree is clean');
const status = run('git status --porcelain');
if (status) fail(`Working tree is dirty. Commit or stash first:\n${status}`);
ok('clean');

if (cfg.buildCmd) {
  step(`Rebuilding outputs (${cfg.buildCmd})`);
  if (dryRun) {
    console.log(`  [dry-run] ${cfg.buildCmd}`);
  } else {
    execSync(cfg.buildCmd, { cwd: repoRoot, stdio: 'inherit' });
    const postBuild = run('git status --porcelain');
    if (postBuild) {
      fail(`Build produced uncommitted changes. Run \`${cfg.buildCmd}\`, commit the result, then re-run.\n${postBuild}`);
    }
    ok('build outputs match source');
  }
}

step('Checking HEAD is pushed to origin');
const branch = run('git rev-parse --abbrev-ref HEAD');
const head = run('git rev-parse HEAD');
let remoteHead;
try {
  remoteHead = run(`git rev-parse origin/${branch}`);
} catch {
  fail(`No tracking branch origin/${branch}. Push first.`);
}
if (head !== remoteHead) fail(`HEAD is ahead of origin/${branch}. Push your commits first.`);
ok(`origin/${branch} matches HEAD`);

step(`Verifying tag ${tag} does not already exist`);
let localTagExists = false;
try {
  run(`git rev-parse -q --verify "refs/tags/${tag}"`);
  localTagExists = true;
} catch {}
if (localTagExists) fail(`Tag ${tag} already exists locally.`);
const remoteTags = run('git ls-remote --tags origin');
if (remoteTags.split('\n').some((line) => line.endsWith(`refs/tags/${tag}`))) {
  fail(`Tag ${tag} already exists on origin.`);
}
ok('tag is free');

step(`Extracting changelog entry for "${cfg.changelogLabel}${version}"`);
const changelogSource = path.join(repoRoot, 'site/pages/index.astro');
const indexHtml = readFileSync(changelogSource, 'utf8');
const expectedHeader = `<span class="changelog-version">${cfg.changelogLabel}${version}</span>`;
const headerIdx = indexHtml.indexOf(expectedHeader);
if (headerIdx === -1) {
  fail(`No changelog entry found for "${cfg.changelogLabel}${version}" in site/pages/index.astro. Add one before releasing.`);
}
const entryStart = indexHtml.lastIndexOf('<div class="changelog-entry"', headerIdx);
const ulEnd = indexHtml.indexOf('</ul>', headerIdx);
if (entryStart === -1 || ulEnd === -1) fail('Changelog entry markup is malformed.');
const entryEnd = indexHtml.indexOf('</div>', ulEnd) + '</div>'.length;
const entryHtml = indexHtml.slice(entryStart, entryEnd);

const notes = htmlToMarkdown(entryHtml);
ok('extracted');

step('Verifying release artifacts exist');
for (const artifact of cfg.artifacts) {
  const abs = path.join(repoRoot, artifact);
  if (!existsSync(abs)) fail(`Missing artifact: ${artifact}`);
  ok(artifact);
}

console.log('\n--- Release notes preview ---');
console.log(notes);
console.log('--- end preview ---\n');

step(`Creating annotated tag ${tag}`);
const tagMessageFile = path.join(repoRoot, '.release-tag-msg.tmp');
const releaseNotesFile = path.join(repoRoot, '.release-notes.tmp.md');
if (!dryRun) {
  writeFileSync(tagMessageFile, `${cfg.label} ${version}\n\n${notes}\n`);
  writeFileSync(releaseNotesFile, notes);
}
try {
  runMutating(`git tag -a ${tag} -F "${tagMessageFile}"`);
  runMutating(`git push origin ${tag}`);

  step(`Creating GitHub release ${tag}`);
  const artifactArgs = cfg.artifacts.map((a) => `"${a}"`).join(' ');
  const title = `${cfg.label} ${version}`;
  runMutating(
    `gh release create ${tag} --title "${title}" --notes-file "${releaseNotesFile}"${artifactArgs ? ' ' + artifactArgs : ''}`
  );

} finally {
  if (!dryRun) {
    try { unlinkSync(tagMessageFile); } catch {}
    try { unlinkSync(releaseNotesFile); } catch {}
  }
}

console.log(`\n✓ ${cfg.label} ${version} released as ${tag}`);
if (cfg.postReleaseHint) {
  console.log(`\n→ Next step: ${cfg.postReleaseHint}`);
}

const tweet = renderTweet(cfg, version, entryHtml, tag);
console.log(`\n--- Tweet (${tweet.length}/${TWEET_LIMIT} chars) for @impeccable_ai ---`);
console.log(tweet);
console.log('--- end tweet ---');

// Pull the bold lead text from each changelog bullet. Each <li> reads
// "<strong>Headline.</strong> Body...", so the strong text alone is a
// tweet-grade summary. Returns a list ordered by appearance.
function extractHighlights(entryHtml) {
  const highlights = [];
  const liRe = /<li>([\s\S]*?)<\/li>/g;
  let match;
  while ((match = liRe.exec(entryHtml))) {
    const strong = match[1].match(/<strong>([\s\S]*?)<\/strong>/);
    if (!strong) continue;
    const text = strong[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&times;/g, '×')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .replace(/[.!?]+\s*$/, '')
      .trim();
    if (text) highlights.push(text);
  }
  return highlights;
}

function renderTweet(cfg, version, entryHtml, tag) {
  const releaseUrl = `${REPO_URL}/releases/tag/${tag}`;
  const header = cfg.tweetHeader(version);
  const highlights = extractHighlights(entryHtml);
  const tail = [cfg.tweetCta, releaseUrl].filter(Boolean).join('\n');

  // Greedy: include as many highlights as fit. Always include the URL.
  let bullets = '';
  const bulletPrefix = '• ';
  for (const h of highlights) {
    const candidate = bullets + bulletPrefix + h + '\n';
    const draft = [header, '', candidate.trimEnd(), '', tail].join('\n');
    if (draft.length > TWEET_LIMIT) break;
    bullets = candidate;
  }

  // Fallback if even the first highlight overflows: drop bullets entirely.
  if (!bullets) {
    return [header, '', tail].join('\n');
  }
  return [header, '', bullets.trimEnd(), '', tail].join('\n');
}

function htmlToMarkdown(html) {
  let md = html;
  md = md.replace(/<div class="changelog-version-header"[\s\S]*?<\/div>/, '');
  md = md.replace(/<li>([\s\S]*?)<\/li>/g, (_, inner) => `- ${inner.trim()}\n`);
  md = md.replace(/<strong>([\s\S]*?)<\/strong>/g, '**$1**');
  md = md.replace(/<code>([\s\S]*?)<\/code>/g, '`$1`');
  md = md.replace(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, '[$2]($1)');
  md = md.replace(/<\/?(ul|div|span)[^>]*>/g, '');
  md = md.replace(/&times;/g, '×');
  md = md.replace(/&amp;/g, '&');
  md = md.replace(/&lt;/g, '<');
  md = md.replace(/&gt;/g, '>');
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/^[ \t]+/gm, '');
  md = md.replace(/[ \t]+\n/g, '\n');
  md = md.replace(/\n{3,}/g, '\n\n');
  return md.trim();
}
