import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeBuffer, readBuffer } from '../skill/scripts/live-manual-edits-buffer.mjs';
import { scrubManualEditsAgainstOriginalBlock } from '../skill/scripts/live-accept.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrub-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function entry({ id = 'e1', pageUrl = '/', ops = [] } = {}) {
  return { id, pageUrl, element: { tagName: 'p' }, ops, stagedAt: new Date().toISOString() };
}

function op({ ref = 'div>p.1', originalText = 'A', newText = 'B' } = {}) {
  return { ref, tag: 'p', classes: ['x'], originalText, newText };
}

describe('scrubManualEditsAgainstOriginalBlock', () => {
  it('drops only ops whose original or edited text appeared in the accepted original block', () => {
    writeBuffer(tmpDir, {
      entries: [
        entry({
          ops: [
            op({ ref: 'r1', originalText: 'Accepted original', newText: 'Accepted edited' }),
            op({ ref: 'r2', originalText: 'Accepted second', newText: 'Accepted second edited' }),
            op({ ref: 'r3', originalText: 'Outside text', newText: 'Outside edited' }),
          ],
        }),
      ],
    });

    scrubManualEditsAgainstOriginalBlock('<section><p>Accepted edited</p><p>Accepted second</p></section>', tmpDir, '/');

    const buf = readBuffer(tmpDir);
    assert.equal(buf.entries.length, 1);
    assert.equal(buf.entries[0].ops.length, 1);
    assert.equal(buf.entries[0].ops[0].ref, 'r3');
  });

  it('preserves cross-file staged edits even when their original text is absent from the accepted file', () => {
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'hero',
          ops: [op({ ref: 'hero-h1', originalText: 'Hero title', newText: 'Hero title edited' })],
        }),
        entry({
          id: 'header',
          ops: [op({ ref: 'header-nav', originalText: 'Docs', newText: 'Docs edited' })],
        }),
      ],
    });

    scrubManualEditsAgainstOriginalBlock('<h1>Hero title edited</h1>', tmpDir, '/');

    const buf = readBuffer(tmpDir);
    assert.equal(buf.entries.length, 1);
    assert.equal(buf.entries[0].id, 'header');
    assert.equal(buf.entries[0].ops[0].ref, 'header-nav');
  });

  it('prunes entries whose ops all belonged to the accepted block', () => {
    writeBuffer(tmpDir, {
      entries: [
        entry({ id: 'doomed', ops: [op({ originalText: 'Gone A', newText: 'New A' }), op({ originalText: 'Gone B', newText: 'New B' })] }),
        entry({ id: 'survivor', ops: [op({ originalText: 'Other source', newText: 'Other source edited' })] }),
      ],
    });

    scrubManualEditsAgainstOriginalBlock('<div><p>New A</p><p>Gone B</p></div>', tmpDir, '/');

    const buf = readBuffer(tmpDir);
    assert.equal(buf.entries.length, 1);
    assert.equal(buf.entries[0].id, 'survivor');
  });

  it('is a no-op when the buffer is empty', () => {
    scrubManualEditsAgainstOriginalBlock('<div></div>', tmpDir, '/');
    assert.equal(readBuffer(tmpDir).entries.length, 0);
  });

  it('only scrubs the accepted page and preserves matching text on other pages', () => {
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'home',
          pageUrl: '/',
          ops: [op({ ref: 'home-title', originalText: 'Shared label', newText: 'Shared edited' })],
        }),
        entry({
          id: 'docs',
          pageUrl: '/docs',
          ops: [op({ ref: 'docs-title', originalText: 'Shared label', newText: 'Shared edited' })],
        }),
      ],
    });

    scrubManualEditsAgainstOriginalBlock('<h1>Shared edited</h1>', tmpDir, '/');

    const buf = readBuffer(tmpDir);
    assert.equal(buf.entries.length, 1);
    assert.equal(buf.entries[0].id, 'docs');
    assert.equal(buf.entries[0].pageUrl, '/docs');
  });

  it('does not scrub anything without a page URL', () => {
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'home',
          pageUrl: '/',
          ops: [op({ ref: 'home-title', originalText: 'Accepted original', newText: 'Accepted edited' })],
        }),
      ],
    });

    scrubManualEditsAgainstOriginalBlock('<h1>Accepted edited</h1>', tmpDir);

    const buf = readBuffer(tmpDir);
    assert.equal(buf.entries.length, 1);
    assert.equal(buf.entries[0].ops.length, 1);
  });

  it('does not scrub ops whose copy is only a substring of the accepted block', () => {
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'home',
          ops: [
            op({ ref: 'short', originalText: 'Edit', newText: 'Save' }),
            op({ ref: 'exact', originalText: 'Cancel', newText: 'Done' }),
          ],
        }),
      ],
    });

    scrubManualEditsAgainstOriginalBlock('<div><button>Edit profile</button><button>Done</button></div>', tmpDir, '/');

    const buf = readBuffer(tmpDir);
    assert.equal(buf.entries.length, 1);
    assert.deepEqual(buf.entries[0].ops.map((item) => item.ref), ['short']);
  });
});
