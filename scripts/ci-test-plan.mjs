#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DEFAULT_SUITES, matchesSuiteTriggers } from './test-suites.mjs';

const eventName = process.env.GITHUB_EVENT_NAME || '';
const localNoChanges = !eventName && !process.env.CI_CHANGED_FILES;
const changedFiles = localNoChanges ? [] : getChangedFiles();
const forceDeterministic = localNoChanges || eventName === 'push' || eventName === 'workflow_dispatch';
const forceOptIn = eventName === 'workflow_dispatch';

const plan = {
  core: true,
  detector: forceDeterministic || matchesSuiteTriggers('detector', changedFiles),
  live: forceDeterministic || matchesSuiteTriggers('live', changedFiles),
  framework: forceDeterministic || matchesSuiteTriggers('framework', changedFiles),
  cli_remote_e2e: forceOptIn,
  live_e2e: forceOptIn || matchesSuiteTriggers('live-e2e', changedFiles),
  live_e2e_accept_cleanup: forceOptIn || matchesSuiteTriggers('live-e2e-accept-cleanup', changedFiles),
  skill_behavior: forceOptIn || matchesSuiteTriggers('skill-behavior', changedFiles),
  live_svelte_adapter_deepseek: forceOptIn || matchesSuiteTriggers('live-svelte-adapter-deepseek', changedFiles),
};

writeGithubOutputs(plan);
printSummary(plan, changedFiles);

function getChangedFiles() {
  if (process.env.CI_CHANGED_FILES) {
    return process.env.CI_CHANGED_FILES
      .split(/\r?\n/)
      .map((file) => file.trim())
      .filter(Boolean);
  }

  const event = process.env.GITHUB_EVENT_NAME || '';
  const sha = process.env.GITHUB_SHA || 'HEAD';

  if (event === 'pull_request' && process.env.GITHUB_BASE_REF) {
    const base = `origin/${process.env.GITHUB_BASE_REF}`;
    return gitDiffNames(`${base}...${sha}`) || gitDiffNames(`${base}...HEAD`) || allChanged();
  }

  const before = process.env.GITHUB_EVENT_BEFORE;
  if (before && !/^0+$/.test(before)) {
    return gitDiffNames(`${before}..${sha}`) || allChanged();
  }

  return allChanged();
}

function allChanged() {
  return git(['ls-files']).split(/\r?\n/).filter(Boolean);
}

function gitDiffNames(range) {
  try {
    return git(['diff', '--name-only', range]).split(/\r?\n/).filter(Boolean);
  } catch {
    return null;
  }
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf-8' });
}

function writeGithubOutputs(outputs) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = [];
  for (const [key, value] of Object.entries(outputs)) {
    lines.push(`${key}=${value ? 'true' : 'false'}`);
  }
  fs.appendFileSync(outputPath, lines.join('\n') + '\n');
}

function printSummary(outputs, files) {
  const deterministic = DEFAULT_SUITES.map((name) => `${name}=${outputs[name]}`).join(' ');
  console.log(`Event: ${eventName || 'local'}`);
  console.log(`Changed files: ${files.length}`);
  console.log(`Deterministic suites: ${deterministic}`);
  console.log(
    [
      `cli_remote_e2e=${outputs.cli_remote_e2e}`,
      `live_e2e=${outputs.live_e2e}`,
      `live_e2e_accept_cleanup=${outputs.live_e2e_accept_cleanup}`,
      `skill_behavior=${outputs.skill_behavior}`,
      `deepseek=${outputs.live_svelte_adapter_deepseek}`,
    ].join(' '),
  );
}
