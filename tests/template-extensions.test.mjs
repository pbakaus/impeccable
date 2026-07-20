import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  LIVE_TEMPLATE_EXTENSIONS,
  clearTemplateExtensionCache,
  matchConfiguredExtension,
  matchesTemplateExtension,
  resolveLiveTemplateExtensions,
} from '../skill/scripts/lib/template-extensions.mjs';
import { matchConfiguredExtension as fromHookLib } from '../skill/scripts/hook-lib.mjs';

describe('template-extensions — built-in list', () => {
  it('covers the frontend defaults plus Elixir markup', () => {
    for (const ext of ['.html', '.jsx', '.tsx', '.vue', '.svelte', '.astro', '.ex', '.heex', '.eex']) {
      assert.ok(LIVE_TEMPLATE_EXTENSIONS.includes(ext), `expected ${ext}`);
    }
  });

  it('leaves .exs out — those are Elixir scripts, not templates', () => {
    assert.ok(!LIVE_TEMPLATE_EXTENSIONS.includes('.exs'));
    assert.ok(!matchesTemplateExtension('mix.exs', LIVE_TEMPLATE_EXTENSIONS));
    assert.ok(!matchesTemplateExtension('config/runtime.exs', LIVE_TEMPLATE_EXTENSIONS));
  });
});

describe('template-extensions — matchesTemplateExtension', () => {
  it('matches on filename suffix, not path.extname', () => {
    // extname('show.html.erb') is '.erb', so an extname check would miss this.
    assert.ok(matchesTemplateExtension('show.html.erb', ['.html.erb']));
    assert.ok(matchesTemplateExtension('lib/app_web/root.html.heex', LIVE_TEMPLATE_EXTENSIONS));
  });

  it('matches plain extensions and is case-insensitive', () => {
    assert.ok(matchesTemplateExtension('Layouts.EX', LIVE_TEMPLATE_EXTENSIONS));
    assert.ok(matchesTemplateExtension('index.HTML', LIVE_TEMPLATE_EXTENSIONS));
  });

  it('rejects a file whose whole name is the extension', () => {
    assert.ok(!matchesTemplateExtension('.heex', LIVE_TEMPLATE_EXTENSIONS));
  });

  it('rejects non-markup files', () => {
    assert.ok(!matchesTemplateExtension('main.css', LIVE_TEMPLATE_EXTENSIONS));
    assert.ok(!matchesTemplateExtension('README.md', LIVE_TEMPLATE_EXTENSIONS));
  });
});

describe('template-extensions — hook-lib parity', () => {
  it('hook-lib re-exports the same matchConfiguredExtension', () => {
    assert.equal(fromHookLib, matchConfiguredExtension);
  });

  it('still prefers the longest configured suffix', () => {
    const match = matchConfiguredExtension('show.blade.php', ['.php', '.blade.php']);
    assert.equal(match.ext, '.blade.php');
    assert.equal(match.engine, 'html');
  });

  it('honours an explicit text engine', () => {
    const match = matchConfiguredExtension('mail.txt.erb', [{ ext: '.txt.erb', engine: 'text' }]);
    assert.equal(match.engine, 'text');
  });
});

describe('template-extensions — resolveLiveTemplateExtensions', () => {
  let tmp;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'impeccable-tmpl-ext-'));
    clearTemplateExtensionCache();
  });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('returns the built-ins when there is no config', () => {
    assert.deepEqual(resolveLiveTemplateExtensions(tmp), [...LIVE_TEMPLATE_EXTENSIONS]);
  });

  it('folds in detector.extensions so Live inherits what the hook was taught', () => {
    mkdirSync(join(tmp, '.impeccable'), { recursive: true });
    writeFileSync(
      join(tmp, '.impeccable', 'config.json'),
      JSON.stringify({ detector: { extensions: ['.blade.php', { ext: 'twig' }] } }),
    );
    const exts = resolveLiveTemplateExtensions(tmp);
    assert.ok(exts.includes('.blade.php'));
    assert.ok(exts.includes('.twig'), 'a bare string should be normalized to a dotted ext');
  });

  it('reads config.local.json as well', () => {
    mkdirSync(join(tmp, '.impeccable'), { recursive: true });
    writeFileSync(
      join(tmp, '.impeccable', 'config.local.json'),
      JSON.stringify({ detector: { extensions: ['.slim'] } }),
    );
    assert.ok(resolveLiveTemplateExtensions(tmp).includes('.slim'));
  });

  it('never duplicates a built-in', () => {
    mkdirSync(join(tmp, '.impeccable'), { recursive: true });
    writeFileSync(
      join(tmp, '.impeccable', 'config.json'),
      JSON.stringify({ detector: { extensions: ['.heex'] } }),
    );
    const exts = resolveLiveTemplateExtensions(tmp);
    assert.equal(exts.filter((e) => e === '.heex').length, 1);
  });

  it('survives malformed config without throwing', () => {
    mkdirSync(join(tmp, '.impeccable'), { recursive: true });
    writeFileSync(join(tmp, '.impeccable', 'config.json'), '{ not json');
    assert.deepEqual(resolveLiveTemplateExtensions(tmp), [...LIVE_TEMPLATE_EXTENSIONS]);
  });

  it('ignores a detector.extensions that is not an array', () => {
    mkdirSync(join(tmp, '.impeccable'), { recursive: true });
    writeFileSync(
      join(tmp, '.impeccable', 'config.json'),
      JSON.stringify({ detector: { extensions: '.blade.php' } }),
    );
    assert.deepEqual(resolveLiveTemplateExtensions(tmp), [...LIVE_TEMPLATE_EXTENSIONS]);
  });
});

describe('template-extensions — memoization', () => {
  let tmp;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'impeccable-tmpl-cache-'));
    clearTemplateExtensionCache();
  });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('serves repeat calls from cache', () => {
    const first = resolveLiveTemplateExtensions(tmp);
    assert.equal(resolveLiveTemplateExtensions(tmp), first, 'same array instance');
  });

  it('re-reads config after the cache is cleared', () => {
    assert.ok(!resolveLiveTemplateExtensions(tmp).includes('.blade.php'));
    mkdirSync(join(tmp, '.impeccable'), { recursive: true });
    writeFileSync(
      join(tmp, '.impeccable', 'config.json'),
      JSON.stringify({ detector: { extensions: ['.blade.php'] } }),
    );
    clearTemplateExtensionCache();
    assert.ok(resolveLiveTemplateExtensions(tmp).includes('.blade.php'));
  });
});
