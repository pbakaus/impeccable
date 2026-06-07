import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dts = fs.readFileSync(path.join(__dirname, '..', 'cli', 'engine', 'index.d.ts'), 'utf8');

describe('public type declarations', () => {
  for (const name of ['Finding', 'ImpeccableConfig', 'detectText', 'detectHtml', 'detectUrl']) {
    it(`declares ${name}`, () => assert.ok(dts.includes(name), `${name} missing from index.d.ts`));
  }
});
