// The app's Vue compiler owns SFC parsing and validation. Offsets crossing
// back into Rust are UTF-8 byte offsets, not JavaScript's UTF-16 indices.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  // With node -e, the first argument after -- is argv[1], not argv[2].
  const appRoot = resolve(process.argv[1]);
  const require = createRequire(resolve(appRoot, 'package.json'));
  const compiler = require('@vue/compiler-sfc');
  const request = JSON.parse(readFileSync(0, 'utf8'));
  const source = request.source;
  const filename = resolve(appRoot, request.filename || 'Component.vue');
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
    const root = compiled.rawResult?.root;
    if (!root) throw new Error('Vue preview could not validate the CSS structure.');
    const rejectNesting = node => {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (parent.type === 'rule') throw new Error('Vue component preview does not support nested CSS rules.');
      }
    };
    root.walkRules(rejectNesting);
    root.walkAtRules(rejectNesting);
    return { ...block(style), scoped: !!style.scoped, compiled: compiled.code };
  });
  const behaviors = [];
  const eventBindings = new Set();
  const renderBindings = new Set();
  const modelBindings = new Set();
  const references = (expression, names, inertEvent = false) => {
    if (!expression) return;
    const options = { sourceType: 'module', plugins: ['typescript'], allowAwaitOutsideFunction: true };
    let ast;
    try { ast = compiler.babelParse(`(${expression})`, options); }
    catch { ast = compiler.babelParse(expression, options); }
    if (inertEvent && !request.behaviorOnly) {
      const check = node => {
        if (!node || typeof node.type !== 'string') return;
        const unsafe = ['AssignmentExpression', 'UpdateExpression', 'MemberExpression',
          'OptionalMemberExpression', 'NewExpression', 'TaggedTemplateExpression'].includes(node.type)
          || (node.type === 'UnaryExpression' && node.operator === 'delete')
          || (['CallExpression', 'OptionalCallExpression'].includes(node.type)
            && (node.callee.type !== 'Identifier' || !Object.hasOwn(bindings, node.callee.name)));
        if (unsafe) throw new Error('Complex Vue event bindings require the ordinary preview.');
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) value.forEach(check);
          else if (value && typeof value === 'object') check(value);
        }
      };
      check(ast);
    }
    compiler.walkIdentifiers(ast, id => { if (Object.hasOwn(bindings, id.name)) names.add(id.name); });
  };
  // Ownership matters: an unchanged expression on a different element or in a
  // different loop/slot scope is not the same component behavior.
  const walk = (node, location = '') => {
    const record = value => behaviors.push(JSON.stringify({ location, value }));
    if (node.type === 5) {
      record('text:' + node.content.content.trim());
      references(node.content.content, renderBindings);
    }
    if (node.type === 1) {
      if (node.tagType === 1 || node.tagType === 2) record('component:' + node.tag);
      for (const prop of node.props || []) if (prop.type === 6 && !['class', 'style'].includes(prop.name)) {
        record({ attribute: prop.name, value: prop.value?.content });
      }
      for (const prop of node.props || []) if (prop.type === 7) {
        record({ name: prop.name, arg: prop.arg?.content, exp: prop.exp?.content?.trim(), modifiers: (prop.modifiers || []).map(m => typeof m === 'string' ? m : m.content) });
        if (prop.name === 'model') {
          const ast = compiler.babelParse(`(${prop.exp?.content || ''})`, { sourceType: 'module', plugins: ['typescript'] });
          const target = ast.program.body[0]?.expression;
          // Member writes could mutate objects owned by the original component.
          // Use the ordinary source preview for those rather than sharing them.
          if (target?.type !== 'Identifier') throw new Error('Vue component preview requires a simple v-model binding.');
          modelBindings.add(target.name);
        }
        if (prop.name !== 'slot') {
          const expression = prop.name === 'for'
            ? prop.exp?.content?.match(/\s(?:in|of)\s+([\s\S]*)$/)?.[1]
            : prop.exp?.content;
          references(expression, prop.name === 'on' ? eventBindings : renderBindings, prop.name === 'on');
        }
      }
    }
    let elementIndex = 0;
    let expressionIndex = 0;
    for (const child of node.children || []) {
      if (child.type === 1) walk(child, `${location}/${elementIndex++}:${child.tag}`);
      else if (child.type === 5) walk(child, `${location}/text:${expressionIndex++}`);
    }
  };
  walk(descriptor.template.ast);
  console.log(JSON.stringify({ ok: true, template: block(descriptor.template), styles, bindings: Object.keys(bindings).filter(k => !k.startsWith('__')), behaviors, eventBindings: [...eventBindings], renderBindings: [...renderBindings], modelBindings: [...modelBindings],
    scripts: [descriptor.script, descriptor.scriptSetup].filter(Boolean).map(block) }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message || String(error) }));
  process.exitCode = 1;
}
