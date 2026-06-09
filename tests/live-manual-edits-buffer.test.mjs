import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  readBuffer,
  readBufferStrict,
  writeBuffer,
  stageEntry,
  removeEntries,
  countByPage,
  truncateBuffer,
  getBufferPath,
} from '../skill/scripts/live/manual-edits-buffer.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buffer-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function entry({ id = 'e1', pageUrl = '/', element = { tagName: 'p' }, ops = [] } = {}) {
  return {
    id,
    pageUrl,
    element,
    ops,
  };
}

function op({ ref = 'div>p.1', originalText = 'A', newText = 'B', ...rest } = {}) {
  return { ref, tag: 'p', classes: ['x'], originalText, newText, ...rest };
}

describe('live-manual-edits-buffer', () => {
  describe('readBuffer', () => {
    it('returns empty shape when file is missing', () => {
      const buf = readBuffer(tmpDir);
      assert.deepEqual(buf, { version: 1, entries: [] });
    });

    it('returns empty shape when file is malformed JSON', () => {
      const filePath = getBufferPath(tmpDir);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '{ this is not json');
      const buf = readBuffer(tmpDir);
      assert.deepEqual(buf.entries, []);
    });

    it('strict mode throws when the buffer is malformed JSON', () => {
      const filePath = getBufferPath(tmpDir);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '{ this is not json');
      assert.throws(() => readBufferStrict(tmpDir), /manual_edit_buffer_unreadable/);
    });

    it('returns empty shape when entries array is missing', () => {
      const filePath = getBufferPath(tmpDir);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({ version: 1 }));
      const buf = readBuffer(tmpDir);
      assert.deepEqual(buf.entries, []);
    });
  });

  describe('stageEntry', () => {
    it('adds a new entry for a novel (pageUrl, ref)', () => {
      stageEntry(tmpDir, entry({ ops: [op()] }));
      const buf = readBuffer(tmpDir);
      assert.equal(buf.entries.length, 1);
      assert.equal(buf.entries[0].ops.length, 1);
      assert.equal(buf.entries[0].ops[0].originalText, 'A');
      assert.equal(buf.entries[0].ops[0].newText, 'B');
    });

    it('merges by (pageUrl, ref): re-edit updates newText, keeps originalText', () => {
      stageEntry(tmpDir, entry({ ops: [op({ originalText: 'A', newText: 'B' })] }));
      stageEntry(tmpDir, entry({ ops: [op({ originalText: 'IGNORED', newText: 'C' })] }));
      const buf = readBuffer(tmpDir);
      assert.equal(buf.entries.length, 1);
      assert.equal(buf.entries[0].ops.length, 1);
      assert.equal(buf.entries[0].ops[0].originalText, 'A');
      assert.equal(buf.entries[0].ops[0].newText, 'C');
    });

    it('merges by (pageUrl, ref): re-edit refreshes DOM and source evidence', () => {
      stageEntry(tmpDir, entry({
        element: { tagName: 'section', textContent: 'first' },
        ops: [op({
          originalText: 'A',
          newText: 'B',
          sourceHint: { file: 'src/old.jsx', line: 1 },
          leaf: { textContent: 'first' },
        })],
      }));
      stageEntry(tmpDir, entry({
        element: { tagName: 'section', textContent: 'second' },
        ops: [op({
          originalText: 'IGNORED',
          newText: 'C',
          sourceHint: { file: 'src/new.jsx', line: 4 },
          leaf: { textContent: 'second' },
          nearbyEditableTexts: [{ text: 'fresh sibling' }],
        })],
      }));
      const buf = readBuffer(tmpDir);
      assert.equal(buf.entries[0].ops[0].originalText, 'A');
      assert.equal(buf.entries[0].ops[0].newText, 'C');
      assert.deepEqual(buf.entries[0].ops[0].sourceHint, { file: 'src/new.jsx', line: 4 });
      assert.equal(buf.entries[0].ops[0].leaf.textContent, 'second');
      assert.equal(buf.entries[0].ops[0].nearbyEditableTexts[0].text, 'fresh sibling');
      assert.equal(buf.entries[0].element.textContent, 'second');
    });

    it('keeps separate entries per pageUrl even for the same ref', () => {
      stageEntry(tmpDir, entry({ id: 'a', pageUrl: '/a', ops: [op({ newText: 'A' })] }));
      stageEntry(tmpDir, entry({ id: 'b', pageUrl: '/b', ops: [op({ newText: 'B' })] }));
      const buf = readBuffer(tmpDir);
      assert.equal(buf.entries.length, 2);
    });
  });

  describe('removeEntries', () => {
    it('returns count of ops removed, not entries', () => {
      stageEntry(tmpDir, entry({ id: 'a', pageUrl: '/a', ops: [op({ ref: 'r1' }), op({ ref: 'r2' }), op({ ref: 'r3' })] }));
      stageEntry(tmpDir, entry({ id: 'b', pageUrl: '/b', ops: [op({ ref: 'r4' })] }));
      const removed = removeEntries(tmpDir, (e) => e.pageUrl === '/a');
      assert.equal(removed, 3); // 3 ops in the /a entry, not 1 entry
      assert.equal(readBuffer(tmpDir).entries.length, 1);
    });

    it('prunes empty entries defensively', () => {
      const filePath = getBufferPath(tmpDir);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({
        version: 1,
        entries: [
          { id: 'a', pageUrl: '/', ops: [], element: {} },
          { id: 'b', pageUrl: '/', ops: [op()], element: {} },
        ],
      }));
      removeEntries(tmpDir, () => false);
      const buf = readBuffer(tmpDir);
      assert.equal(buf.entries.length, 1);
      assert.equal(buf.entries[0].id, 'b');
    });
  });

  describe('countByPage', () => {
    it('returns totalCount and perPage by op count', () => {
      stageEntry(tmpDir, entry({ id: 'a', pageUrl: '/a', ops: [op({ ref: 'r1' }), op({ ref: 'r2' })] }));
      stageEntry(tmpDir, entry({ id: 'b', pageUrl: '/b', ops: [op({ ref: 'r3' })] }));
      const { totalCount, perPage } = countByPage(tmpDir);
      assert.equal(totalCount, 3);
      assert.equal(perPage['/a'], 2);
      assert.equal(perPage['/b'], 1);
    });

    it('returns zero for an empty buffer', () => {
      const { totalCount, perPage } = countByPage(tmpDir);
      assert.equal(totalCount, 0);
      assert.deepEqual(perPage, {});
    });
  });

  describe('truncateBuffer', () => {
    it('returns count of ops removed and empties the buffer', () => {
      stageEntry(tmpDir, entry({ ops: [op({ ref: 'r1' }), op({ ref: 'r2' })] }));
      stageEntry(tmpDir, entry({ id: 'b', pageUrl: '/b', ops: [op({ ref: 'r3' })] }));
      const removed = truncateBuffer(tmpDir);
      assert.equal(removed, 3);
      assert.equal(readBuffer(tmpDir).entries.length, 0);
    });

    it('returns zero for an already-empty buffer', () => {
      assert.equal(truncateBuffer(tmpDir), 0);
    });
  });
});
