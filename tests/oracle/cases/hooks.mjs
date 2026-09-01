/**
 * `impeccable hook`, `hook-before-edit`, `hook-admin` corpus.
 * Workspace: hook-project (package.json, PRODUCT.md web, UI files with and
 * without findings). Multi-step cases share one staged workspace so the
 * session cache carries between steps.
 */

import fs from 'node:fs';

const WS = '<WS>';
const CACHE_FILES = ['.impeccable/**', '.claude/settings.local.json', '.codex/hooks.json', '.cursor/hooks.json', '.github/hooks/impeccable.json'];

const claudeEdit = (file, extra = {}) => ({
  session_id: 's1', cwd: WS, hook_event_name: 'PostToolUse', tool_name: 'Edit',
  tool_input: { file_path: `${WS}/${file}` }, ...extra,
});
const stop = (extra = {}) => ({ session_id: 's1', cwd: WS, hook_event_name: 'Stop', stop_hook_active: false, ...extra });

export default [
  // --- hook.mjs: per-edit ---
  { id: 'hook-edit-tsx-fresh', verb: 'hook', workspace: 'hook-project', stdin: claudeEdit('src/components/Card.tsx'), files: CACHE_FILES },
  { id: 'hook-edit-css-fresh', verb: 'hook', workspace: 'hook-project', stdin: claudeEdit('src/components/Card.module.css'), files: CACHE_FILES },
  { id: 'hook-edit-html-fresh', verb: 'hook', workspace: 'hook-project', stdin: claudeEdit('src/page.html'), files: CACHE_FILES },
  { id: 'hook-edit-clean-tsx', verb: 'hook', workspace: 'hook-project', stdin: claudeEdit('src/components/Clean.tsx'), files: CACHE_FILES },
  { id: 'hook-edit-non-ui-ts', verb: 'hook', workspace: 'hook-project', stdin: claudeEdit('src/util.ts'), files: CACHE_FILES },
  { id: 'hook-edit-missing-file', verb: 'hook', workspace: 'hook-project', stdin: claudeEdit('src/nope.tsx'), files: CACHE_FILES },
  { id: 'hook-edit-outside-project', verb: 'hook', workspace: 'hook-project', stdin: { ...claudeEdit('x'), tool_input: { file_path: '<REPO>/tests/fixtures/antipatterns/blinking-cursor.html' } }, files: CACHE_FILES },
  { id: 'hook-edit-sensitive', verb: 'hook', workspace: 'hook-project', stdin: claudeEdit('.env.local'), files: CACHE_FILES },
  { id: 'hook-edit-generated', verb: 'hook', workspace: 'hook-project', stdin: claudeEdit('dist/bundle.css'), files: CACHE_FILES },
  { id: 'hook-edit-write-tool', verb: 'hook', workspace: 'hook-project', stdin: claudeEdit('src/components/Card.tsx', { tool_name: 'Write' }), files: CACHE_FILES },
  { id: 'hook-edit-multiedit', verb: 'hook', workspace: 'hook-project', stdin: claudeEdit('src/components/Card.tsx', { tool_name: 'MultiEdit' }), files: CACHE_FILES },
  { id: 'hook-edit-no-file-path', verb: 'hook', workspace: 'hook-project', stdin: { session_id: 's1', cwd: WS, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: {} }, files: CACHE_FILES },
  { id: 'hook-stdin-empty', verb: 'hook', workspace: 'hook-project', stdin: '', files: CACHE_FILES },
  { id: 'hook-stdin-malformed', verb: 'hook', workspace: 'hook-project', stdin: '{not json', files: CACHE_FILES },
  { id: 'hook-stdin-array', verb: 'hook', workspace: 'hook-project', stdin: '[1,2]', files: CACHE_FILES },
  { id: 'hook-env-disabled', verb: 'hook', workspace: 'hook-project', stdin: claudeEdit('src/components/Card.tsx'), env: { IMPECCABLE_HOOK_DISABLED: '1' }, files: CACHE_FILES },
  { id: 'hook-env-reentrant', verb: 'hook', workspace: 'hook-project', stdin: claudeEdit('src/components/Card.tsx'), env: { IMPECCABLE_HOOK_DEPTH: '1' }, files: CACHE_FILES },
  { id: 'hook-env-quiet', verb: 'hook', workspace: 'hook-project', stdin: claudeEdit('src/components/Card.tsx'), env: { IMPECCABLE_HOOK_QUIET: '1' }, files: CACHE_FILES },
  { id: 'hook-harness-github-edit', verb: 'hook', workspace: 'hook-project', stdin: { sessionId: 'g1', cwd: WS, toolName: 'edit', toolArgs: JSON.stringify({ path: 'src/components/Card.module.css', old_str: 'a', new_str: 'b' }) }, files: CACHE_FILES },
  { id: 'hook-harness-github-apply-patch', verb: 'hook', workspace: 'hook-project', stdin: { sessionId: 'g1', cwd: WS, toolName: 'apply_patch', toolArgs: '*** Begin Patch\n*** Update File: src/components/Card.module.css\n@@\n-x\n+y\n*** End Patch' }, files: CACHE_FILES },
  { id: 'hook-harness-codex-apply-patch', verb: 'hook', workspace: 'hook-project', stdin: { session_id: 'c1', cwd: WS, hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: src/components/Card.module.css\n@@\n-x\n+y\n*** End Patch' } }, files: CACHE_FILES },
  { id: 'hook-harness-cursor-shaped', verb: 'hook', workspace: 'hook-project', stdin: { conversation_id: 'cv1', workspace_roots: [WS], tool_name: 'Write', tool_input: { path: 'src/components/Card.module.css' } }, files: CACHE_FILES },
  { id: 'hook-harness-forced-github', verb: 'hook', workspace: 'hook-project', stdin: claudeEdit('src/components/Card.module.css'), env: { IMPECCABLE_HOOK_HARNESS: 'github' }, files: CACHE_FILES },
  { id: 'hook-audit-log', verb: 'hook', workspace: 'hook-project', stdin: claudeEdit('src/components/Card.module.css'), env: { IMPECCABLE_HOOK_LOG: `${WS}/.impeccable/audit.ndjson` }, files: CACHE_FILES },
  {
    id: 'hook-native-platform-skip', verb: 'hook', workspace: 'hook-project',
    setup: (ws) => fs.writeFileSync(`${ws}/PRODUCT.md`, '# P\n\n## Platform\nios\n'),
    stdin: claudeEdit('src/components/Card.module.css'), files: CACHE_FILES,
  },
  {
    id: 'hook-config-disabled', verb: 'hook', workspace: 'hook-project',
    setup: (ws) => { fs.mkdirSync(`${ws}/.impeccable`, { recursive: true }); fs.writeFileSync(`${ws}/.impeccable/config.json`, JSON.stringify({ hook: { enabled: false } }, null, 2) + '\n'); },
    stdin: claudeEdit('src/components/Card.module.css'), files: CACHE_FILES,
  },
  {
    id: 'hook-config-ignore-rule', verb: 'hook', workspace: 'hook-project',
    setup: (ws) => { fs.mkdirSync(`${ws}/.impeccable`, { recursive: true }); fs.writeFileSync(`${ws}/.impeccable/config.json`, JSON.stringify({ detector: { ignoreRules: ['gradient-text'] } }, null, 2) + '\n'); },
    stdin: claudeEdit('src/components/Card.module.css'), files: CACHE_FILES,
  },
  {
    id: 'hook-config-ignore-file', verb: 'hook', workspace: 'hook-project',
    setup: (ws) => { fs.mkdirSync(`${ws}/.impeccable`, { recursive: true }); fs.writeFileSync(`${ws}/.impeccable/config.json`, JSON.stringify({ detector: { ignoreFiles: ['src/components/**'] } }, null, 2) + '\n'); },
    stdin: claudeEdit('src/components/Card.module.css'), files: CACHE_FILES,
  },
  {
    id: 'hook-config-per-edit-all', verb: 'hook', workspace: 'hook-project',
    setup: (ws) => { fs.mkdirSync(`${ws}/.impeccable`, { recursive: true }); fs.writeFileSync(`${ws}/.impeccable/config.json`, JSON.stringify({ hook: { perEditRules: 'all' } }, null, 2) + '\n'); },
    stdin: claudeEdit('src/components/Card.tsx'), files: CACHE_FILES,
  },
  {
    id: 'hook-config-max-findings-1', verb: 'hook', workspace: 'hook-project',
    setup: (ws) => { fs.mkdirSync(`${ws}/.impeccable`, { recursive: true }); fs.writeFileSync(`${ws}/.impeccable/config.json`, JSON.stringify({ hook: { perEditRules: 'all', limits: { maxFindings: 1, maxChars: 8000 } } }, null, 2) + '\n'); },
    stdin: claudeEdit('src/page.html'), files: CACHE_FILES,
  },
  // Session flows
  {
    id: 'hook-session-fresh-then-pending-then-stop', verb: 'hook', workspace: 'hook-project', files: CACHE_FILES,
    steps: [
      { stdin: claudeEdit('src/components/Card.module.css') },
      { stdin: claudeEdit('src/components/Card.module.css') },
      { stdin: claudeEdit('src/components/Clean.tsx') },
      { stdin: claudeEdit('src/components/Clean.tsx') },
      { stdin: stop() },
      { stdin: stop() },
    ],
  },
  {
    id: 'hook-session-stop-active', verb: 'hook', workspace: 'hook-project', files: CACHE_FILES,
    steps: [{ stdin: claudeEdit('src/components/Card.module.css') }, { stdin: stop({ stop_hook_active: true }) }],
  },
  { id: 'hook-stop-no-touched', verb: 'hook', workspace: 'hook-project', stdin: stop(), files: CACHE_FILES },
  {
    id: 'hook-session-suppression-after-6', verb: 'hook', workspace: 'hook-project', files: CACHE_FILES,
    steps: Array.from({ length: 9 }, () => ({ stdin: claudeEdit('src/components/Card.module.css') })),
  },
  {
    id: 'hook-session-two-sessions', verb: 'hook', workspace: 'hook-project', files: CACHE_FILES,
    steps: [
      { stdin: claudeEdit('src/components/Card.module.css') },
      { stdin: claudeEdit('src/components/Card.module.css', { session_id: 's2' }) },
      { stdin: stop({ session_id: 's2' }) },
    ],
  },
  // Grok Build camelCase envelope (#646): the per-edit pass scans and warms
  // the session cache without remembering findings (Grok drops PostToolUse
  // stdout), the end_turn Stop reports the full set, the observe-only
  // shutdown fire and a stopHookActive re-entry stay silent.
  {
    id: 'hook-session-grok-edit-then-stop', verb: 'hook', workspace: 'hook-project', files: CACHE_FILES,
    steps: [
      { stdin: { sessionId: 'g1', cwd: WS, hookEventName: 'post_tool_use', toolName: 'str_replace', toolInput: { file_path: `${WS}/src/components/Card.module.css` } } },
      { stdin: { sessionId: 'g1', cwd: WS, hookEventName: 'stop', reason: 'end_turn' } },
      { stdin: { sessionId: 'g1', cwd: WS, hookEventName: 'stop', reason: 'shutdown' } },
      { stdin: { sessionId: 'g1', cwd: WS, hookEventName: 'stop', reason: 'end_turn', stopHookActive: true } },
    ],
  },
  // Codex Stop contract (#603): turn_id identifies Codex, whose Stop channel
  // is a top-level decision/block instead of hookSpecificOutput.
  {
    id: 'hook-session-codex-stop-decision', verb: 'hook', workspace: 'hook-project', files: CACHE_FILES,
    steps: [
      { stdin: claudeEdit('src/components/Card.module.css', { session_id: 'cx1', turn_id: 't-1' }) },
      { stdin: stop({ session_id: 'cx1', turn_id: 't-1' }) },
    ],
  },

  // --- hook-before-edit.mjs (Cursor) ---
  { id: 'hbe-write-with-findings', verb: 'hook-before-edit', workspace: 'hook-project', stdin: { hook_event_name: 'preToolUse', conversation_id: 'cv1', workspace_roots: [WS], tool_name: 'Write', tool_input: { path: 'src/new.css', content: '.t { background: linear-gradient(90deg,#f00,#00f); -webkit-background-clip: text; color: transparent; }\n' } }, files: CACHE_FILES },
  { id: 'hbe-write-clean', verb: 'hook-before-edit', workspace: 'hook-project', stdin: { hook_event_name: 'preToolUse', conversation_id: 'cv1', workspace_roots: [WS], tool_name: 'Write', tool_input: { path: 'src/new.css', content: '.t { color: #111; }\n' } }, files: CACHE_FILES },
  { id: 'hbe-write-empty-content', verb: 'hook-before-edit', workspace: 'hook-project', stdin: { hook_event_name: 'preToolUse', conversation_id: 'cv1', workspace_roots: [WS], tool_name: 'Write', tool_input: { path: 'src/new.css', content: '' } }, files: CACHE_FILES },
  { id: 'hbe-write-non-ui', verb: 'hook-before-edit', workspace: 'hook-project', stdin: { hook_event_name: 'preToolUse', conversation_id: 'cv1', workspace_roots: [WS], tool_name: 'Write', tool_input: { path: 'src/data.json', content: '{}' } }, files: CACHE_FILES },
  { id: 'hbe-edit-projection', verb: 'hook-before-edit', workspace: 'hook-project', stdin: { hook_event_name: 'preToolUse', conversation_id: 'cv1', workspace_roots: [WS], tool_name: 'StrReplace', tool_input: { path: 'src/components/Card.module.css', old_string: '.card {', new_string: '.card-v2 {' } }, files: CACHE_FILES },
  { id: 'hbe-edit-fragment-only', verb: 'hook-before-edit', workspace: 'hook-project', stdin: { hook_event_name: 'preToolUse', conversation_id: 'cv1', workspace_roots: [WS], tool_name: 'Edit', tool_input: { path: 'src/components/Clean.tsx', new_string: 'x' } }, files: CACHE_FILES },
  { id: 'hbe-edit-old-missing', verb: 'hook-before-edit', workspace: 'hook-project', stdin: { hook_event_name: 'preToolUse', conversation_id: 'cv1', workspace_roots: [WS], tool_name: 'Edit', tool_input: { path: 'src/components/Clean.tsx', old_string: 'NOPE', new_string: 'x' } }, files: CACHE_FILES },
  { id: 'hbe-shell-heredoc', verb: 'hook-before-edit', workspace: 'hook-project', stdin: { hook_event_name: 'preToolUse', conversation_id: 'cv1', workspace_roots: [WS], tool_name: 'Shell', tool_input: { command: 'cat > src/x.css <<\'EOF\'\n.t { background: linear-gradient(90deg,#f00,#00f); -webkit-background-clip: text; color: transparent; }\nEOF\n' } }, files: CACHE_FILES },
  { id: 'hbe-shell-redirect-no-content', verb: 'hook-before-edit', workspace: 'hook-project', stdin: { hook_event_name: 'preToolUse', conversation_id: 'cv1', workspace_roots: [WS], tool_name: 'Shell', tool_input: { command: 'echo hi > src/x.css' } }, files: CACHE_FILES },
  { id: 'hbe-shell-cp', verb: 'hook-before-edit', workspace: 'hook-project', stdin: { hook_event_name: 'preToolUse', conversation_id: 'cv1', workspace_roots: [WS], tool_name: 'Shell', tool_input: { command: 'cp src/components/Card.module.css src/copy.css' } }, files: CACHE_FILES },
  { id: 'hbe-html-engine', verb: 'hook-before-edit', workspace: 'hook-project', stdin: { hook_event_name: 'preToolUse', conversation_id: 'cv1', workspace_roots: [WS], tool_name: 'Write', tool_input: { path: 'src/new.html', content: '<!doctype html><html><head><style>.k{color:#777;background:#666}</style></head><body><p class="k">low contrast</p></body></html>' } }, files: CACHE_FILES },
  { id: 'hbe-no-file', verb: 'hook-before-edit', workspace: 'hook-project', stdin: { hook_event_name: 'preToolUse', conversation_id: 'cv1', workspace_roots: [WS], tool_name: 'Shell', tool_input: { command: 'ls' } }, files: CACHE_FILES },
  { id: 'hbe-stdin-empty', verb: 'hook-before-edit', workspace: 'hook-project', stdin: '', files: CACHE_FILES },
  { id: 'hbe-stdin-malformed', verb: 'hook-before-edit', workspace: 'hook-project', stdin: '{', files: CACHE_FILES },
  { id: 'hbe-env-disabled', verb: 'hook-before-edit', workspace: 'hook-project', stdin: '{', env: { IMPECCABLE_HOOK_DISABLED: 'true' }, files: CACHE_FILES },
  { id: 'hbe-outside-project', verb: 'hook-before-edit', workspace: 'hook-project', stdin: { hook_event_name: 'preToolUse', conversation_id: 'cv1', workspace_roots: [WS], tool_name: 'Write', tool_input: { path: '<REPO>/tests/x.css', content: '.a{}' } }, files: CACHE_FILES },
  {
    id: 'hbe-denial-downgrade-after-6', verb: 'hook-before-edit', workspace: 'hook-project', files: CACHE_FILES,
    steps: Array.from({ length: 8 }, () => ({ stdin: { hook_event_name: 'preToolUse', conversation_id: 'cv1', workspace_roots: [WS], tool_name: 'Write', tool_input: { path: 'src/new.css', content: '.t { background: linear-gradient(90deg,#f00,#00f); -webkit-background-clip: text; color: transparent; }\n' } } })),
  },
  {
    id: 'hbe-native-platform', verb: 'hook-before-edit', workspace: 'hook-project',
    setup: (ws) => fs.writeFileSync(`${ws}/PRODUCT.md`, '# P\n\n## Platform\nandroid\n'),
    stdin: { hook_event_name: 'preToolUse', conversation_id: 'cv1', workspace_roots: [WS], tool_name: 'Write', tool_input: { path: 'src/new.css', content: '.t { background: linear-gradient(90deg,#f00,#00f); -webkit-background-clip: text; color: transparent; }\n' } }, files: CACHE_FILES,
  },

  // --- hook-admin.mjs ---
  { id: 'hadmin-status-default', verb: 'hook-admin', workspace: 'hook-project', args: ['status'], files: CACHE_FILES },
  { id: 'hadmin-status-noargs', verb: 'hook-admin', workspace: 'hook-project', args: [], files: CACHE_FILES },
  { id: 'hadmin-unknown-action', verb: 'hook-admin', workspace: 'hook-project', args: ['bogus'], files: CACHE_FILES },
  { id: 'hadmin-off', verb: 'hook-admin', workspace: 'hook-project', args: ['off'], files: CACHE_FILES },
  { id: 'hadmin-on', verb: 'hook-admin', workspace: 'hook-project', args: ['on'], files: CACHE_FILES },
  { id: 'hadmin-on-twice', verb: 'hook-admin', workspace: 'hook-project', files: CACHE_FILES, steps: [{ args: ['on'] }, { args: ['on'] }, { args: ['status'] }] },
  { id: 'hadmin-off-then-status', verb: 'hook-admin', workspace: 'hook-project', files: CACHE_FILES, steps: [{ args: ['off'] }, { args: ['status'] }, { args: ['on'] }, { args: ['status'] }] },
  { id: 'hadmin-ignore-rule', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-rule', 'Side-Tab', '--reason', 'because', 'reasons'], files: CACHE_FILES },
  { id: 'hadmin-ignore-rule-missing', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-rule'], files: CACHE_FILES },
  { id: 'hadmin-ignore-rule-overused-font', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-rule', 'overused-font'], files: CACHE_FILES },
  { id: 'hadmin-ignore-rule-overused-font-all', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-rule', 'overused-font', '--all-values'], files: CACHE_FILES },
  { id: 'hadmin-ignore-rule-unknown-flag', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-rule', 'side-tab', '--nope'], files: CACHE_FILES },
  { id: 'hadmin-ignore-file', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-file', 'src/legacy/**'], files: CACHE_FILES },
  { id: 'hadmin-ignore-file-local', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-file', 'src/legacy/**', '--local'], files: CACHE_FILES },
  { id: 'hadmin-ignore-file-both-scopes', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-file', 'a/**', '--local', '--shared'], files: CACHE_FILES },
  { id: 'hadmin-ignore-file-reason', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-file', 'a/**', '--reason', 'x'], files: CACHE_FILES },
  { id: 'hadmin-ignore-file-two-globs', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-file', 'a/**', 'b/**'], files: CACHE_FILES },
  { id: 'hadmin-ignore-file-none', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-file'], files: CACHE_FILES },
  { id: 'hadmin-ignore-value', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-value', 'overused-font', 'Inter'], files: CACHE_FILES },
  { id: 'hadmin-ignore-value-multiword', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-value', 'overused-font', 'Space', 'Grotesk', '--reason', 'user confirmed:', 'brand'], files: CACHE_FILES },
  { id: 'hadmin-ignore-value-scoped', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-value', 'design-system-font-size', '*', '--file', 'src/z.js', '--files=src/a.js', '--file', 'src/a.js'], files: CACHE_FILES },
  { id: 'hadmin-ignore-value-wildcard-unscoped', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-value', 'design-system-font-size', '*'], files: CACHE_FILES },
  { id: 'hadmin-ignore-value-wildcard-unscoped-font', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-value', 'overused-font', '*'], files: CACHE_FILES },
  { id: 'hadmin-ignore-value-file-missing-glob', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-value', 'overused-font', 'Inter', '--file'], files: CACHE_FILES },
  { id: 'hadmin-ignore-value-file-empty', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-value', 'overused-font', 'Inter', '--file='], files: CACHE_FILES },
  { id: 'hadmin-ignore-value-file-flag-as-glob', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-value', 'overused-font', 'Inter', '--file', '--local'], files: CACHE_FILES },
  { id: 'hadmin-ignore-value-local', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-value', 'overused-font', 'Inter', '--local'], files: CACHE_FILES },
  { id: 'hadmin-ignore-value-missing', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-value', 'overused-font'], files: CACHE_FILES },
  { id: 'hadmin-ignore-value-unknown-flag', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-value', 'overused-font', 'Inter', '--wat'], files: CACHE_FILES },
  { id: 'hadmin-ignore-value-twice-updates-reason', verb: 'hook-admin', workspace: 'hook-project', files: CACHE_FILES, steps: [{ args: ['ignore-value', 'overused-font', 'Inter'] }, { args: ['ignore-value', 'overused-font', 'inter', '--reason=second'] }, { args: ['status'] }] },
  // upstream be87f5eb (#662): exact values for rules that cannot extract one are inert and refused
  { id: 'hadmin-ignore-value-inert-exact', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-value', 'cramped-padding', 'padding: 4px 8px'], files: CACHE_FILES },
  { id: 'hadmin-ignore-value-inert-scoped', verb: 'hook-admin', workspace: 'hook-project', args: ['ignore-value', 'side-tab', 'Inter', '--file', 'a.css'], files: CACHE_FILES },
  { id: 'hadmin-ignore-value-inert-then-wildcard', verb: 'hook-admin', workspace: 'hook-project', files: CACHE_FILES, steps: [{ args: ['ignore-value', 'cramped-padding', 'padding: 4px 8px'] }, { args: ['ignore-value', 'cramped-padding', '*', '--file', 'index.html'] }, { args: ['status'] }] },
  { id: 'hadmin-reset-empty', verb: 'hook-admin', workspace: 'hook-project', args: ['reset'], files: CACHE_FILES },
  { id: 'hadmin-full-cycle', verb: 'hook-admin', workspace: 'hook-project', files: CACHE_FILES, steps: [{ args: ['ignore-rule', 'side-tab'] }, { args: ['ignore-file', 'x/**', '--local'] }, { args: ['ignore-value', 'overused-font', 'Inter'] }, { args: ['status'] }, { args: ['reset'] }, { args: ['status'] }] },
  {
    id: 'hadmin-legacy-migration', verb: 'hook-admin', workspace: 'hook-project', files: CACHE_FILES,
    setup: (ws) => { fs.mkdirSync(`${ws}/.impeccable`, { recursive: true }); fs.writeFileSync(`${ws}/.impeccable/config.json`, JSON.stringify({ hook: { enabled: true, quiet: true, ignoreRules: ['legacy-rule'], advisoryRules: 'include', consent: 'accepted' }, other: { keep: 1 } }, null, 2) + '\n'); },
    steps: [{ args: ['status'] }, { args: ['ignore-rule', 'side-tab'] }, { args: ['status'] }],
  },
  {
    id: 'hadmin-malformed-config', verb: 'hook-admin', workspace: 'hook-project', files: CACHE_FILES,
    setup: (ws) => { fs.mkdirSync(`${ws}/.impeccable`, { recursive: true }); fs.writeFileSync(`${ws}/.impeccable/config.json`, '{ nope'); },
    steps: [{ args: ['status'] }, { args: ['off'] }],
  },
  {
    id: 'hadmin-on-repairs-existing-manifest', verb: 'hook-admin', workspace: 'hook-project', files: CACHE_FILES,
    setup: (ws) => { fs.mkdirSync(`${ws}/.claude`, { recursive: true }); fs.writeFileSync(`${ws}/.claude/settings.local.json`, JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'node old/skills/impeccable/scripts/hook.mjs' }] }, { matcher: 'Write', hooks: [{ type: 'command', command: 'echo other' }] }] } }, null, 2) + '\n'); },
    args: ['on'],
  },
  {
    id: 'hadmin-on-malformed-manifest-backup', verb: 'hook-admin', workspace: 'hook-project', files: [...CACHE_FILES, '.cursor/hooks.json.bak'],
    setup: (ws) => { fs.mkdirSync(`${ws}/.cursor`, { recursive: true }); fs.writeFileSync(`${ws}/.cursor/hooks.json`, '{ broken'); },
    args: ['on'],
  },
];
