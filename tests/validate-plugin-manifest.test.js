/**
 * Unit coverage for the plugin manifest shape guard (PR #494).
 *
 * The bug this exists to catch: the build emitted an `agents` array into the
 * generated plugin manifest, and that key made Claude Code load zero of the
 * four shipped subagents. No validator looked at the manifest's shape, so the
 * defect shipped in every release since the subagents were added. The guard
 * pins the verified loader contract (KNOWN_LOADER_KEYS) so any new key fails
 * the build until it has been confirmed against a real Claude Code install.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  collectPluginManifestFindings,
  KNOWN_LOADER_KEYS,
} from '../scripts/lib/validate-plugin-manifest.js';

const REPO_ROOT = path.resolve(import.meta.dir, '..');

const GOOD_MANIFEST = {
  name: 'impeccable',
  description: 'Test plugin',
  version: '4.0.4',
  author: { name: 'Paul Bakaus' },
  homepage: 'https://impeccable.style',
  repository: 'https://github.com/pbakaus/impeccable',
  skills: './skills/',
};

function writeFixture(root, { manifest = GOOD_MANIFEST, sourceAgents = [], shippedAgents } = {}) {
  const write = (rel, contents) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  };
  if (manifest !== undefined) {
    write(
      'plugin/.claude-plugin/plugin.json',
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2),
    );
  }
  for (const file of sourceAgents) write(`skill/agents/${file}`, '---\nname: x\n---\nBody.\n');
  for (const file of shippedAgents ?? sourceAgents) write(`plugin/agents/${file}`, '---\nname: x\n---\nBody.\n');
}

describe('collectPluginManifestFindings', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-manifest-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('a clean manifest with shipped agents produces no findings', () => {
    writeFixture(root, { sourceAgents: ['reviewer.md', 'producer.md'] });
    expect(collectPluginManifestFindings(root)).toEqual([]);
  });

  test('flags an agents key given as an array of file paths (the shipped bug)', () => {
    writeFixture(root, {
      manifest: { ...GOOD_MANIFEST, agents: ['./agents/reviewer.md', './agents/producer.md'] },
      sourceAgents: ['reviewer.md', 'producer.md'],
    });
    const findings = collectPluginManifestFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].relPath).toBe('plugin/.claude-plugin/plugin.json');
    expect(findings[0].reason).toMatch(/"agents" key/);
    expect(findings[0].reason).toMatch(/zero agents/);
  });

  test('flags an agents key of any other shape too', () => {
    writeFixture(root, { manifest: { ...GOOD_MANIFEST, agents: './agents' } });
    const findings = collectPluginManifestFindings(root);
    expect(findings.some((f) => f.reason.match(/"agents" key/))).toBe(true);
  });

  test('flags a manifest key outside the verified loader contract', () => {
    writeFixture(root, { manifest: { ...GOOD_MANIFEST, mcpServers: './mcp.json' } });
    const findings = collectPluginManifestFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toMatch(/unverified manifest key "mcpServers"/);
    expect(findings[0].reason).toMatch(/KNOWN_LOADER_KEYS/);
  });

  test('flags a skills path without the trailing slash (issue #86)', () => {
    writeFixture(root, { manifest: { ...GOOD_MANIFEST, skills: './skills' } });
    const findings = collectPluginManifestFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toMatch(/trailing-slash/);
  });

  test('flags a source agent missing from the shipped subtree', () => {
    writeFixture(root, {
      sourceAgents: ['reviewer.md', 'producer.md'],
      shippedAgents: ['reviewer.md'],
    });
    const findings = collectPluginManifestFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].relPath).toBe('plugin/agents/producer.md');
    expect(findings[0].reason).toMatch(/never load/);
  });

  test('reports every problem at once', () => {
    writeFixture(root, {
      manifest: { ...GOOD_MANIFEST, agents: ['./agents/reviewer.md'], skills: './skills', commands: './commands/' },
      sourceAgents: ['reviewer.md'],
      shippedAgents: [],
    });
    const reasons = collectPluginManifestFindings(root).map((f) => f.reason);
    expect(reasons).toHaveLength(4);
  });

  test('an absent plugin subtree produces no findings', () => {
    expect(collectPluginManifestFindings(root)).toEqual([]);
  });

  test('a malformed manifest is a finding, not a thrown stack', () => {
    writeFixture(root, { manifest: '{ not json' });
    const findings = collectPluginManifestFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toMatch(/parse/);
  });

  test('valid JSON that is not an object is a finding, not a thrown stack', () => {
    for (const raw of ['null', '"impeccable"', '42', '["./agents/reviewer.md"]']) {
      writeFixture(root, { manifest: raw });
      const findings = collectPluginManifestFindings(root);
      expect(findings).toHaveLength(1);
      expect(findings[0].reason).toMatch(/not a JSON object/);
    }
  });

  test('KNOWN_LOADER_KEYS never re-admits agents', () => {
    expect(KNOWN_LOADER_KEYS).not.toContain('agents');
  });
});

describe('committed plugin subtree', () => {
  // The test that was missing when the agents key shipped: validate the real
  // artifact the marketplace installs, not a fixture. If this fails, the
  // committed ./plugin subtree carries a manifest shape Claude Code will not
  // load; regenerate it with `bun run build:release` after fixing build.js.
  test('the shipped manifest honors the verified loader contract', () => {
    expect(collectPluginManifestFindings(REPO_ROOT)).toEqual([]);
  });
});
