#!/usr/bin/env node
/**
 * Context-signals gatherer for the bare Impeccable invocation
 * (no-argument) path. Collects cheap, deterministic signals about the current
 * project and emits them as JSON.
 *
 * It does NOT score or rank. The agent reasons over the raw signals using its
 * knowledge of the command catalog (see SKILL.md routing rule 1). Deliberately
 * light: no LLM calls, no detector run (`npx impeccable detect` is heavier and
 * opt-in), no file writes. Every probe is best-effort and never throws; the
 * output is always valid JSON.
 *
 * Signals:
 *   - setup:     PRODUCT.md / DESIGN.md presence and whether code exists
 *   - critique:  the latest cached critique score (.impeccable/critique)
 *   - git:       branch + files changed vs the default branch (a scope hint)
 *   - devServer: whether a local dev server answers on a common port (gates live)
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadContext, extractPlatform } from './context.mjs';
import { getCritiqueDir } from './lib/impeccable-paths.mjs';

/** Is there code here at all, or just context files / an empty repo? */
function hasCode(cwd) {
  if (fs.existsSync(path.join(cwd, 'package.json'))) return true;
  for (const d of ['src', 'app', 'pages', 'site', 'public', 'components', 'lib']) {
    if (fs.existsSync(path.join(cwd, d))) return true;
  }
  return false;
}

/**
 * The most recent critique snapshot across all targets. Filenames are
 * timestamp-prefixed (`<iso>__<slug>.md`), so a lexical sort is chronological.
 * Parses the small frontmatter for score + P0/P1 counts.
 */
function latestCritique(cwd) {
  try {
    const dir = getCritiqueDir(cwd);
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
    if (!files.length) return null;
    const newest = files[files.length - 1];
    const text = fs.readFileSync(path.join(dir, newest), 'utf-8');
    const front = text.split('---')[1] || '';
    const get = (k) => {
      const m = front.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'));
      return m ? m[1].trim() : null;
    };
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      slug: get('slug'),
      score: num(get('score')),
      p0: num(get('p0')),
      p1: num(get('p1')),
      timestamp: get('timestamp'),
      file: path.relative(cwd, path.join(dir, newest)),
    };
  } catch {
    return null;
  }
}

/** Branch + a scope hint: files changed vs the default branch, else working tree. */
function gitSignals(cwd) {
  const run = (args, { trim = true } = {}) => {
    try {
      const out = execFileSync('git', args, {
        cwd,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return trim ? out.trim() : out;
    } catch {
      return null;
    }
  };
  if (run(['rev-parse', '--is-inside-work-tree']) !== 'true') {
    return { isRepo: false, branch: null, base: null, changedFiles: [], changedCount: 0 };
  }
  const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']);
  // The merge target is detected, not assumed. A hardcoded main/master list
  // diffed develop-based repos against the wrong base, so git.changedFiles
  // carried the whole develop/main divergence into scan.targets (issue
  // #302). Signals, most specific first: the branch's configured upstream
  // (@{u}; a branch pushed with -u tracks itself and is skipped by the
  // self-check), then the remote's default-branch symref (origin/HEAD),
  // then the conventional integration names. The conventional fallbacks
  // are withheld when the current branch IS one of them: sitting on main
  // in a repo that also has develop must not diff the two integration
  // branches against each other.
  // Candidates carry a display name (what git.base reports) and the revs to
  // try, in order. A remote ref like `upstream/release` (fork workflows) or
  // an origin/HEAD target with no local checkout is a perfectly good diff
  // base, so revs are not limited to local branch names.
  const remotes = (run(['remote']) || '').split('\n').filter(Boolean);
  // Read @{u} as a FULL symbolic ref: refs/heads/... is a local upstream
  // (branch.<x>.remote = "."), refs/remotes/<r>/... is remote-tracking. No
  // string guessing on the abbreviated form survives contact with reality:
  // a local upstream named release/2.0 is one branch name, and a local
  // feature/foo beside a remote actually named "feature" is only told apart
  // from feature's remote-tracking refs by the full ref namespace.
  const resolveUpstream = () => {
    const full = run(['rev-parse', '--symbolic-full-name', '@{u}']);
    if (!full) return null;
    if (full.startsWith('refs/heads/')) {
      const name = full.slice('refs/heads/'.length);
      return { name, rev: name };
    }
    if (full.startsWith('refs/remotes/')) {
      const rest = full.slice('refs/remotes/'.length);
      const i = rest.indexOf('/');
      if (i > 0) return { name: rest.slice(i + 1), rev: rest };
    }
    return null;
  };
  const conventional = ['develop', 'main', 'master'];
  // On an integration branch itself the scope hint is the working tree. No
  // signal may override that: an origin/HEAD or upstream naming a DIFFERENT
  // integration branch (sitting on develop while the remote default is
  // main) would produce exactly the integration-vs-integration divergence
  // this detection exists to prevent. "Integration branch" means a
  // conventional name OR any remote's default branch (origin first, but a
  // fork-parent layout may only have an `upstream` remote), so a
  // non-standard default like trunk is guarded the same way. A detached
  // checkout (branch reads as the literal `HEAD`) has no branch identity to
  // diff for and keeps the working-tree scope too.
  const remoteHeads = [];
  for (const r of [...new Set(['origin', ...remotes])]) {
    // The symref's own prefix is the remote just queried, so it is stripped
    // directly; the remote need not be in `git remote` output (tests and
    // partial clones fabricate refs/remotes/origin/* without a remote).
    const ref = run(['symbolic-ref', '--short', `refs/remotes/${r}/HEAD`]);
    if (ref && ref.startsWith(`${r}/`)) remoteHeads.push({ name: ref.slice(r.length + 1), rev: ref });
  }
  const onIntegrationBranch = branch === 'HEAD'
    || conventional.includes(branch)
    || remoteHeads.some((head) => head.name === branch);
  let base = null;
  let baseRev = null;
  if (!onIntegrationBranch) {
    const upstream = resolveUpstream();
    // Every named candidate tries the local branch first, then that name on
    // every remote (origin first). Covering all remotes up front is what
    // makes the name-level dedup below safe: a develop or main that exists
    // only as upstream/<name> still resolves even though origin's candidate
    // claimed the name first.
    const remoteOrder = ['origin', ...remotes.filter((name) => name !== 'origin')];
    const revsFor = (name) => [name, ...remoteOrder.map((r) => `${r}/${name}`)];
    const candidates = [];
    const seen = new Set();
    const addCandidate = (name, revs) => {
      if (!name || name === branch || seen.has(name)) return;
      seen.add(name);
      candidates.push({ name, revs });
    };
    // The upstream tracks the actual merge target, so its own rev wins over
    // a possibly stale local branch of the same name.
    if (upstream) addCandidate(upstream.name, [upstream.rev]);
    // A develop branch marks a git-flow repo where features merge to develop
    // even when the platform default (origin/HEAD) was never flipped off
    // main; an existing develop therefore outranks the remote default. This
    // is #302's own repro shape, and repos without develop are unaffected.
    // A remote's advertised default prefers its own remote-tracking rev over
    // a possibly stale local checkout of the same name, for the same reason
    // the upstream candidate leads with its rev. That applies to the develop
    // candidate too when the remote default IS develop: it sits before the
    // remote-default entries in the order, so it must lead with their rev
    // itself or a stale local develop would win.
    const advertisedRevs = (name) => remoteHeads.filter((head) => head.name === name).map((head) => head.rev);
    addCandidate('develop', [...new Set([...advertisedRevs('develop'), ...revsFor('develop')])]);
    for (const head of remoteHeads) addCandidate(head.name, [...new Set([head.rev, ...revsFor(head.name)])]);
    for (const name of ['main', 'master']) addCandidate(name, revsFor(name));
    for (const c of candidates) {
      const rev = c.revs.find((r) => run(['rev-parse', '--verify', '--quiet', r]) !== null);
      if (rev) {
        base = c.name;
        baseRev = rev;
        break;
      }
    }
  }
  const diffBase = base && branch && branch !== base ? base : null;
  const fromDiff = diffBase ? run(['diff', '--name-only', `${baseRev}...HEAD`]) : null;
  // porcelain lines are `XY PATH`: a 2-char status + a space, then the path.
  // Don't trim the combined output — an unstaged-modified line starts with a
  // leading space (` M path`), and a global trim would eat the first line's
  // status column and shift the slice. Renames render as `old -> new`.
  const fromStatus = run(['-c', 'core.quotepath=false', 'status', '--porcelain'], { trim: false });
  let changed = [];
  if (fromDiff) {
    changed = fromDiff.split('\n').filter(Boolean);
  } else if (fromStatus) {
    changed = fromStatus.split(/\r?\n/).filter(Boolean).map((l) => {
      const p = l.slice(3);
      const arrow = p.indexOf(' -> ');
      return arrow === -1 ? p : p.slice(arrow + 4);
    });
  }
  return {
    isRepo: true,
    branch,
    base: diffBase,
    changedFiles: changed.slice(0, 50),
    changedCount: changed.length,
  };
}

const COMMON_DEV_PORTS = [4321, 3000, 5173, 5174, 8080, 8000, 4200];

function probePort(port, timeout = 250) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch { /* ignore */ }
      resolve(ok);
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, '127.0.0.1');
  });
}

async function devServerSignals() {
  const open = [];
  await Promise.all(
    COMMON_DEV_PORTS.map(async (p) => {
      if (await probePort(p)) open.push(p);
    }),
  );
  open.sort((a, b) => a - b);
  return { running: open.length > 0, ports: open };
}

// Extensions the detector scans (mirrors the engine's walkDir set + HTML).
const SCANNABLE_EXT = new Set([
  '.html', '.htm', '.css', '.scss',
  '.jsx', '.tsx', '.js', '.ts', '.vue', '.svelte', '.astro',
]);
// Where UI source typically lives. The detector walks these and skips
// node_modules / dist / build and all hidden dirs automatically.
const SOURCE_DIRS = ['src', 'app', 'components', 'pages', 'public'];

// A changed file under a hidden or dependency/build directory is not app
// source — it's a vendored AI-harness install (.claude/skills/..., .cursor/,
// .impeccable/, issue #303), a build artifact, or a dependency. Mirrors the
// engine walkDir's skip rule so git-changes targeting can't resurface paths
// the walker would never visit.
function isVendoredPath(rel) {
  const dirSegments = rel.split(/[\\/]/).slice(0, -1);
  return dirSegments.some(
    (seg) =>
      (seg.startsWith('.') && seg !== '.vitepress' && seg !== '.vuepress' && seg !== '.storybook') ||
      seg === 'node_modules' || seg === 'dist' || seg === 'build' || seg === '__pycache__',
  );
}

/**
 * Local paths the agent should point the bundled detector at — never a URL.
 * A URL means a costly Puppeteer browser render, and a probed dev-server port
 * may not even belong to this project. An HTML *file* or a source tree is
 * scanned by the cheap, jsdom-free static engine. This script does NOT run the
 * detector; it just surfaces the target(s) so the agent can run
 * `node <scripts>/detect.mjs --json <targets>` and fold the hits in.
 */
function scanTargets(cwd, git) {
  // 1. Dirty tree wins: scan exactly the markup/style files in flight. It's
  //    what the user is working on, it's a small set, and it's local.
  if (git.isRepo && git.changedFiles.length) {
    const changed = git.changedFiles
      .filter((f) => SCANNABLE_EXT.has(path.extname(f).toLowerCase()))
      .filter((f) => !isVendoredPath(f))
      .filter((f) => fs.existsSync(path.join(cwd, f)));
    if (changed.length) return { targets: changed.slice(0, 50), via: 'git-changes' };
  }
  // 2. Otherwise scan the local source dirs that exist.
  const dirs = SOURCE_DIRS.filter((d) => fs.existsSync(path.join(cwd, d)));
  if (dirs.length) return { targets: dirs, via: 'source-dir' };
  // 3. A root HTML entry, or the project root as a last resort when there's
  //    code but no conventional source dir (walkDir still skips heavy dirs).
  if (fs.existsSync(path.join(cwd, 'index.html'))) return { targets: ['index.html'], via: 'html' };
  if (hasCode(cwd)) return { targets: ['.'], via: 'root' };
  return { targets: [], via: null };
}

export async function gatherSignals(cwd = process.cwd()) {
  const ctx = loadContext(cwd);
  const git = gitSignals(cwd);
  return {
    setup: {
      hasProduct: ctx.hasProduct,
      productPath: ctx.productPath,
      hasDesign: ctx.hasDesign,
      designPath: ctx.designPath,
      hasCode: hasCode(cwd),
      platform: extractPlatform(ctx.product),
    },
    critique: { latest: latestCritique(cwd) },
    git,
    devServer: await devServerSignals(),
    scan: scanTargets(cwd, git),
  };
}

async function cli() {
  const signals = await gatherSignals(process.cwd());
  process.stdout.write(`${JSON.stringify(signals, null, 2)}\n`);
}

function invokedAsScript() {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return fs.realpathSync(arg) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedAsScript()) {
  cli();
}
