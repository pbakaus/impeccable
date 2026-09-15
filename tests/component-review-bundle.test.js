import { test, expect } from 'bun:test';
import { resolve } from 'node:path';
const root=resolve(import.meta.dir,'..');
test('native component review bundle matches the shared UI source',async()=>{
 const result=await Bun.build({entrypoints:[resolve(root,'ui/component-review/entry.ts')],target:'browser',format:'iife',minify:true});
 expect(result.success).toBe(true);
 expect(await result.outputs[0].text()).toBe(await Bun.file(resolve(root,'crates/context/assets/component-review.js')).text());
});
