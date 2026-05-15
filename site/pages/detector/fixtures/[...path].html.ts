import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FIXTURES_DIR = path.join(ROOT, 'tests', 'fixtures');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(fullPath));
    else if (entry.name.endsWith('.html')) out.push(fullPath);
  }
  return out;
}

export function getStaticPaths() {
  return walk(FIXTURES_DIR).map((filePath) => ({
    params: {
      path: path.relative(FIXTURES_DIR, filePath).replace(/\.html$/, '').split(path.sep).join('/'),
    },
    props: {
      filePath,
    },
  }));
}

function withDetectorScript(html: string) {
  if (html.includes('detect-antipatterns-browser.js')) return html;
  const script = [
    '<script>',
    'window.__IMPECCABLE_CONFIG__ = { ...(window.__IMPECCABLE_CONFIG__ || {}), autoScan: true };',
    '</script>',
    '<script src="/js/detect-antipatterns-browser.js"></script>',
  ].join('');
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${script}</body>`);
  return `${html}${script}`;
}

export function GET({ props }: { props: { filePath: string } }) {
  return new Response(withDetectorScript(fs.readFileSync(props.filePath, 'utf-8')), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
