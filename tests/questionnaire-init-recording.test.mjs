import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INSTALLED_SKILL_DEST = path.join('.agents', 'skills', 'impeccable');
const INIT_OWNED_FILES = [
  'PRODUCT.md',
  'DESIGN.md',
  path.join('.impeccable', 'live', 'config.json'),
];

describe('recorded $impeccable init browser launch', () => {
  it('replicates the repo, clears init files, records typing into the browser questionnaire, and emits an MP4', async (t) => {
    const browser = await launchBrowserOrSkip(t);
    if (!browser) return;
    t.after(() => browser.close());

    const ffmpeg = findBinary('ffmpeg');
    const ffprobe = findBinary('ffprobe');
    if (!ffmpeg || !ffprobe) {
      t.skip('ffmpeg and ffprobe are required to convert and validate Playwright WebM video as MP4.');
      return;
    }

    const runId = `recorded-${Date.now().toString(36)}`;
    const artifactDir = path.join(ROOT, '.impeccable', 'init', 'recordings', runId);
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-init-recording-repo-'));
    const videoDir = path.join(artifactDir, 'raw-video');
    fs.mkdirSync(videoDir, { recursive: true });

    let server = null;
    let context = null;
    let page = null;

    try {
      copyReplicaRepo(ROOT, workspace);
      seedInitOwnedFilesFromHead(workspace);
      deleteInitOwnedFiles(workspace);
      for (const relPath of INIT_OWNED_FILES) {
        assert.equal(fs.existsSync(path.join(workspace, relPath)), false, `${relPath} should be absent in the replica`);
      }

      const contextResult = await runNode(workspace, [path.join(INSTALLED_SKILL_DEST, 'scripts', 'context.mjs')]);
      assert.match(contextResult.stdout, /NO_PRODUCT_MD/);
      assert.match(contextResult.stdout, /reference\/init\.md/);

      server = spawn(process.execPath, [
        path.join(INSTALLED_SKILL_DEST, 'scripts', 'questionnaire', 'init-questionnaire.mjs'),
        '--prompt',
        '$impeccable init visual recording test',
      ], {
        cwd: workspace,
        env: withoutImageKeys(process.env),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const startup = await readStartupJson(server);
      assert.equal(startup.ok, true);
      assert.equal(startup.targetPaths.product, 'PRODUCT.md');
      assert.match(startup.targetPaths.brand, /^(BRAND\.md|\.impeccable\/init\/BRAND\.next\.md)$/);
      assert.equal(startup.targetPaths.design, 'DESIGN.md');

      context = await browser.newContext({
        viewport: { width: 1280, height: 860 },
        reducedMotion: 'no-preference',
        recordVideo: {
          dir: videoDir,
          size: { width: 1280, height: 860 },
        },
      });
      page = await context.newPage();
      await page.goto(startup.url, { waitUntil: 'domcontentloaded' });
      await expectCurrentSlide(page, 'product-overview');

      const typedAnswer = 'Mira is a calm ceramic lamp site for people who want quiet sculptural light.';
      const textarea = page.locator('[data-slide="product-overview"][data-current="true"] textarea');
      await textarea.click();
      await page.keyboard.type(typedAnswer, { delay: 18 });
      await page.waitForTimeout(500);
      assert.equal(await textarea.inputValue(), typedAnswer);
      await capturePage(page, path.join(artifactDir, '01-first-slide-typed.png'));

      const responsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/answer')
          && response.request().method() === 'POST'
          && response.request().postDataJSON()?.slideId === 'product-overview'
      ), { timeout: 7000 });
      await page.locator('[data-slide="product-overview"][data-current="true"] [data-next]').click();
      const response = await responsePromise;
      assert.equal((await response.json()).ok, true);

      const answerEvent = await pollUntil(
        workspace,
        startup.sessionId,
        (event) => event.type === 'answer' && event.slideId === 'product-overview',
        'product-overview answer event',
      );
      assert.equal(answerEvent.answer.value, typedAnswer);
      await page.waitForTimeout(750);
      await capturePage(page, path.join(artifactDir, '02-after-continue.png'));

      const video = page.video();
      await context.close();
      context = null;
      const webmPath = await video.path();
      const mp4Path = path.join(artifactDir, 'impeccable-init-recorded-launch.mp4');
      convertWebmToMp4({ ffmpeg, webmPath, mp4Path });

      const mp4Stats = fs.statSync(mp4Path);
      assert.ok(mp4Stats.size > 25_000, `recorded MP4 should not be empty: ${mp4Path}`);
      const videoMetadata = probeMp4({ ffprobe, mp4Path });
      assert.equal(videoMetadata.streams[0]?.codec_name, 'h264');
      assert.equal(videoMetadata.streams[0]?.width, 1280);
      assert.equal(videoMetadata.streams[0]?.height, 860);
      assert.ok(Number(videoMetadata.format?.duration) >= 2, 'recorded MP4 should include the visible typing sequence');
      fs.writeFileSync(path.join(artifactDir, 'manifest.json'), `${JSON.stringify({
        runId,
        mp4Path,
        video: {
          codec: videoMetadata.streams[0]?.codec_name,
          width: videoMetadata.streams[0]?.width,
          height: videoMetadata.streams[0]?.height,
          duration: videoMetadata.format?.duration,
          size: videoMetadata.format?.size,
        },
        screenshots: [
          path.join(artifactDir, '01-first-slide-typed.png'),
          path.join(artifactDir, '02-after-continue.png'),
        ],
        startup: {
          sessionId: startup.sessionId,
          targetPaths: startup.targetPaths,
        },
      }, null, 2)}\n`);
    } finally {
      if (context) await context.close().catch(() => {});
      if (server) await stopProcess(server);
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});

function copyReplicaRepo(sourceRoot, destRoot) {
  fs.cpSync(sourceRoot, destRoot, {
    recursive: true,
    filter(source) {
      const rel = path.relative(sourceRoot, source);
      if (!rel) return true;
      const parts = rel.split(path.sep);
      if (parts.includes('.git') || parts.includes('node_modules') || parts.includes('dist') || parts.includes('build')) {
        return false;
      }
      if (parts[0] === '.impeccable') {
        const localRuntime = [
          ['.impeccable', '.env'],
          ['.impeccable', 'env'],
          ['.impeccable', 'init'],
          ['.impeccable', 'questionnaire'],
          ['.impeccable', 'identity-demo'],
          ['.impeccable', 'identity-image-e2e'],
          ['.impeccable', 'history'],
          ['.impeccable', 'critique'],
        ];
        if (localRuntime.some((prefix) => prefix.every((part, index) => parts[index] === part))) {
          return false;
        }
      }
      return true;
    },
  });
}

function seedInitOwnedFilesFromHead(workspace) {
  for (const relPath of INIT_OWNED_FILES) {
    const outPath = path.join(workspace, relPath);
    if (fs.existsSync(outPath)) continue;
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    try {
      const content = execFileSync('git', ['show', `HEAD:${relPath.split(path.sep).join('/')}`], {
        cwd: ROOT,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      fs.writeFileSync(outPath, content);
    } catch {
      fs.writeFileSync(outPath, `# Seeded ${relPath}\n`);
    }
  }
}

function deleteInitOwnedFiles(workspace) {
  for (const relPath of INIT_OWNED_FILES) {
    fs.rmSync(path.join(workspace, relPath), { force: true });
  }
}

async function launchBrowserOrSkip(t) {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch (err) {
    t.skip(`Playwright is required for recorded init tests (${err.message}).`);
    return null;
  }
  try {
    return await playwright.chromium.launch({ headless: true });
  } catch (err) {
    t.skip(`Chromium could not launch (${err.message}).`);
    return null;
  }
}

function findBinary(name) {
  for (const candidate of [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function convertWebmToMp4({ ffmpeg, webmPath, mp4Path }) {
  execFileSync(ffmpeg, [
    '-y',
    '-i',
    webmPath,
    '-movflags',
    '+faststart',
    '-pix_fmt',
    'yuv420p',
    mp4Path,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function probeMp4({ ffprobe, mp4Path }) {
  return JSON.parse(execFileSync(ffprobe, [
    '-v',
    'error',
    '-show_entries',
    'format=duration,size',
    '-show_entries',
    'stream=width,height,codec_name',
    '-of',
    'json',
    mp4Path,
  ], { encoding: 'utf-8' }));
}

async function expectCurrentSlide(page, expectedSlideId) {
  await page.waitForFunction((slideId) => {
    const thinking = document.querySelector('[data-thinking]');
    const ready = !thinking || thinking.hidden || !thinking.classList.contains('is-active');
    const current = document.querySelector('[data-current="true"]');
    return ready
      && current?.dataset.slide === slideId
      && Number(getComputedStyle(current).opacity) > 0.8;
  }, expectedSlideId, { timeout: 7000 });
}

async function capturePage(page, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const buffer = await page.screenshot({ path: outPath, fullPage: true });
  assert.ok(buffer.byteLength > 8000, `${outPath} should contain visible pixels`);
}

async function pollUntil(workspace, sessionId, predicate, label) {
  for (let i = 0; i < 8; i += 1) {
    const event = await poll(workspace, sessionId, 2500);
    if (predicate(event)) return event;
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function poll(workspace, sessionId, timeoutMs = 2500) {
  const result = await runNode(workspace, [
    path.join(INSTALLED_SKILL_DEST, 'scripts', 'questionnaire', 'init-poll.mjs'),
    '--session-id',
    sessionId,
    '--timeout-ms',
    String(timeoutMs),
  ], { timeoutMs: timeoutMs + 3000 });
  return parseJson(result.stdout, 'poll output');
}

function runNode(cwd, args, { timeoutMs = 20_000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`node ${args.join(' ')} timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, timeoutMs);
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`node ${args.join(' ')} exited ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });
}

function readStartupJson(proc) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`init-questionnaire startup timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`)), 10_000);
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      try {
        const json = parseJson(stdout, 'startup output');
        clearTimeout(timer);
        resolve(json);
      } catch {
        // Wait for the rest of the startup JSON.
      }
    });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`init-questionnaire exited before startup JSON (${code})\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });
}

async function stopProcess(proc) {
  if (proc.exitCode !== null || proc.signalCode) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve();
    }, 3000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    proc.kill('SIGTERM');
  });
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not parse ${label}: ${error.message}\n${text}`);
  }
}

function withoutImageKeys(env) {
  const next = { ...env };
  delete next.IMAGE_API_KEY;
  delete next.IMPECCABLE_IMAGE_API_KEY;
  delete next.BFL_API_KEY;
  delete next.FLUX_API_KEY;
  return next;
}
