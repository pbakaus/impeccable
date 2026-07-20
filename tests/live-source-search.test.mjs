import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { NEVER_SOURCE_DIRS, SOURCE_SEARCH_DIRS, findSourceFile } from '../skill/scripts/live/source-search.mjs';
import { LIVE_TEMPLATE_EXTENSIONS } from '../skill/scripts/lib/template-extensions.mjs';

const EXTS = LIVE_TEMPLATE_EXTENSIONS;

describe('live source-search — search roots', () => {
  it('puts lib/ ahead of the catch-all . walk', () => {
    assert.ok(SOURCE_SEARCH_DIRS.includes('lib'));
    assert.ok(SOURCE_SEARCH_DIRS.indexOf('lib') < SOURCE_SEARCH_DIRS.indexOf('.'));
  });

  it('never treats impeccable state as project source', () => {
    assert.ok(NEVER_SOURCE_DIRS.includes('.impeccable'));
    assert.ok(NEVER_SOURCE_DIRS.includes('node_modules'));
    assert.ok(NEVER_SOURCE_DIRS.includes('.git'));
  });
});

describe('live source-search — findSourceFile', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'impeccable-src-search-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  const write = (rel, body) => {
    const abs = join(tmp, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
    return abs;
  };

  it('finds a Phoenix ~H template inside lib/', () => {
    const abs = write('lib/my_app_web/components/layouts.ex', 'def nav(a) do\n  ~H"""\n  <nav class="topbar">x</nav>\n  """\nend\n');
    assert.equal(findSourceFile({ query: 'topbar', cwd: tmp, extensions: EXTS }), abs);
  });

  it('finds a .html.heex template', () => {
    const abs = write('lib/my_app_web/controllers/page_html/home.html.heex', '<section class="hero">x</section>\n');
    assert.equal(findSourceFile({ query: 'hero', cwd: tmp, extensions: EXTS }), abs);
  });

  it('skips .impeccable artifacts that carry the same marker', () => {
    // The bug this guards: staged revision artifacts hold the marker too, and
    // dot-directories sort before letters in the `.` walk.
    write('.impeccable/live/artifacts/abc-r1.html', '<!-- impeccable-variants-start abc -->\n');
    const real = write('views/home.html', '<!-- impeccable-variants-start abc -->\n');
    assert.equal(findSourceFile({ query: 'impeccable-variants-start abc', cwd: tmp, extensions: EXTS }), real);
  });

  it('never descends into node_modules', () => {
    write('node_modules/pkg/dist/index.html', '<div class="needle">x</div>\n');
    assert.equal(findSourceFile({ query: 'needle', cwd: tmp, extensions: EXTS }), null);
  });

  it('honours an extra skipDirs entry', () => {
    write('build/index.html', '<div class="needle">x</div>\n');
    assert.equal(
      findSourceFile({ query: 'needle', cwd: tmp, extensions: EXTS, skipDirs: [...NEVER_SOURCE_DIRS, 'build'] }),
      null,
    );
  });

  it('honours fileFilter rejections', () => {
    write('src/index.html', '<div class="needle">x</div>\n');
    assert.equal(
      findSourceFile({ query: 'needle', cwd: tmp, extensions: EXTS, fileFilter: () => false }),
      null,
    );
  });

  it('ignores files whose extension is not a template', () => {
    write('src/notes.md', 'needle\n');
    assert.equal(findSourceFile({ query: 'needle', cwd: tmp, extensions: EXTS }), null);
  });

  it('prefers a privileged root over the catch-all walk', () => {
    const preferred = write('src/page.html', '<div class="needle">a</div>\n');
    write('misc/page.html', '<div class="needle">b</div>\n');
    assert.equal(findSourceFile({ query: 'needle', cwd: tmp, extensions: EXTS }), preferred);
  });

  it('survives a broken symlink instead of throwing', () => {
    // live-wrap's copy of this walk called realpathSync unguarded, so one dangling
    // link anywhere in the tree took down the whole wrap.
    mkdirSync(join(tmp, 'src'), { recursive: true });
    symlinkSync(join(tmp, 'does-not-exist'), join(tmp, 'src', 'dangling'));
    const abs = write('src/page.html', '<div class="needle">x</div>\n');
    assert.equal(findSourceFile({ query: 'needle', cwd: tmp, extensions: EXTS }), abs);
  });

  it('does not loop on a self-referential symlink', () => {
    mkdirSync(join(tmp, 'src', 'inner'), { recursive: true });
    symlinkSync(join(tmp, 'src'), join(tmp, 'src', 'inner', 'loop'));
    assert.equal(findSourceFile({ query: 'needle', cwd: tmp, extensions: EXTS }), null);
  });

  it('returns null when nothing matches', () => {
    write('src/page.html', '<div class="other">x</div>\n');
    assert.equal(findSourceFile({ query: 'needle', cwd: tmp, extensions: EXTS }), null);
  });
});
