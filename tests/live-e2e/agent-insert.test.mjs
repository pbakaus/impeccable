/**
 * Unit tests for insert-mode agent helpers.
 * Run with: node --test tests/live-e2e/agent-insert.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  applySteerEdits,
  buildSteerContext,
  insertTargetFromEvent,
  createFakeAgent,
  loadManualEditEventBatch,
} from './agent.mjs';

describe('insertTargetFromEvent', () => {
  it('maps insert.anchor fields to live-insert CLI args', () => {
    const target = insertTargetFromEvent({
      mode: 'insert',
      insert: {
        position: 'after',
        anchor: {
          id: 'features',
          tagName: 'section',
          classes: ['feature-grid'],
          textContent: 'One Two',
        },
      },
    });
    assert.equal(target.position, 'after');
    assert.equal(target.elementId, 'features');
    assert.equal(target.tag, 'section');
    assert.equal(target.classes, 'feature-grid');
    assert.equal(target.text, 'One Two');
  });

  it('defaults position to after when missing', () => {
    const target = insertTargetFromEvent({
      insert: { anchor: { tagName: 'div', classes: ['x'] } },
    });
    assert.equal(target.position, 'after');
    assert.equal(target.tag, 'div');
    assert.equal(target.classes, 'x');
  });
});

describe('createFakeAgent — insert mode', () => {
  it('returns net-new markup without cloning the picked tag', async () => {
    const agent = createFakeAgent();
    const output = await agent.generateVariants(
      { mode: 'insert', count: 3, placeholder: { width: 320, height: 80 } },
      { wrapInfo: { styleMode: 'plain-css', commentSyntax: { open: '{/*', close: '*/}' }, file: 'src/App.jsx' } },
    );
    assert.equal(output.variants.length, 3);
    assert.match(output.variants[0].innerHtml, /inserted-strip/);
    assert.doesNotMatch(output.variants[0].innerHtml, /<h1\b/);
    assert.match(output.scopedCss, /@scope \(\[data-impeccable-variant="1"\]\)/);
    assert.match(output.scopedCss, /\.inserted-copy/);
  });
});

describe('fixture path containment', () => {
  it('builds and applies steer edits under a symlinked project root', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'impeccable-steer-root-'));
    const project = path.join(workspace, 'project');
    const linkedProject = path.join(workspace, 'linked-project');
    const sourceFile = path.join(project, 'src', 'Hero.jsx');
    try {
      await fs.mkdir(path.dirname(sourceFile), { recursive: true });
      await fs.writeFile(sourceFile, '<h1 className="hero-title">Original</h1>');
      await fs.symlink(project, linkedProject, 'dir');

      for (const configuredSource of ['src/Hero.jsx', undefined]) {
        const context = buildSteerContext({
          tmp: linkedProject,
          event: { pageUrl: 'http://localhost/' },
          wrapTarget: { tag: 'h1', classes: 'hero-title' },
          sourceFile: configuredSource,
        });
        assert.equal(context.targetFile, path.join('src', 'Hero.jsx'));
        assert.equal(context.targetFileAbs, await fs.realpath(sourceFile));
        await applySteerEdits(linkedProject, {
          file: context.targetFile,
          edits: [{ find: 'Original', replace: 'Changed' }],
        });
        assert.match(await fs.readFile(sourceFile, 'utf8'), /Changed/);
        await fs.writeFile(sourceFile, '<h1 className="hero-title">Original</h1>');
      }
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('rejects symlink escapes when reading or editing source files', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'impeccable-path-test-'));
    const project = path.join(workspace, 'project');
    const outsideFile = path.join(workspace, 'outside.jsx');
    const linkedFile = path.join(project, 'src', 'linked.jsx');
    const outsideContent = '<h1 className="hero-title">Outside</h1>';

    try {
      await fs.mkdir(path.dirname(linkedFile), { recursive: true });
      await fs.writeFile(outsideFile, outsideContent);
      await fs.symlink(outsideFile, linkedFile);

      assert.throws(
        () => buildSteerContext({
          tmp: project,
          event: { pageUrl: 'http://localhost/' },
          wrapTarget: { tag: 'h1', classes: 'hero-title' },
          sourceFile: 'src/linked.jsx',
        }),
        /outside fixture project/,
      );
      await assert.rejects(
        applySteerEdits(project, {
          file: 'src/linked.jsx',
          edits: [{ find: 'Outside', replace: 'Changed' }],
        }),
        /outside fixture project/,
      );
      assert.equal(await fs.readFile(outsideFile, 'utf-8'), outsideContent);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('rejects manual-edit evidence that resolves outside the fixture project', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'impeccable-evidence-path-test-'));
    const project = path.join(workspace, 'project');
    const outsideFile = path.join(workspace, 'evidence.json');
    try {
      await fs.mkdir(project, { recursive: true });
      await fs.writeFile(outsideFile, JSON.stringify({ entries: [] }));
      await fs.symlink(outsideFile, path.join(project, 'evidence.json'));
      await assert.rejects(
        loadManualEditEventBatch({ evidencePath: 'evidence.json' }, { tmp: project }),
        /outside fixture project/,
      );
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
