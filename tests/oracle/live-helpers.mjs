/**
 * Shared staging helpers for the live-* oracle cases (tests/oracle/cases/live-*.mjs).
 * Everything here writes deterministic state into a staged workspace.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { REPO_ROOT } from './lib.mjs';

export const LIVE_FILES = ['.impeccable/**', '.gitignore', '.gitfake/**', 'node_modules/.impeccable-live/**'];

/**
 * A `.git` FILE pointing at a non-repo gitdir. Marks the git boundary for
 * roots resolution and routes `ensureLiveGitIgnores` to `.gitfake/info/exclude`
 * (snapshotable, unlike a real `.git` dir), while `git check-ignore` exits 128
 * ("not a git repository") deterministically on every machine.
 */
export function fakeGit(ws, dir = '.') {
  const base = path.join(ws, dir);
  fs.writeFileSync(path.join(base, '.git'), 'gitdir: .gitfake\n');
  fs.mkdirSync(path.join(base, '.gitfake', 'info'), { recursive: true });
}

export function write(ws, rel, content) {
  const abs = path.join(ws, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

export function rm(ws, rel) {
  fs.rmSync(path.join(ws, rel), { recursive: true, force: true });
}

/** Link this repo's svelte compiler into the staged app (mirrors the unit tests). */
export function linkSvelte(ws) {
  fs.mkdirSync(path.join(ws, 'node_modules'), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules', 'svelte'), path.join(ws, 'node_modules', 'svelte'), 'dir');
}

/** Append fixed-timestamp journal entries for a session (session-store format). */
export function writeJournal(ws, id, events) {
  const lines = events.map((event, i) => JSON.stringify({
    seq: i + 1, id, type: event.type, ts: `2026-08-01T10:0${i % 10}:00.000Z`, event: { id, ...event },
  }));
  write(ws, `.impeccable/live/sessions/${id}.jsonl`, lines.join('\n') + '\n');
}

export function writeBuffer(ws, entries) {
  write(ws, '.impeccable/live/pending-manual-edits.json', JSON.stringify({ version: 1, entries }, null, 2) + '\n');
}

export function lockPathFor(ws, relFile) {
  const hash = crypto.createHash('sha256').update(path.resolve(ws, relFile)).digest('hex').slice(0, 24);
  return `.impeccable/live/locks/${hash}.lock`;
}

/** Fake-agent params, one kind per variant. */
export const PARAMS = {
  1: [{ id: 'lightness', kind: 'range', min: 0.3, max: 0.7, step: 0.05, default: 0.5, label: 'Lightness' }],
  2: [{ id: 'face', kind: 'steps', default: 'sans', label: 'Face', options: [{ value: 'sans', label: 'Sans' }, { value: 'serif', label: 'Serif' }, { value: 'mono', label: 'Mono' }] }],
  3: [{ id: 'italic', kind: 'toggle', default: false, label: 'Italic' }],
};

export function scopedCss(tag) {
  return [
    '@scope ([data-impeccable-variant="1"]) {',
    `  :scope > ${tag} {`,
    '    font-weight: 300;',
    '    color: oklch(var(--p-lightness, 0.5) 0.25 25);',
    '  }',
    '}',
    '@scope ([data-impeccable-variant="2"]) {',
    `  :scope > ${tag} { font-weight: 900; }`,
    `  :scope[data-p-face="serif"] > ${tag} { font-family: ui-serif, serif; }`,
    `  :scope[data-p-face="mono"]  > ${tag} { font-family: ui-monospace, monospace; }`,
    '}',
    '@scope ([data-impeccable-variant="3"]) {',
    `  :scope > ${tag} { font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }`,
    `  :scope[data-p-italic] > ${tag} { font-style: italic; }`,
    '}',
  ].join('\n');
}

/**
 * The agent-authored variants block in the exact format reference/live.md
 * prescribes (three variants: range / steps / toggle params), rendered in
 * HTML or JSX comment syntax at `indent` (the wrapper's indent).
 */
export function variantsBlock({ id, tag, inner, indent, jsx = false }) {
  const o = jsx ? '{/*' : '<!--';
  const c = jsx ? '*/}' : '-->';
  const css = scopedCss(tag).split('\n').map((l) => indent + '    ' + l);
  const style = jsx
    ? [indent + '  <style data-impeccable-css="' + id + '">{`', ...css, indent + '  `}</style>']
    : [indent + '  <style data-impeccable-css="' + id + '">', ...css, indent + '  </style>'];
  const blocks = [1, 2, 3].map((n) => {
    const hide = n === 1 ? '' : jsx ? " style={{display: 'none'}}" : ' style="display: none"';
    return [
      indent + '  ' + o + ' Variant ' + n + ' ' + c,
      indent + '  <div data-impeccable-variant="' + n + '"' + hide + " data-impeccable-params='" + JSON.stringify(PARAMS[n]) + "'>",
      indent + '    ' + inner,
      indent + '  </div>',
    ].join('\n');
  });
  return [...style, ...blocks].join('\n');
}

/** Replace-mode wrapper (as live-wrap writes it) with the variants block spliced in. */
export function wrappedBlock({ id, count = 3, tag, inner, original, indent, jsx = false }) {
  const o = jsx ? '{/*' : '<!--';
  const c = jsx ? '*/}' : '-->';
  const styleContents = jsx ? 'style={{ display: "contents" }}' : 'style="display: contents"';
  const variants = variantsBlock({ id, tag, inner, indent, jsx });
  if (jsx) {
    return [
      indent + '<div data-impeccable-variants="' + id + '" data-impeccable-variant-count="' + count + '" ' + styleContents + '>',
      indent + '  ' + o + ' impeccable-variants-start ' + id + ' ' + c,
      indent + '  ' + o + ' Original ' + c,
      indent + '  <div data-impeccable-variant="original">',
      indent + '    ' + original,
      indent + '  </div>',
      indent + '  ' + o + ' Variants: insert below this line ' + c,
      variants,
      indent + '  ' + o + ' impeccable-variants-end ' + id + ' ' + c,
      indent + '</div>',
    ].join('\n');
  }
  return [
    indent + o + ' impeccable-variants-start ' + id + ' ' + c,
    indent + '<div data-impeccable-variants="' + id + '" data-impeccable-variant-count="' + count + '" ' + styleContents + '>',
    indent + '  ' + o + ' Original ' + c,
    indent + '  <div data-impeccable-variant="original">',
    indent + '    ' + original,
    indent + '  </div>',
    indent + '  ' + o + ' Variants: insert below this line ' + c,
    variants,
    indent + '</div>',
    indent + o + ' impeccable-variants-end ' + id + ' ' + c,
  ].join('\n');
}

/** live-html index.html with the hero h1 wrapped and variants written. */
export function stageWrappedHtml(ws, id = 'ab12cd34') {
  const file = path.join(ws, 'index.html');
  const src = fs.readFileSync(file, 'utf8');
  const original = '<h1 id="hero" class="hero-title">Oracle Fixture</h1>';
  const block = wrappedBlock({ id, tag: 'h1', inner: '<h1 id="hero" class="hero-title">Oracle Fixture</h1>', original, indent: '      ' });
  fs.writeFileSync(file, src.replace('      ' + original, block));
}

/** live-vite src/App.jsx with the hero h1 wrapped and variants written (JSX syntax). */
export function stageWrappedJsx(ws, id = 'ab12cd34') {
  const file = path.join(ws, 'src', 'App.jsx');
  const src = fs.readFileSync(file, 'utf8');
  const original = '<h1 className="hero-title">Vite Fixture</h1>';
  const block = wrappedBlock({ id, tag: 'h1', inner: original, original, indent: '      ', jsx: true });
  fs.writeFileSync(file, src.replace('      ' + original, block));
}
