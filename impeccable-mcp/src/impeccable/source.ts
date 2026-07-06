import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type CommandMetadata = {
  description: string;
  argumentHint?: string;
};

export type ImpeccableSourceSnapshot = {
  repoRoot: string;
  commit: string;
  packageName: string;
  packageVersion: string;
  skillMarkdown: string;
  commandMetadata: Record<string, CommandMetadata>;
  references: Record<string, string>;
  harnessesMarkdown: string;
};

const requiredReferences = ['shape', 'critique', 'audit', 'polish'];
const sourceCache = new Map<string, Promise<ImpeccableSourceSnapshot>>();

function currentDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function candidateRoots(startDir: string): string[] {
  const roots: string[] = [];
  let cursor = path.resolve(startDir);
  while (true) {
    roots.push(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return roots;
}

function requiredPath(root: string, relativePath: string): string {
  return path.join(root, relativePath);
}

async function isImpeccableRoot(root: string): Promise<boolean> {
  const checks = [
    'package.json',
    'skill/SKILL.src.md',
    'skill/scripts/command-metadata.json',
    'docs/HARNESSES.md',
  ];
  return (await Promise.all(checks.map((item) => exists(requiredPath(root, item))))).every(Boolean);
}

export async function resolveImpeccableRepoRoot(startDir?: string): Promise<string> {
  const envRoot = process.env.IMPECCABLE_SOURCE_ROOT;
  if (envRoot) {
    const resolved = path.resolve(envRoot);
    if (await isImpeccableRoot(resolved)) return resolved;
    throw new Error(`IMPECCABLE_SOURCE_ROOT is not an Impeccable repo root: ${resolved}`);
  }

  const searchFrom = startDir ? path.resolve(startDir) : currentDir();
  for (const root of candidateRoots(searchFrom)) {
    if (await isImpeccableRoot(root)) return root;
  }

  throw new Error(`Unable to resolve Impeccable repo root from ${searchFrom}`);
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
}

async function readCommit(repoRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { timeout: 5_000 });
    return stdout.trim();
  } catch {
    return deploymentCommitFromEnv() ?? 'unknown';
  }
}

export function deploymentCommitFromEnv(): string | undefined {
  const candidates = [
    process.env.IMPECCABLE_SOURCE_COMMIT,
    process.env.RAILWAY_GIT_COMMIT_SHA,
    process.env.SOURCE_VERSION,
    process.env.GIT_COMMIT_SHA,
  ];
  return candidates.find((candidate) => candidate && /^[a-f0-9]{40}$/i.test(candidate));
}

async function readReferences(repoRoot: string): Promise<Record<string, string>> {
  const referenceDir = requiredPath(repoRoot, 'skill/reference');
  const entries = await fs.readdir(referenceDir);
  const markdownFiles = entries.filter((entry) => entry.endsWith('.md')).sort();
  const references: Record<string, string> = {};
  for (const file of markdownFiles) {
    const command = path.basename(file, '.md');
    references[command] = await fs.readFile(path.join(referenceDir, file), 'utf8');
  }
  for (const command of requiredReferences) {
    if (!Object.prototype.hasOwnProperty.call(references, command)) {
      throw new Error(`Missing required Impeccable reference: skill/reference/${command}.md`);
    }
  }
  return references;
}

async function readImpeccableSourceUncached(startDir?: string): Promise<ImpeccableSourceSnapshot> {
  const repoRoot = await resolveImpeccableRepoRoot(startDir);
  const packageJson = await readJson<{ name: string; version: string }>(requiredPath(repoRoot, 'package.json'));
  const commandMetadata = await readJson<Record<string, CommandMetadata>>(
    requiredPath(repoRoot, 'skill/scripts/command-metadata.json'),
  );
  const [skillMarkdown, harnessesMarkdown, references, commit] = await Promise.all([
    fs.readFile(requiredPath(repoRoot, 'skill/SKILL.src.md'), 'utf8'),
    fs.readFile(requiredPath(repoRoot, 'docs/HARNESSES.md'), 'utf8'),
    readReferences(repoRoot),
    readCommit(repoRoot),
  ]);

  return {
    repoRoot,
    commit,
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    skillMarkdown,
    commandMetadata,
    references,
    harnessesMarkdown,
  };
}

function sourceCacheKey(startDir?: string): string {
  return JSON.stringify({
    envRoot: process.env.IMPECCABLE_SOURCE_ROOT ? path.resolve(process.env.IMPECCABLE_SOURCE_ROOT) : undefined,
    startDir: startDir ? path.resolve(startDir) : undefined,
  });
}

export function clearImpeccableSourceCache(): void {
  sourceCache.clear();
}

export async function readImpeccableSource(startDir?: string): Promise<ImpeccableSourceSnapshot> {
  const cacheKey = sourceCacheKey(startDir);
  let cached = sourceCache.get(cacheKey);
  if (!cached) {
    cached = readImpeccableSourceUncached(startDir);
    sourceCache.set(cacheKey, cached);
  }
  try {
    return await cached;
  } catch (error) {
    sourceCache.delete(cacheKey);
    throw error;
  }
}

export function sourcePath(snapshot: ImpeccableSourceSnapshot, relativePath: string): string {
  return path.join(snapshot.repoRoot, relativePath);
}
