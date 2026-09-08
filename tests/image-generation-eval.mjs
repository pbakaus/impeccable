#!/usr/bin/env node
// Opt-in, billed comparison. Run with node --env-file=.env tests/image-generation-eval.mjs --run.
// Payloads match generate-image, including its explicit transparent PNG options.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const models = ['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'];
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const suite = option('--suite', 'comps');
if (!['comps', 'transparency'].includes(suite)) throw new Error('--suite must be comps or transparency');
const fixtureRoot = new URL('./fixtures/image-generation/', import.meta.url);
const cases = JSON.parse(await fs.readFile(new URL(`${suite}.json`, fixtureRoot), 'utf8'));
const out = path.resolve(option('--out', path.join(root, suite === 'comps' ? 'tmp/image-generation-2.5' : 'tmp/image-transparency-2.5')));
const repeats = Number(option('--repeats', '2'));
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('--repeats must be 1–10');
const quality = option('--quality', 'high');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (!args.includes('--run')) {
  console.log(`Plan: ${cases.length * models.length * repeats} billed Images API calls; ${quality} quality; output ${out}. Pass --run to execute. Existing matching successful results are reused.`);
  process.exit(0);
}
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
await fs.mkdir(out, { recursive: true });
const results = [];

async function generate(test, model, repeat) {
  const id = `${test.id}-${model}-${repeat}`;
  const filename = `${id}.png`;
  const recordPath = path.join(out, `${id}.json`);
  const referenceName = test.referenceFixture || test.reference;
  const reference = test.referenceFixture ? await fs.readFile(new URL(test.referenceFixture, fixtureRoot)) : test.reference ? await fs.readFile(path.join(out, test.reference)) : null;
  const request = { model, prompt: test.prompt, size: test.size, quality, n: 1 };
  if (test.background) Object.assign(request, { background: test.background, output_format: 'png' });
  const fingerprint = hash(JSON.stringify({ request, reference: reference && hash(reference) }));
  try {
    const previous = JSON.parse(await fs.readFile(recordPath, 'utf8'));
    const image = await fs.readFile(path.join(out, filename));
    if (previous.fingerprint === fingerprint && previous.imageSha256 === hash(image)) {
      results.push(previous);
      console.log(`Reused ${id}`);
      return;
    }
  } catch {}
  const started = performance.now();
  const record = { id, case: test.id, path: test.path, model, repeat, quality, size: test.size, prompt: test.prompt, reference: referenceName || null, fingerprint, createdAt: new Date().toISOString() };
  if (test.background) Object.assign(record, { background: test.background, outputFormat: 'png' });
  try {
    let body;
    const headers = { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` };
    if (reference) {
      body = new FormData();
      for (const [key, value] of Object.entries(request)) body.set(key, String(value));
      body.append('image[]', new Blob([reference], { type: 'image/png' }), referenceName);
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(request);
    }
    const response = await fetch(`https://api.openai.com/v1/images/${reference ? 'edits' : 'generations'}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(600_000) });
    record.requestId = response.headers.get('x-request-id');
    const json = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(json.error).slice(0, 500)}`);
    if (!json.data?.[0]?.b64_json) throw new Error('No image returned');
    const bytes = Buffer.from(json.data[0].b64_json, 'base64');
    await fs.writeFile(path.join(out, filename), bytes);
    Object.assign(record, { filename, imageSha256: hash(bytes), usage: json.usage, responseSize: json.size, responseQuality: json.quality, status: 'ok' });
    if (json.background) record.responseBackground = json.background;
  } catch (error) {
    record.status = 'error';
    record.error = error.message;
  }
  record.seconds = Math.round((performance.now() - started) / 10) / 100;
  await fs.writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  results.push(record);
  console.log(`${id}: ${record.status}, ${record.seconds}s${record.error ? `, ${record.error}` : ''}`);
}

// Static-reference transparency jobs are independent; keep at most three in flight.
if (suite === 'transparency') {
  const jobs = cases.flatMap(test => Array.from({ length: repeats }, (_, index) => models.map(model => [test, model, index + 1])).flat());
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let job; (job = jobs.shift());) await generate(...job);
  }));
} else for (const test of cases) {
  if (test.reference && !await fs.access(path.join(out, test.reference)).then(() => true, () => false)) {
    console.error(`Skipped ${test.id}: common reference is missing`);
    process.exitCode = 1;
    continue;
  }
  for (let repeat = 1; repeat <= repeats; repeat++) {
    await Promise.all(models.map(model => generate(test, model, repeat)));
  }
}
await fs.writeFile(path.join(out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const html = `<!doctype html><meta charset="utf-8"><title>Impeccable image model comparison</title><style>body{font:16px system-ui;margin:32px;color:#222;background:#f5f5f2}section{margin:40px 0}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}figure{margin:0}img{width:100%;height:auto}figcaption{padding:10px 0}details{max-width:1000px;white-space:pre-wrap}@media(max-width:800px){.grid{grid-template-columns:1fr}}</style><h1>Image 2 → Image 2.5</h1><p>Matched prompts, ${escape(quality)} quality, ${repeats} samples per model. Qualitative review, not a statistical benchmark. Click an image for full resolution.</p>${cases.map(test => `<section><h2>${escape(test.id)} · ${escape(test.path)}</h2><p>${test.checks.map(escape).join(' · ')}</p><details><summary>Exact prompt</summary>${escape(test.prompt)}</details>${Array.from({ length: repeats }, (_, index) => `<h3>Sample ${index + 1}</h3><div class="grid">${models.map(model => { const r = results.find(r => r.case === test.id && r.model === model && r.repeat === index + 1); return `<figure>${r?.filename ? `<a href="${r.filename}"><img src="${r.filename}" loading="lazy"></a>` : '<p>No image</p>'}<figcaption>${escape(model)} · ${r?.seconds ?? '—'}s${r?.error ? ` · ${escape(r.error)}` : ''}</figcaption></figure>`; }).join('')}</div>`).join('')}</section>`).join('')}`;
await fs.writeFile(path.join(out, 'index.html'), html);
console.log(`Review: ${path.join(out, 'index.html')}`);
if (results.some(r => r.status !== 'ok')) process.exitCode = 1;
