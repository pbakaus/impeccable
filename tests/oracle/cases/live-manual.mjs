/**
 * Manual copy-edit helpers: `live-discard-manual-edits`,
 * `live-commit-manual-edits` (mock provider only: no codex/claude spawn),
 * driven from a staged pending-manual-edits.json buffer.
 */
import { LIVE_FILES, write, writeBuffer } from '../live-helpers.mjs';

const F = [...LIVE_FILES, 'index.html', 'src/**', 'public/**'];
const entry = (id, pageUrl, ops) => ({ id, pageUrl, element: { tagName: 'h1', classes: ['hero-title'] }, ops, stagedAt: '2026-08-01T00:00:00.000Z' });
const twoPages = (ws) => writeBuffer(ws, [
  entry('e1', '/', [{ ref: 'main>h1', tag: 'h1', classes: ['hero-title'], originalText: 'Oracle Fixture', newText: 'Oracle Fixture, renamed', sourceHint: { file: 'index.html', line: 13, column: 7 } }]),
  entry('e2', '/', [{ ref: 'main>p', tag: 'p', originalText: 'Minimal static page for oracle live-mode goldens.', newText: 'A tighter hook.' }, { ref: 'aside>p', tag: 'p', originalText: 'Nested content.', newText: 'Nested copy.' }]),
  entry('e3', '/docs/guide', [{ ref: 'article>p', tag: 'p', originalText: 'A second page covered by the config glob.', newText: 'Second page lead.' }]),
]);
const D = (id, args, setup, extra = {}) => ({ id, verb: 'live-discard-manual-edits', workspace: 'live-html', args, setup, files: F, ...extra });
const C = (id, args, setup, extra = {}) => ({ id, verb: 'live-commit-manual-edits', workspace: 'live-html', args, setup, files: F, ...extra });
const MOCK = { IMPECCABLE_LIVE_COPY_AGENT: 'mock' };

export default [
  D('live-discard-help', ['--help'], null),
  D('live-discard-empty', [], null),
  D('live-discard-all', [], twoPages),
  D('live-discard-page', ['--page-url=/'], twoPages),
  D('live-discard-page-no-match', ['--page-url=/nope'], twoPages),
  D('live-discard-page-bare-flag', ['--page-url'], twoPages),
  D('live-discard-twice', [], twoPages, { steps: [{}, {}] }),
  D('live-discard-invalid-buffer', [], (ws) => write(ws, '.impeccable/live/pending-manual-edits.json', '{ nope')),

  C('live-commit-help', ['--help'], null),
  C('live-commit-no-pending', [], null, { env: MOCK }),
  C('live-commit-no-pending-page', ['--page-url=/'], null, { env: MOCK }),
  C('live-commit-invalid-buffer', [], (ws) => write(ws, '.impeccable/live/pending-manual-edits.json', '{ nope'), { env: MOCK }),
  C('live-commit-mock-default-result', ['--provider=mock'], twoPages, {
    // Mock reports every entry applied but touched no files: source
    // verification finds the new text nowhere and refuses to clear.
    env: MOCK,
  }),
  C('live-commit-mock-applied-page', ['--page-url=/', '--provider=mock'], twoPages, {
    env: {
      ...MOCK,
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({ 'index.html': '<!DOCTYPE html>\n<html lang="en">\n  <body>\n    <main class="page">\n      <h1 id="hero" class="hero-title">Oracle Fixture, renamed</h1>\n      <p class="hero-hook">A tighter hook.</p>\n      <aside class="side-note"><p>Nested copy.</p></aside>\n    </main>\n  </body>\n</html>\n' }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({ status: 'done', appliedEntryIds: ['e1', 'e2'], failed: [], files: ['index.html'], notes: ['oracle mock'] }),
    },
  }),
  C('live-commit-mock-partial', ['--page-url=/', '--provider=mock'], twoPages, {
    env: {
      ...MOCK,
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({ 'index.html': '<html><body><h1 id="hero" class="hero-title">Oracle Fixture, renamed</h1><p class="hero-hook">Minimal static page for oracle live-mode goldens.</p><aside><p>Nested content.</p></aside></body></html>\n' }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({ status: 'partial', appliedEntryIds: ['e1'], failed: [{ entryId: 'e2', reason: 'ambiguous duplicate copy' }], files: ['index.html'] }),
    },
  }),
  C('live-commit-mock-error', ['--provider=mock'], twoPages, {
    env: { ...MOCK, IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({ status: 'error', message: 'agent gave up', appliedEntryIds: [], failed: [], files: [] }) },
  }),
  C('live-commit-mock-unreported-file-change', ['--page-url=/', '--provider=mock'], twoPages, {
    env: {
      ...MOCK,
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({ 'index.html': '<html><body><h1 id="hero" class="hero-title">Oracle Fixture, renamed</h1><p class="hero-hook">A tighter hook.</p><aside><p>Nested copy.</p></aside></body></html>\n' }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({ status: 'done', appliedEntryIds: ['e1', 'e2'], failed: [], files: [] }),
    },
  }),
  C('live-commit-mock-invalid-result-json', ['--provider=mock'], twoPages, {
    env: { ...MOCK, IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: '{not json' },
  }),
  C('live-commit-mock-leftover-marker-check', ['--page-url=/docs/guide', '--provider=mock'], twoPages, {
    env: {
      ...MOCK,
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({ 'public/docs/guide.html': '<html><body>\n<!-- impeccable-variants-start ab12cd34 -->\n<p class="doc-lead">Second page lead.</p>\n</body></html>\n' }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({ status: 'done', appliedEntryIds: ['e3'], failed: [], files: ['public/docs/guide.html'] }),
    },
  }),
  C('live-commit-mock-then-discard-remaining', ['--page-url=/docs/guide', '--provider=mock'], twoPages, {
    env: {
      ...MOCK,
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({ 'public/docs/guide.html': '<html><body><article class="doc"><h1 class="doc-title">Guide</h1><p class="doc-lead">Second page lead.</p></article></body></html>\n' }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({ status: 'done', appliedEntryIds: ['e3'], failed: [], files: ['public/docs/guide.html'] }),
    },
    steps: [{}, { verb: 'live-discard-manual-edits', args: [] }],
  }),
];
