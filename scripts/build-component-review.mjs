// Source bundle embedded in the native engine; no Node/Bun is needed at runtime.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const root = fileURLToPath(new URL('../', import.meta.url));
const pinnedBun = readFileSync(resolve(root, '.bun-version'), 'utf8').trim();
if (Bun.version !== pinnedBun) throw new Error(`Component review bundles require Bun ${pinnedBun}; received ${Bun.version}. Use the pinned toolchain before regenerating tracked output.`);
const result = await Bun.build({ entrypoints: [resolve(root, 'ui/component-review/entry.ts')], target: 'browser', format: 'iife', minify: true });
if (!result.success) throw new AggregateError(result.logs, 'Component review bundle failed');
await Bun.write(resolve(root, 'crates/context/assets/component-review.js'), await result.outputs[0].text());
