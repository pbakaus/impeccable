import { describe, test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  parseInlineIgnores,
  applyInlineIgnores,
  isInlineIgnored,
} from '../cli/engine/shared/inline-ignores.mjs';
import { detectText, detectHtml } from '../cli/engine/detect-antipatterns.mjs';

const CLI = path.resolve('cli/bin/cli.js');

function rules(finding) {
  return finding.antipattern;
}

describe('parseInlineIgnores', () => {
  test('whole-file directive collects rules', () => {
    const d = parseInlineIgnores('/* impeccable-disable overused-font, bounce-easing */');
    expect([...d.file].sort()).toEqual(['bounce-easing', 'overused-font']);
    expect(d.line.size).toBe(0);
    expect(d.nextLine.size).toBe(0);
  });

  test('bare directive and explicit * both mean every rule', () => {
    expect([...parseInlineIgnores('// impeccable-disable').file]).toEqual(['*']);
    expect([...parseInlineIgnores('// impeccable-disable *').file]).toEqual(['*']);
  });

  test('disable-line targets its own line, disable-next-line targets the line below', () => {
    const content = [
      'a',                                          // line 1
      'b /* impeccable-disable-line overused-font */', // line 2
      '// impeccable-disable-next-line side-tab',   // line 3 -> targets line 4
      'd',                                          // line 4
    ].join('\n');
    const d = parseInlineIgnores(content);
    expect([...d.line.get(2)]).toEqual(['overused-font']);
    expect([...d.nextLine.get(4)]).toEqual(['side-tab']);
  });

  test('strips eslint -- and biome : reasons from the rule list', () => {
    expect([...parseInlineIgnores('// impeccable-disable overused-font -- brand font, exported doc').file])
      .toEqual(['overused-font']);
    expect([...parseInlineIgnores('# impeccable-disable bounce-easing: intentional bounce').file])
      .toEqual(['bounce-easing']);
  });

  test('strips trailing comment closers across syntaxes', () => {
    expect([...parseInlineIgnores('<!-- impeccable-disable overused-font -->').file]).toEqual(['overused-font']);
    expect([...parseInlineIgnores('{/* impeccable-disable overused-font */}').file]).toEqual(['overused-font']);
    expect([...parseInlineIgnores('{# impeccable-disable overused-font #}').file]).toEqual(['overused-font']);
  });

  test('directive keyword is case-insensitive (fast-path matches the regex)', () => {
    expect([...parseInlineIgnores('// Impeccable-Disable overused-font').file]).toEqual(['overused-font']);
    expect([...parseInlineIgnores('/* IMPECCABLE-DISABLE-LINE side-tab */').line.get(1)]).toEqual(['side-tab']);
  });

  test('no directive present is a cheap no-op', () => {
    const d = parseInlineIgnores('.a { color: red }');
    expect(d.file.size).toBe(0);
    expect(d.line.size).toBe(0);
    expect(d.nextLine.size).toBe(0);
  });
});

describe('applyInlineIgnores / isInlineIgnored', () => {
  const findings = [
    { antipattern: 'overused-font', line: 5 },
    { antipattern: 'side-tab', line: 5 },
    { antipattern: 'overused-font', line: 0 }, // no line (static-HTML shape)
  ];

  test('whole-file directive drops every matching finding regardless of line', () => {
    const out = applyInlineIgnores(findings, '/* impeccable-disable overused-font */');
    expect(out.map(rules)).toEqual(['side-tab']);
  });

  test('* drops everything', () => {
    expect(applyInlineIgnores(findings, '// impeccable-disable *')).toEqual([]);
  });

  test('line-scoped directive only affects the matching line and rule', () => {
    const content = ['', '', '', '', 'x /* impeccable-disable-line overused-font */'].join('\n');
    const out = applyInlineIgnores(findings, content);
    // the line-5 overused-font goes; side-tab on line 5 and the line-less one stay
    expect(out.map(rules).sort()).toEqual(['overused-font', 'side-tab']);
    expect(out.some((f) => f.antipattern === 'overused-font' && f.line === 5)).toBe(false);
  });

  test('returns the input untouched when there are no directives', () => {
    const out = applyInlineIgnores(findings, '.a {}');
    expect(out).toBe(findings);
  });

  test('isInlineIgnored never matches a line-scoped directive for a line-less finding', () => {
    const d = parseInlineIgnores('x /* impeccable-disable-line overused-font */');
    expect(isInlineIgnored({ antipattern: 'overused-font', line: 0 }, d)).toBe(false);
  });
});

describe('detectText honors inline directives', () => {
  const opts = { providers: [] };

  test('disable-line suppresses a same-line finding', () => {
    const flagged = detectText('.a { font-family: Inter; }', 'a.css', opts);
    expect(flagged.some((f) => f.antipattern === 'overused-font')).toBe(true);

    const waived = detectText('.a { font-family: Inter; } /* impeccable-disable-line overused-font */', 'a.css', opts);
    expect(waived.some((f) => f.antipattern === 'overused-font')).toBe(false);
  });

  test('disable-next-line suppresses the finding on the following line', () => {
    const content = '/* impeccable-disable-next-line overused-font */\n.a { font-family: Inter; }';
    const waived = detectText(content, 'a.css', opts);
    expect(waived.some((f) => f.antipattern === 'overused-font')).toBe(false);
  });

  test('whole-file directive suppresses regardless of where the finding is', () => {
    const content = '/* impeccable-disable overused-font */\n.a {}\n.b { font-family: Inter; }';
    const waived = detectText(content, 'a.css', opts);
    expect(waived.some((f) => f.antipattern === 'overused-font')).toBe(false);
  });

  test('inlineIgnores:false bypasses the directive', () => {
    const content = '.a { font-family: Inter; } /* impeccable-disable-line overused-font */';
    const raw = detectText(content, 'a.css', { providers: [], inlineIgnores: false });
    expect(raw.some((f) => f.antipattern === 'overused-font')).toBe(true);
  });

  test('line keys align with detector line numbers on CRLF endings', () => {
    // detectText numbers lines with split('\n'); parseInlineIgnores must match.
    const content = '.a { font-family: Inter; }\r\n.b { font-family: Roboto; } /* impeccable-disable-line overused-font */';
    const out = detectText(content, 'a.css', opts);
    const fonts = out.filter((f) => f.antipattern === 'overused-font').map((f) => f.line);
    expect(fonts).toEqual([1]); // Inter on line 1 stays; Roboto on line 2 is waived
  });

  test('a directive for one rule leaves other findings intact', () => {
    const content = '.a { font-family: Inter; } /* impeccable-disable-line side-tab */';
    const out = detectText(content, 'a.css', opts);
    expect(out.some((f) => f.antipattern === 'overused-font')).toBe(true);
  });
});

describe('detectHtml honors whole-file directives (line-less findings)', () => {
  const page = (extra = '') => `<!DOCTYPE html><html><head>${extra}
<style>body { font-family: Inter, sans-serif; }</style></head>
<body><p>Some real paragraph text here for the typography pass.</p>
<h1>Heading</h1><h2>Sub</h2></body></html>`;

  test('overused-font fires without a directive', async () => {
    const flagged = await detectHtml(await writeTmp(page()), { providers: [] });
    expect(flagged.some((f) => f.antipattern === 'overused-font')).toBe(true);
  });

  test('whole-file directive in an HTML comment suppresses it', async () => {
    const file = await writeTmp(page('<!-- impeccable-disable overused-font -- exported brand doc -->'));
    const waived = await detectHtml(file, { providers: [] });
    expect(waived.some((f) => f.antipattern === 'overused-font')).toBe(false);
  });

  test('inlineIgnores:false bypasses it', async () => {
    const file = await writeTmp(page('<!-- impeccable-disable overused-font -->'));
    const raw = await detectHtml(file, { providers: [], inlineIgnores: false });
    expect(raw.some((f) => f.antipattern === 'overused-font')).toBe(true);
  });
});

describe('detect CLI end-to-end', () => {
  function run(args) {
    return spawnSync(process.execPath, [CLI, 'detect', ...args], { encoding: 'utf-8' });
  }

  test('inline directive is honored by default, --no-inline-ignores and --no-config bypass it', async () => {
    const file = await writeTmp(
      '<!DOCTYPE html><html><head><!-- impeccable-disable overused-font -->\n' +
      '<style>body { font-family: Inter, sans-serif; }</style></head>\n' +
      '<body><p>Paragraph copy for the typography analyzer to read.</p><h1>H</h1><h2>S</h2></body></html>',
      '.html',
    );

    const honored = run([file, '--json', '--no-design-system']);
    expect(JSON.parse(honored.stdout).some((f) => f.antipattern === 'overused-font')).toBe(false);

    const bypassed = run([file, '--json', '--no-design-system', '--no-inline-ignores']);
    expect(JSON.parse(bypassed.stdout).some((f) => f.antipattern === 'overused-font')).toBe(true);

    const rawConfig = run([file, '--json', '--no-config']);
    expect(JSON.parse(rawConfig.stdout).some((f) => f.antipattern === 'overused-font')).toBe(true);
  });
});

let tmpDir;
async function writeTmp(content, ext = '.html') {
  if (!tmpDir) tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-inline-'));
  const file = path.join(tmpDir, `f${Math.abs(hash(content))}${ext}`);
  fs.writeFileSync(file, content);
  return file;
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}
