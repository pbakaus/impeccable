import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { ImpeccableSourceSnapshot } from './source.js';

export type DetectorFinding = {
  ruleId: string;
  severity: string;
  file: string;
  line?: number;
  message: string;
  fix?: string;
};

export type DetectMarkupResult =
  | {
      status: 'ok';
      source: { commit: string; detectorPath: string };
      findings: DetectorFinding[];
    }
  | {
      status: 'unsupported_input';
      reason: string;
      fallback: string;
    };

function extensionForLanguage(language?: string): string {
  const normalized = String(language ?? '').toLowerCase();
  if (['css', 'scss', 'sass'].includes(normalized)) return `.${normalized}`;
  if (['jsx', 'tsx', 'vue', 'svelte'].includes(normalized)) return `.${normalized}`;
  if (normalized === 'html' || normalized === 'markup') return '.html';
  return '.tsx';
}

function normalizeFinding(raw: Record<string, unknown>, file: string): DetectorFinding {
  const ruleId = String(raw.antipattern ?? raw.ruleId ?? raw.id ?? raw.type ?? 'unknown');
  return {
    ruleId,
    severity: String(raw.severity ?? raw.priority ?? 'P2'),
    file: String(raw.file ?? file),
    line: typeof raw.line === 'number' ? raw.line : undefined,
    message: String(raw.message ?? raw.reason ?? raw.snippet ?? ruleId),
    fix: raw.fix ? String(raw.fix) : raw.suggestion ? String(raw.suggestion) : undefined,
  };
}

function detectorTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.IMPECCABLE_DETECTOR_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5_000;
}

type DetectorWorkerResult =
  | { status: 'ok'; findings: Array<Record<string, unknown>> }
  | { status: 'missing' }
  | { status: 'timeout'; timeoutMs: number }
  | { status: 'error'; message: string };

function detectorWorkerUrl(): URL {
  const sibling = new URL('./detector-worker.js', import.meta.url);
  if (existsSync(fileURLToPath(sibling))) return sibling;
  return new URL('../../dist/impeccable/detector-worker.js', import.meta.url);
}

function detectorFallback(reason: string): DetectMarkupResult {
  return {
    status: 'unsupported_input',
    reason,
    fallback: 'Use impeccable_checkpoint with after_generation and provide a visual/text description.',
  };
}

async function runDetectorWithTimeout(
  detectorPath: string,
  text: string,
  filePath: string,
): Promise<DetectorWorkerResult> {
  const timeoutMs = detectorTimeoutMs();
  const worker = new Worker(detectorWorkerUrl(), {
    workerData: {
      detectorUrl: pathToFileURL(detectorPath).href,
      text,
      filePath,
    },
  });

  return new Promise<DetectorWorkerResult>((resolve) => {
    let settled = false;
    const finish = (result: DetectorWorkerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners();
      void worker.terminate();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ status: 'timeout', timeoutMs });
    }, timeoutMs);
    timer.unref();

    worker.once('message', (message: DetectorWorkerResult) => {
      finish(message);
    });
    worker.once('error', (error) => {
      finish({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    });
    worker.once('exit', (code) => {
      if (code !== 0) finish({ status: 'error', message: `Detector worker exited with code ${code}.` });
    });
  });
}

export async function detectMarkup(
  snapshot: ImpeccableSourceSnapshot,
  input: { text: string; language?: string; filename?: string },
): Promise<DetectMarkupResult> {
  if (!input.text || !input.text.trim()) {
    return detectorFallback('Detector requires markup/style/code text.');
  }

  const detectorPath = path.join(snapshot.repoRoot, 'cli/engine/detect-antipatterns.mjs');
  let tmpDir: string | undefined;
  try {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'impeccable-mcp-'));
    const fallbackFilename = `submitted${extensionForLanguage(input.language)}`;
    const rawFilename = input.filename ?? fallbackFilename;
    const submittedBasename = path.basename(rawFilename);
    const filename = submittedBasename && !['.', '..'].includes(submittedBasename) ? submittedBasename : fallbackFilename;
    const filePath = path.join(tmpDir, filename);
    await fs.writeFile(filePath, input.text, 'utf8');
    const detection = await runDetectorWithTimeout(detectorPath, input.text, filePath);
    if (detection.status === 'missing') {
      return detectorFallback('Detector module does not expose detectText.');
    }
    if (detection.status === 'timeout') {
      return detectorFallback(`Detector did not complete within ${detection.timeoutMs}ms.`);
    }
    if (detection.status === 'error') {
      return detectorFallback(`Detector failed: ${detection.message}`);
    }
    const findings = detection.findings.map((finding) => normalizeFinding(finding, filePath));
    return {
      status: 'ok',
      source: { commit: snapshot.commit, detectorPath },
      findings,
    };
  } catch (error) {
    return detectorFallback(`Detector failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
