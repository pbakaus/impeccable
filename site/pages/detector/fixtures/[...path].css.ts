import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FIXTURES_DIR = path.join(ROOT, 'tests', 'fixtures');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(fullPath));
    else if (entry.name.endsWith('.css')) out.push(fullPath);
  }
  return out;
}

export function getStaticPaths() {
  return walk(FIXTURES_DIR).map((filePath) => ({
    params: {
      path: path.relative(FIXTURES_DIR, filePath).replace(/\.css$/, '').split(path.sep).join('/'),
    },
    props: {
      filePath,
    },
  }));
}

export function GET({ props }: { props: { filePath: string } }) {
  return new Response(fs.readFileSync(props.filePath, 'utf-8'), {
    headers: {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
