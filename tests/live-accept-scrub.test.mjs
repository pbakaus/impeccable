import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeBuffer, readBuffer } from '../skill/scripts/live-manual-edits-buffer.mjs';
import { scrubManualEditsAgainstFile } from '../skill/scripts/live-accept.mjs';

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

describe('scrubManualEditsAgainstFile', () => {
  it('drops ops whose originalText is no longer in the file', () => {
    const file = path.join(tmpDir, 'page.html');
    fs.writeFileSync(file, '<div><p>Kept text</p></div>\n');

    writeBuffer(tmpDir, {
      entries: [
        entry({
          ops: [
            op({ ref: 'r1', originalText: 'Kept text' }),
            op({ ref: 'r2', originalText: 'Stale text not in file' }),
          ],
        }),
      ],
    });

    scrubManualEditsAgainstFile(file, tmpDir);

    const buf = readBuffer(tmpDir);
    assert.equal(buf.entries.length, 1);
    assert.equal(buf.entries[0].ops.length, 1);
    assert.equal(buf.entries[0].ops[0].ref, 'r1');
  });

  it('keeps ops whose originalText still appears in the file', () => {
    const file = path.join(tmpDir, 'page.html');
    fs.writeFileSync(file, '<div><p>Welcome</p><h2>Body copy</h2></div>\n');

    writeBuffer(tmpDir, {
      entries: [
        entry({ ops: [op({ ref: 'r1', originalText: 'Welcome' }), op({ ref: 'r2', originalText: 'Body copy' })] }),
      ],
    });

    scrubManualEditsAgainstFile(file, tmpDir);

    const buf = readBuffer(tmpDir);
    assert.equal(buf.entries[0].ops.length, 2);
  });

  it('prunes entries whose ops are all stale', () => {
    const file = path.join(tmpDir, 'page.html');
    fs.writeFileSync(file, '<div><p>Something else entirely</p></div>\n');

    writeBuffer(tmpDir, {
      entries: [
        entry({ id: 'doomed', ops: [op({ originalText: 'Gone A' }), op({ originalText: 'Gone B' })] }),
        entry({ id: 'survivor', ops: [op({ originalText: 'Something else entirely' })] }),
      ],
    });

    scrubManualEditsAgainstFile(file, tmpDir);

    const buf = readBuffer(tmpDir);
    assert.equal(buf.entries.length, 1);
    assert.equal(buf.entries[0].id, 'survivor');
  });

  it('is a no-op when the buffer is empty', () => {
    const file = path.join(tmpDir, 'page.html');
    fs.writeFileSync(file, '<div></div>\n');
    scrubManualEditsAgainstFile(file, tmpDir);
    assert.equal(readBuffer(tmpDir).entries.length, 0);
  });
});
