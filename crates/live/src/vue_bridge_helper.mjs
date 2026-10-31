// The app's Vue compiler owns SFC parsing and validation. Offsets crossing
// back into Rust are UTF-8 byte offsets, not JavaScript's UTF-16 indices.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  const require = createRequire(resolve(process.argv[1], 'package.json'));
  const compiler = require('@vue/compiler-sfc');
  const request = JSON.parse(readFileSync(0, 'utf8'));
  const source = request.source;
  const filename = request.filename || resolve(process.argv[1], 'Component.vue');
  const { descriptor, errors } = compiler.parse(source, { filename });
  const fail = (errors) => { if (errors.length) throw new Error(errors.map(e => e.message || String(e)).join('; ')); };
  fail(errors);
  if (!descriptor.template || descriptor.template.src || descriptor.template.lang) {
    throw new Error('Vue preview requires an inline HTML <template>.');
  }
  if (descriptor.customBlocks.length || [descriptor.script, descriptor.scriptSetup].some(b => b?.src)) {
    throw new Error('Vue preview does not support external scripts or custom SFC blocks.');
  }
  const block = (b) => ({
    content: b.content, attrs: b.attrs,
    start: Buffer.byteLength(source.slice(0, b.loc.start.offset)),
    end: Buffer.byteLength(source.slice(0, b.loc.end.offset)),
  });
  let bindings = {};
  if (descriptor.script || descriptor.scriptSetup) {
    const script = compiler.compileScript(descriptor, {
      id: 'impeccable-preview',
      fs: { fileExists: existsSync, readFile: path => readFileSync(path, 'utf8') },
    });
    bindings = script.bindings || {};
  }
  const template = compiler.compileTemplate({
    source: descriptor.template.content, filename, id: 'impeccable-preview',
    compilerOptions: { bindingMetadata: bindings },
  });
  fail(template.errors);
  const styles = descriptor.styles.map(style => {
    if (style.src || style.module || (style.lang && style.lang !== 'css')) {
      throw new Error(`Vue preview requires inline CSS styles; unsupported style lang=${style.lang || 'css'}, src or module.`);
    }
    const compiled = compiler.compileStyle({ source: style.content, filename, id: 'data-v-impeccable-preview', scoped: !!style.scoped });
    fail(compiled.errors);
    return { ...block(style), scoped: !!style.scoped, compiled: compiled.code };
  });
  const behaviors = [];
  const walk = (node) => {
    if (node.type === 5) behaviors.push('text:' + node.content.content.trim());
    if (node.type === 1) {
      if (node.tagType === 1) behaviors.push('component:' + node.tag);
      for (const prop of node.props || []) if (prop.type === 6 && ['ref', 'key'].includes(prop.name)) {
        behaviors.push(JSON.stringify({ attribute: prop.name, value: prop.value?.content }));
      }
      for (const prop of node.props || []) if (prop.type === 7) {
        behaviors.push(JSON.stringify({ name: prop.name, arg: prop.arg?.content, exp: prop.exp?.content?.trim(), modifiers: (prop.modifiers || []).map(m => typeof m === 'string' ? m : m.content) }));
      }
    }
    for (const child of node.children || []) walk(child);
  };
  walk(descriptor.template.ast);
  console.log(JSON.stringify({ ok: true, template: block(descriptor.template), styles, bindings: Object.keys(bindings).filter(k => !k.startsWith('__')), behaviors,
    scripts: [descriptor.script, descriptor.scriptSetup].filter(Boolean).map(block) }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message || String(error) }));
  process.exitCode = 1;
}
