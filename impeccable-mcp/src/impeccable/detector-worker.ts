import { parentPort, workerData } from 'node:worker_threads';

type WorkerData = {
  detectorUrl: string;
  text: string;
  filePath: string;
};

const data = workerData as WorkerData;

try {
  const detector = (await import(data.detectorUrl)) as {
    detectText?: (text: string, filePath: string) => Array<Record<string, unknown>>;
  };

  if (typeof detector.detectText !== 'function') {
    parentPort?.postMessage({ status: 'missing' });
  } else {
    const findings = detector.detectText(data.text, data.filePath);
    parentPort?.postMessage({ status: 'ok', findings });
  }
} catch (error) {
  parentPort?.postMessage({
    status: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
}
