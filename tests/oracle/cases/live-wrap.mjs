/**
 * `live-wrap` and `live-insert` corpus: locator errors, replace/insert
 * wrappers across HTML / JSX / TSX / Astro / Vue / Svelte, deferred writes,
 * --text disambiguation, generated-file guards, buffer-aware originals.
 */
import { LIVE_FILES, linkSvelte, write, writeBuffer } from '../live-helpers.mjs';

const F = LIVE_FILES;
const W = (id, workspace, args, extra = {}) => ({ id, verb: 'live-wrap', workspace, args, files: [...F, ...(extra.snap || [])], ...extra });
const I = (id, workspace, args, extra = {}) => ({ id, verb: 'live-insert', workspace, args, files: [...F, ...(extra.snap || [])], ...extra });
const buffered = (ws, ops, pageUrl = '/') => writeBuffer(ws, [{ id: 'e1', pageUrl, element: { tagName: 'p' }, ops, stagedAt: '2026-08-01T00:00:00.000Z' }]);

export default [
  // --- argument / usage paths ---
  W('live-wrap-help', 'live-html', ['--help']),
  W('live-wrap-missing-id', 'live-html', ['--classes', 'hero-title']),
  W('live-wrap-missing-locator', 'live-html', ['--id', 'ab12cd34', '--tag', 'h1']),
  W('live-wrap-target-missing-value', 'live-html', ['--id', 'ab12cd34', '--classes', 'x', '--target']),
  W('live-wrap-element-not-found', 'live-html', ['--id', 'ab12cd34', '--classes', 'no-such-class']),
  W('live-wrap-element-not-in-source', 'live-html', ['--id', 'ab12cd34', '--classes', 'built-title']),
  W('live-wrap-file-is-generated', 'live-html', ['--id', 'ab12cd34', '--classes', 'built-title', '--file', 'dist/generated.html']),
  W('live-wrap-file-element-missing', 'live-html', ['--id', 'ab12cd34', '--classes', 'hero-title', '--file', 'src/cards.html']),
  // --- HTML replace wrappers ---
  W('live-wrap-html-by-id', 'live-html', ['--id', 'ab12cd34', '--count', '3', '--element-id', 'hero'], { snap: ['index.html'] }),
  W('live-wrap-html-by-classes-tag', 'live-html', ['--id', 'ab12cd34', '--classes', 'hero-title', '--tag', 'h1'], { snap: ['index.html'] }),
  W('live-wrap-html-by-query', 'live-html', ['--id', 'ab12cd34', '--count', '2', '--query', 'hero-hook'], { snap: ['index.html'] }),
  W('live-wrap-html-eq-form', 'live-html', ['--id=ab12cd34', '--count=1', '--element-id=features'], { snap: ['index.html'] }),
  W('live-wrap-html-multiline', 'live-html', ['--id', 'ab12cd34', '--classes', 'side-note', '--tag', 'aside'], { snap: ['index.html'] }),
  W('live-wrap-html-deferred', 'live-html', ['--id', 'ab12cd34', '--classes', 'side-note', '--tag', 'aside', '--defer-source-write'], { snap: ['index.html'] }),
  W('live-wrap-html-explicit-file', 'live-html', ['--id', 'ab12cd34', '--classes', 'doc-title', '--file', 'public/docs/guide.html'], { snap: ['public/**'] }),
  W('live-wrap-html-page-url-no-pending', 'live-html', ['--id', 'ab12cd34', '--element-id', 'hero', '--page-url', '/'], { snap: ['index.html'] }),
  // --- --text disambiguation (src/cards.html has three identical cards) ---
  W('live-wrap-text-picks-second', 'live-html', ['--id', 'ab12cd34', '--classes', 'card', '--tag', 'div', '--text', 'Beta card Second card body copy.', '--file', 'src/cards.html'], { snap: ['src/**'] }),
  W('live-wrap-text-ambiguous', 'live-html', ['--id', 'ab12cd34', '--classes', 'card-body', '--tag', 'p', '--text', 'card body copy', '--file', 'src/cards.html'], { snap: ['src/**'] }),
  W('live-wrap-text-not-in-source', 'live-html', ['--id', 'ab12cd34', '--classes', 'card', '--tag', 'div', '--text', 'Rendered from props elsewhere', '--file', 'src/cards.html'], { snap: ['src/**'] }),
  W('live-wrap-text-short-falls-back', 'live-html', ['--id', 'ab12cd34', '--classes', 'card', '--tag', 'div', '--text', 'zzz', '--file', 'src/cards.html'], { snap: ['src/**'] }),
  W('live-wrap-no-text-first-match', 'live-html', ['--id', 'ab12cd34', '--classes', 'card', '--tag', 'div', '--file', 'src/cards.html'], { snap: ['src/**'] }),
  // --- JSX / TSX / Astro / Vue ---
  W('live-wrap-jsx', 'live-vite', ['--id', 'ab12cd34', '--classes', 'hero-title', '--tag', 'h1'], { snap: ['src/**'] }),
  W('live-wrap-jsx-deferred', 'live-vite', ['--id', 'ab12cd34', '--classes', 'hero-title', '--tag', 'h1', '--defer-source-write'], { snap: ['src/**'] }),
  W('live-wrap-jsx-mapped-item', 'live-vite', ['--id', 'ab12cd34', '--classes', 'item-row', '--tag', 'li', '--text', 'First'], { snap: ['src/**'] }),
  W('live-wrap-tsx-multiline', 'live-vite', ['--id', 'ab12cd34', '--classes', 'panel', '--tag', 'section'], { snap: ['src/**'] }),
  W('live-wrap-astro', 'live-astro', ['--id', 'ab12cd34', '--classes', 'hero-title', '--tag', 'h1'], { snap: ['src/**'] }),
  W('live-wrap-astro-deferred', 'live-astro', ['--id', 'ab12cd34', '--element-id', 'features', '--defer-source-write'], { snap: ['src/**'] }),
  W('live-wrap-vue', 'live-nuxt', ['--id', 'ab12cd34', '--classes', 'hero-title', '--tag', 'h1'], { snap: ['pages/**'] }),
  W('live-wrap-tanstack-tsx', 'live-tanstack', ['--id', 'ab12cd34', '--classes', 'hero-title', '--tag', 'h1'], { snap: ['src/**'] }),
  W('live-wrap-monorepo-child-from-root', 'live-monorepo', ['--id', 'ab12cd34', '--classes', 'hero-title', '--tag', 'h1', '--target', 'website'], { snap: ['website/src/**', 'website/.impeccable/**'] }),
  // --- Svelte: no compiler -> source-preview fallback; with compiler -> component preview ---
  W('live-wrap-svelte-no-compiler', 'live-sveltekit', ['--id', 'ab12cd34', '--classes', 'hero-title', '--tag', 'h1'], { snap: ['src/**'] }),
  W('live-wrap-svelte-env-disabled', 'live-sveltekit', ['--id', 'ab12cd34', '--classes', 'hero-title', '--tag', 'h1'], { snap: ['src/**'], env: { IMPECCABLE_LIVE_SVELTE_COMPONENT: '0' }, setup: linkSvelte }),
  W('live-wrap-svelte-component', 'live-sveltekit', ['--id', 'ab12cd34', '--classes', 'hero-title', '--tag', 'h1'], { snap: ['src/**'], setup: linkSvelte }),
  W('live-wrap-svelte-component-each', 'live-sveltekit', ['--id', 'ab12cd34', '--classes', 'expense-list', '--tag', 'ul'], { snap: ['src/**'], setup: linkSvelte }),
  W('live-wrap-svelte-component-refused-script', 'live-sveltekit', ['--id', 'ab12cd34', '--classes', 'page', '--tag', 'main'], {
    snap: ['src/**'], setup: (ws) => { linkSvelte(ws); write(ws, 'src/routes/+page.svelte', '<main class="page">\n  <script>let x = 1;</script>\n  <h1>Hi</h1>\n</main>\n'); },
  }),
  W('live-wrap-svelte-component-twice', 'live-sveltekit', ['--id', 'ab12cd34', '--classes', 'hero-title', '--tag', 'h1'], { snap: ['src/**'], setup: linkSvelte, steps: [{}, {}] }),
  // --- pending manual edits ---
  W('live-wrap-pending-edits-no-page-url', 'live-html', ['--id', 'ab12cd34', '--classes', 'hero-hook', '--tag', 'p'], {
    snap: ['index.html'], setup: (ws) => buffered(ws, [{ ref: 'main>p.hero-hook', tag: 'p', originalText: 'Minimal static page for oracle live-mode goldens.', newText: 'Edited hook copy.' }]),
  }),
  W('live-wrap-pending-edits-applied', 'live-html', ['--id', 'ab12cd34', '--classes', 'hero-hook', '--tag', 'p', '--page-url', '/'], {
    snap: ['index.html'], setup: (ws) => buffered(ws, [{ ref: 'main>p.hero-hook', tag: 'p', originalText: 'Minimal static page for oracle live-mode goldens.', newText: 'Edited hook copy.' }]),
  }),
  W('live-wrap-pending-edits-other-page', 'live-html', ['--id', 'ab12cd34', '--classes', 'hero-hook', '--tag', 'p', '--page-url', '/about'], {
    snap: ['index.html'], setup: (ws) => buffered(ws, [{ ref: 'main>p.hero-hook', tag: 'p', originalText: 'Minimal static page for oracle live-mode goldens.', newText: 'Edited hook copy.' }]),
  }),
  W('live-wrap-pending-edits-ambiguous', 'live-html', ['--id', 'ab12cd34', '--classes', 'cards', '--tag', 'section', '--file', 'src/cards.html', '--page-url', '/'], {
    snap: ['src/**'], setup: (ws) => buffered(ws, [{ ref: 'section>div>p', tag: 'p', originalText: 'card body copy.', newText: 'card body text.' }]),
  }),
  W('live-wrap-pending-edits-unrelated', 'live-html', ['--id', 'ab12cd34', '--element-id', 'hero'], {
    snap: ['index.html'], setup: (ws) => buffered(ws, [{ ref: 'x', tag: 'p', originalText: 'Some other page copy', newText: 'x' }]),
  }),

  // --- live-insert.mjs ---
  I('live-insert-help', 'live-html', ['--help']),
  I('live-insert-missing-id', 'live-html', ['--position', 'after', '--element-id', 'features']),
  I('live-insert-missing-position', 'live-html', ['--id', 'ab12cd34', '--element-id', 'features']),
  I('live-insert-invalid-position', 'live-html', ['--id', 'ab12cd34', '--position', 'below', '--element-id', 'features']),
  I('live-insert-missing-locator', 'live-html', ['--id', 'ab12cd34', '--position', 'after']),
  I('live-insert-element-not-found', 'live-html', ['--id', 'ab12cd34', '--position', 'after', '--classes', 'nope']),
  I('live-insert-element-not-in-source', 'live-html', ['--id', 'ab12cd34', '--position', 'after', '--classes', 'built-title']),
  I('live-insert-file-is-generated', 'live-html', ['--id', 'ab12cd34', '--position', 'after', '--classes', 'built-title', '--file', 'dist/generated.html']),
  I('live-insert-html-after', 'live-html', ['--id', 'ab12cd34', '--position', 'after', '--element-id', 'features'], { snap: ['index.html'] }),
  I('live-insert-html-before', 'live-html', ['--id', 'ab12cd34', '--count', '2', '--position', 'before', '--element-id', 'features'], { snap: ['index.html'] }),
  I('live-insert-html-deferred', 'live-html', ['--id', 'ab12cd34', '--position', 'after', '--classes', 'side-note', '--tag', 'aside', '--defer-source-write'], { snap: ['index.html'] }),
  I('live-insert-html-text-ambiguous', 'live-html', ['--id', 'ab12cd34', '--position', 'after', '--classes', 'card-body', '--tag', 'p', '--text', 'card body copy', '--file', 'src/cards.html'], { snap: ['src/**'] }),
  I('live-insert-html-text-picks', 'live-html', ['--id', 'ab12cd34', '--position', 'before', '--classes', 'card', '--tag', 'div', '--text', 'Gamma card Third card body copy.', '--file', 'src/cards.html'], { snap: ['src/**'] }),
  I('live-insert-jsx-after', 'live-vite', ['--id', 'ab12cd34', '--position', 'after', '--element-id', 'features'], { snap: ['src/**'] }),
  I('live-insert-jsx-before-deferred', 'live-vite', ['--id', 'ab12cd34', '--position', 'before', '--classes', 'hero-title', '--tag', 'h1', '--defer-source-write'], { snap: ['src/**'] }),
  I('live-insert-astro-after', 'live-astro', ['--id', 'ab12cd34', '--position', 'after', '--element-id', 'features'], { snap: ['src/**'] }),
  I('live-insert-vue-after', 'live-nuxt', ['--id', 'ab12cd34', '--position', 'after', '--classes', 'hero-hook', '--tag', 'p'], { snap: ['pages/**'] }),
  I('live-insert-svelte-component', 'live-sveltekit', ['--id', 'ab12cd34', '--position', 'after', '--element-id', 'features'], { snap: ['src/**'] }),
  I('live-insert-svelte-env-disabled', 'live-sveltekit', ['--id', 'ab12cd34', '--position', 'after', '--element-id', 'features'], { snap: ['src/**'], env: { IMPECCABLE_LIVE_SVELTE_COMPONENT: 'false' } }),
];
