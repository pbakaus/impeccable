/**
 * Synthetic-workspace scenario runner for skill-behavior tests.
 *
 * Each scenario:
 *   1. Creates a temp workspace.
 *   2. Builds a neutral .claude/skills/impeccable into the workspace so
 *      the launcher (`scripts/impeccable`) resolves from the canonical path
 *      the skill references, and points it at an engine binary.
 *   3. Optionally writes PRODUCT.md / DESIGN.md fixtures.
 *   4. Inlines SKILL.md as the system prompt (placeholders stripped to
 *      neutral values so the same body works for all providers).
 *   5. Runs Vercel AI SDK generateText with workspace-scoped tools
 *      (bash, read, write, list, ask_user_question).
 *   6. Captures every tool call and returns a trace + the raw response
 *      messages (so multi-turn scenarios can append to them).
 *
 * The harness deliberately mirrors the live-mode E2E pattern: real LLM,
 * no mocked model. File tools are workspace-scoped; bash is a real host shell,
 * not a security sandbox. Run only against disposable synthetic fixtures.
 */
import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getProviderOptions } from './providers.mjs';
import { ENGINE_MISSING_MESSAGE, findEngineBinary } from '../lib/engine-bin.mjs';
import { readSourceFiles, compileProviderBlocks, replacePlaceholders, stripRuleMarkers } from '../../scripts/lib/utils.js';
import { createTransformer } from '../../scripts/lib/transformers/factory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MAX_BASH_OUTPUT_BYTES = 200_000;

function renderNeutral(content) {
  return stripRuleMarkers(replacePlaceholders(compileProviderBlocks(content, [])
    .replaceAll('{{ask_instruction}}', 'Use the ask_user_question tool.')
    .replaceAll('{{model}}', 'the assistant'), 'dsh'))
    .replaceAll('{{scripts_path}}', '.claude/skills/impeccable/scripts')
    .replaceAll('{{command_hint}}', 'command');
}

// Use the production builder so fallback reviewer/documenter references exist.
// Generic tool names are shared by the API providers; host-specific blocks are
// deliberately absent. Exact provider transforms have separate loader tests.
const sourceSkills = readSourceFiles(REPO_ROOT).skills.map((skill) => ({
  ...skill,
  body: renderNeutral(skill.body),
  references: skill.references.map((ref) => ({ ...ref, content: renderNeutral(ref.content) })),
  agents: skill.agents.map((agent) => ({ ...agent, body: renderNeutral(agent.body) })),
}));
const stageSkill = createTransformer({
  provider: 'skill-behavior', placeholderProvider: 'dsh', providerTags: [],
  configDir: '.claude', displayName: 'Behavior fixture',
});

function snapshotWorkspaceFiles(root) {
  const snapshot = new Map();
  const walk = (dir, relDir = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = relDir ? path.join(relDir, entry.name) : entry.name;
      if (!relDir && (entry.name === '.claude' || entry.name === '.git' || entry.name === 'node_modules')) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(absolute, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const contents = fs.readFileSync(absolute);
      snapshot.set(rel, crypto.createHash('sha1').update(contents).digest('hex'));
    }
  };
  walk(root);
  return snapshot;
}

function changedPaths(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((file) => before.get(file) !== after.get(file))
    .sort();
}

/**
 * Strip the YAML frontmatter and replace `{{...}}` placeholders so SKILL.md
 * is provider-neutral when inlined.
 */
function loadSkillBody() {
  return sourceSkills[0].body.trim();
}

// This provider-neutral fixture assumes a loaded skill with a known base
// directory, not an exact copy of each host's transformed prompt. Claude's
// loader supplies a base-directory prefix; here it is workspace-relative
// because the file tools reject absolute paths. Provider rewrite/loader
// contracts are tested separately, not established by these behavior cases.
export const SKILL_BODY = `Base directory for this skill (workspace-relative): .claude/skills/impeccable\n\n${loadSkillBody()}`;

/**
 * Create a temp workspace and prepopulate it.
 *
 * - Compile current source into an independent fixture distribution. Shell
 *   and read tools see the same resolved references, including degraded roles.
 * - `files` lets the test seed PRODUCT.md / DESIGN.md (or anything else).
 * - `skillVersion` adds a `SKILL.md` version. `impeccable context` reads its
 *   own version from that sibling file, so this is required for any scenario
 *   that exercises the update-check path (the source dir has only SKILL.src.md).
 *
 * The launcher in the staged scripts dir needs an engine binary. Every bash
 * call the agent makes gets `IMPECCABLE_BIN` (tests/lib/engine-bin.mjs:
 * `IMPECCABLE_BIN` or `skill/scripts/bin/<os>-<arch>/`), which the launcher
 * honors first, so the staged skill works without a download.
 */
export const ENGINE_BIN = findEngineBinary();
export { ENGINE_MISSING_MESSAGE };

export function prepareWorkspace({ files = {}, skillVersion = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-skill-test-'));
  stageSkill(sourceSkills, dir, { skillsVersion: skillVersion || '' });
  fs.renameSync(path.join(dir, 'skill-behavior', '.claude'), path.join(dir, '.claude'));
  fs.rmdirSync(path.join(dir, 'skill-behavior'));
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  return dir;
}

export function cleanupWorkspace(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort — temp dirs eventually get reaped by the OS.
  }
}

function safeResolve(root, userPath) {
  if (typeof userPath !== 'string' || !userPath.length) {
    return { error: 'path is required' };
  }
  if (userPath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(userPath)) {
    return { error: 'absolute paths are not allowed' };
  }
  const resolved = path.resolve(root, userPath);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || rel.split(path.sep).includes('..')) {
    return { error: 'path escapes the workspace' };
  }
  return resolved;
}

function isContextOnlyCommand(workspace, command) {
  const match = command.trim().match(/^\.claude\/skills\/impeccable\/scripts\/impeccable context(?: --target (?:"([a-zA-Z0-9_./+ -]+)"|'([a-zA-Z0-9_./+ -]+)'|([a-zA-Z0-9_./+-]+)))?$/);
  if (!match) return false;
  const target = match[1] ?? match[2] ?? match[3];
  return target === undefined || (!target.startsWith('-') && typeof safeResolve(workspace, target) === 'string');
}

function execBash(workspace, command, timeoutMs = 20_000, extraEnv = {}) {
  return new Promise((resolve) => {
    // Model credentials belong to generateText, not to child image helpers.
    // Real decision pages have browser E2E; this suite has a structured user.
    const shellEnv = Object.fromEntries(Object.entries({ ...process.env, ...extraEnv })
      .filter(([name]) => !/(?:^|_)(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN)$/.test(name)));
    const proc = spawn('bash', ['-lc', command], {
      cwd: workspace,
      env: { ...shellEnv, ...(ENGINE_BIN ? { IMPECCABLE_BIN: ENGINE_BIN } : {}), IMPECCABLE_QUESTION_DISABLED: '1' },
    });
    let stdout = '';
    let stderr = '';
    const truncatedFlag = { val: false };
    const onChunk = (which) => (chunk) => {
      const str = chunk.toString();
      if (which === 'out') {
        if (stdout.length + str.length > MAX_BASH_OUTPUT_BYTES) {
          stdout += str.slice(0, MAX_BASH_OUTPUT_BYTES - stdout.length);
          truncatedFlag.val = true;
        } else {
          stdout += str;
        }
      } else {
        if (stderr.length + str.length > MAX_BASH_OUTPUT_BYTES) {
          stderr += str.slice(0, MAX_BASH_OUTPUT_BYTES - stderr.length);
          truncatedFlag.val = true;
        } else {
          stderr += str;
        }
      }
    };
    proc.stdout.on('data', onChunk('out'));
    proc.stderr.on('data', onChunk('err'));
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve({ exitCode: null, stdout, stderr: stderr + '\n[TIMED OUT]', truncated: truncatedFlag.val });
    }, timeoutMs);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, truncated: truncatedFlag.val });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: stderr + `\n[SPAWN ERROR] ${String(err)}`, truncated: truncatedFlag.val });
    });
  });
}

/**
 * Build the workspace-scoped tool set + the trace it writes into.
 * Returns `{ tools, trace }`. The trace mutates in place as the agent runs.
 */
function defaultSimulatedAnswer(question) {
  const text = String(question?.question ?? '').toLowerCase();
  const options = Array.isArray(question?.options) ? question.options : [];
  const firstOption = options.find((option) => typeof option?.label === 'string')?.label;

  // Option labels are model-authored and therefore the most faithful answer
  // when the agent is asking the user to choose a proposed world or concept.
  if (firstOption) return firstOption;
  if (/platform|web|ios|android|adaptive/.test(text)) return 'Web.';
  if (/who|audience|user|people/.test(text)) return 'Night-shift ferry dispatchers working from noisy control rooms.';
  if (/purpose|job|problem|outcome|success/.test(text)) return 'Help dispatchers resolve berth conflicts before they delay the overnight crossing.';
  if (/position|different|claim|only/.test(text)) return 'It turns fragmented radio calls into one trustworthy handoff record.';
  if (/world|tool|place|object|ritual|context/.test(text)) return 'Harbor logs, tide tables, grease-pencil berth boards, radio call signs, and sodium-lit terminals.';
  if (/direction|feel|personality|reference|look/.test(text)) return 'Decisive, maritime, and operational; avoid generic SaaS dashboards and nautical decoration.';
  if (/accessib|motion|contrast/.test(text)) return 'WCAG AA, keyboard access, reduced motion, and high contrast for dim control rooms.';
  if (/scope|fidelity|breadth|interactiv|polish/.test(text)) return 'One production-ready responsive surface with working interactions.';
  return 'Use the brief, preserve real operational content, and make the primary decision obvious.';
}

export function makeTools(workspace, extraEnv = {}, simulatedUser = {}, { contextOnlyBash = false, denyBash = false } = {}) {
  const referenceDir = path.join(workspace, '.claude/skills/impeccable/reference');
  const references = fs.readdirSync(referenceDir, { recursive: true })
    .filter((file) => file.endsWith('.md'))
    .map((file) => ({ file: file.split(path.sep).join('/'), content: fs.readFileSync(path.join(referenceDir, file), 'utf8').trim() }));
  const trace = {
    toolCalls: [],
    bashCommands: [],
    bashOutputs: [],
    readPaths: [],
    writePaths: [],
    listPaths: [],
    questionCalls: [],
    questionAnswers: [],
  };
  function record(name, input) {
    const call = { name, input, mutatedPaths: [] };
    trace.toolCalls.push(call);
    if (name === 'bash' && typeof input?.command === 'string') trace.bashCommands.push(input.command);
    if (name === 'read' && typeof input?.path === 'string') trace.readPaths.push(input.path);
    if (name === 'write' && typeof input?.path === 'string') trace.writePaths.push(input.path);
    if (name === 'list' && typeof input?.path === 'string') trace.listPaths.push(input.path);
    if (name === 'ask_user_question') trace.questionCalls.push(input);
    return call;
  }
  const tools = {
    bash: tool({
      description: contextOnlyBash
        ? 'Only `.claude/skills/impeccable/scripts/impeccable context` with an optional `--target <workspace-relative path>` is allowed here. Use read/list for files and references; write remains available for requested edits.'
        : 'Run a bash command in the workspace root. Use this to invoke skill commands (e.g. `.claude/skills/impeccable/scripts/impeccable context`).',
      inputSchema: z.object({
        command: z.string().describe('The bash command to execute.'),
      }),
      execute: async ({ command }) => {
        const call = record('bash', { command });
        // Simulate a host refusal, not a process failure. Nothing reaches a
        // shell, including retries, alternate launchers, and compound commands.
        if (denyBash) {
          call.denied = true;
          const out = 'Error: Bash permission denied by the host. This command was not executed.';
          trace.bashOutputs.push(out);
          return out;
        }
        // Routing tests need the real context loader, not a general-purpose
        // shell on the host. Reject before execution (still record attempts).
        if (contextOnlyBash && !isContextOnlyCommand(workspace, command)) {
          const out = 'Error: only `.claude/skills/impeccable/scripts/impeccable context` with an optional workspace-relative `--target` is allowed. Use read/list for files; references live at .claude/skills/impeccable/reference/.';
          trace.bashOutputs.push(out);
          return out;
        }
        const before = snapshotWorkspaceFiles(workspace);
        const res = await execBash(workspace, command, 20_000, extraEnv);
        call.mutatedPaths = changedPaths(before, snapshotWorkspaceFiles(workspace));
        call.loadedFiles = references.filter(({ content }) => content && res.stdout.includes(content))
          .map(({ file }) => `.claude/skills/impeccable/reference/${file}`);
        const head = `exit=${res.exitCode}`;
        const body = (res.stdout ? `stdout:\n${res.stdout}` : '') + (res.stderr ? `\nstderr:\n${res.stderr}` : '');
        const out = `${head}\n${body}${res.truncated ? '\n[output truncated]' : ''}`;
        trace.bashOutputs.push(out);
        return out;
      },
    }),
    read: tool({
      description: 'Read a file from the workspace. Path must be workspace-relative.',
      inputSchema: z.object({
        path: z.string().describe('Workspace-relative file path.'),
      }),
      execute: async ({ path: p }) => {
        const call = record('read', { path: p });
        call.succeeded = false;
        const resolved = safeResolve(workspace, p);
        if (typeof resolved !== 'string') return `Error: ${resolved.error}`;
        if (!fs.existsSync(resolved)) return `File not found: ${p}`;
        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) return `Path is a directory: ${p}. Use list instead.`;
        const contents = fs.readFileSync(resolved, 'utf8');
        call.succeeded = true;
        call.loadedFiles = [p];
        return contents;
      },
    }),
    write: tool({
      description: 'Write or overwrite a file in the workspace. Creates parent directories as needed.',
      inputSchema: z.object({
        path: z.string().describe('Workspace-relative file path.'),
        contents: z.string().describe('Full file contents.'),
      }),
      execute: async ({ path: p, contents }) => {
        const call = record('write', { path: p, contents });
        const resolved = safeResolve(workspace, p);
        if (typeof resolved !== 'string') return `Error: ${resolved.error}`;
        if (path.relative(workspace, resolved).split(path.sep)[0] === '.claude') {
          return 'Error: the staged skill is read-only; edits must target project files.';
        }
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, contents);
        call.mutatedPaths = [p];
        return `Wrote ${Buffer.byteLength(contents, 'utf8')} bytes to ${p}`;
      },
    }),
    list: tool({
      description: 'List a workspace directory. Defaults to the workspace root.',
      inputSchema: z.object({
        path: z.string().default('.').describe('Workspace-relative directory path.'),
      }),
      execute: async ({ path: p }) => {
        record('list', { path: p });
        const resolved = safeResolve(workspace, p);
        if (typeof resolved !== 'string') return `Error: ${resolved.error}`;
        if (!fs.existsSync(resolved)) return `Not found: ${p}`;
        const stat = fs.statSync(resolved);
        if (!stat.isDirectory()) return `Not a directory: ${p}`;
        const entries = fs.readdirSync(resolved).map((name) => {
          const st = fs.statSync(path.join(resolved, name));
          return st.isDirectory() ? `${name}/` : name;
        });
        return entries.length ? entries.join('\n') : '(empty)';
      },
    }),
    ask_user_question: tool({
      description:
        'Ask the user 1-4 structured questions and wait for answers. Use this for required Impeccable init, visual-world selection, and task-concept checkpoints instead of asking in prose.',
      inputSchema: z.object({
        questions: z.array(z.object({
          header: z.string().optional(),
          question: z.string(),
          options: z.array(z.object({
            label: z.string(),
            description: z.string().optional(),
          })).optional(),
          multiSelect: z.boolean().optional(),
        })).min(1).max(4),
      }),
      execute: async ({ questions }) => {
        record('ask_user_question', { questions });
        const answers = {};
        for (let index = 0; index < questions.length; index++) {
          const question = questions[index];
          const custom = typeof simulatedUser.answer === 'function'
            ? await simulatedUser.answer(question, index, { workspace, trace })
            : undefined;
          answers[question.question] = custom ?? defaultSimulatedAnswer(question);
        }
        trace.questionAnswers.push(answers);
        return JSON.stringify({ answers });
      },
    }),
  };
  return { tools, trace };
}

/**
 * Run one scenario turn against a model.
 *
 * `priorMessages` lets multi-turn scenarios chain context from a previous
 * call (append the SDK's response messages between turns).
 */
// A single turn (generateText) can drive up to ~30 tool-use steps against a
// frontier model; the thorough path was measured near 580s. generateText
// takes no timeout of its own, so a provider socket that stalls mid-stream
// keeps the fetch — and therefore the whole node process — alive indefinitely,
// past node's own `--test-timeout` (which cancels the test but not the open
// handle). We attach a real AbortSignal instead: on expiry the underlying
// fetch is aborted, the socket closes, the turn throws, and the scenario
// fails-and-continues so the sweep still produces a per-provider tally. The
// cap sits just under the 900s per-test timeout so a genuine slow-but-correct
// run is never killed. The timer is unref'd (it must not keep the loop alive
// after a healthy turn) and cleared on completion.
const TURN_TIMEOUT_MS = Number(process.env.IMPECCABLE_SKILL_BEHAVIOR_TURN_TIMEOUT_MS) || 840_000;
export async function runTurn({ workspace, model, userPrompt, priorMessages = [], maxSteps = 8, env = {}, simulatedUser = {}, timeoutMs = TURN_TIMEOUT_MS, contextOnlyBash = false, denyBash = false, stopAfter, additionalTools, environment = '' }) {
  const { tools, trace } = makeTools(workspace, env, simulatedUser, { contextOnlyBash, denyBash });
  if (additionalTools) Object.assign(tools, additionalTools(trace));
  const messages = [
    ...priorMessages,
    { role: 'user', content: userPrompt },
  ];
  const traceDir = process.env.IMPECCABLE_SKILL_BEHAVIOR_TRACE_DIR;
  const tracePath = traceDir && path.join(traceDir, `${path.basename(workspace)}-${crypto.randomUUID()}.json`);
  const saveTrace = (details) => {
    if (!tracePath) return;
    fs.mkdirSync(traceDir, { recursive: true });
    fs.writeFileSync(tracePath, JSON.stringify({ model: model.modelId, userPrompt, trace, ...details }, null, 2));
  };
  let result;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`LLM turn exceeded ${timeoutMs}ms; aborting the provider call`)),
    timeoutMs,
  );
  if (typeof timer.unref === 'function') timer.unref();
  try {
    result = await generateText({
      model,
      system: environment ? `${SKILL_BODY}\n\nRuntime environment: ${environment}` : SKILL_BODY,
      messages,
      tools,
      onStepFinish: tracePath ? (step) => saveTrace({ status: 'in-progress', lastStepMessages: step.response.messages }) : undefined,
      stopWhen: [stepCountIs(maxSteps), ...(stopAfter ? [() => stopAfter(trace)] : [])],
      // Real client-side deadline on the provider call: without it a stalled
      // stream wedges the whole sweep with no tally.
      abortSignal: controller.signal,
      // The Anthropic-compatible adapter does not recognize DeepSeek and
      // otherwise caps each response at 4096 tokens, truncating valid tool
      // continuations. Keep an explicit ceiling; length remains a test failure.
      maxOutputTokens: model?.modelId?.startsWith('deepseek-') ? 16_384 : undefined,
      // Resolved from the model object so the 21 runTurn call sites stay
      // unchanged. Reasoning models run at the provider default otherwise,
      // which is not the tier this suite is meant to measure.
      providerOptions: getProviderOptions(model?.modelId ?? ''),
    });
  } catch (err) {
    const reason = controller.signal.aborted ? ` (aborted after ${timeoutMs}ms client-side timeout)` : '';
    saveTrace({ status: 'failed', error: `${String(err)}${reason}` });
    throw new Error(`LLM behavior turn failed before completing${reason}: ${String(err)}`, { cause: err });
  } finally {
    clearTimeout(timer);
  }
  const generatedResponseMessages = result.responseMessages ?? result.response?.messages ?? [];
  const responseMessages = [...messages, ...generatedResponseMessages];
  const outcome = stopAfter?.(trace) ? 'checkpoint'
    : result.finishReason === 'length' ? 'output-limit'
    : result.finishReason === 'tool-calls' && result.steps.length >= maxSteps ? 'step-budget'
    : result.finishReason === 'stop' ? 'complete' : result.finishReason;
  saveTrace({ status: 'completed', responseMessages,
    outcome, finishReason: result.finishReason, steps: result.steps.length, usage: result.totalUsage ?? result.usage });
  return {
    trace,
    outcome,
    steps: result.steps.length,
    text: result.text ?? '',
    stepTexts: result.steps.map((step) => step.text ?? ''),
    finishReason: result.finishReason,
    usage: result.totalUsage ?? result.usage,
    responseMessages,
  };
}

/**
 * Heuristic helpers — keep the assertion intent declarative in the test file.
 */
export function bashCommandsMatching(trace, substring) {
  return trace.bashCommands.filter((cmd) => cmd.includes(substring));
}

export function readsMatching(trace, substring) {
  return trace.readPaths.filter((p) => p.toLowerCase().includes(substring.toLowerCase()));
}

/**
 * True if the agent loaded a file by Read OR by a bash `cat` (some models
 * stream multiple files via bash to save tool calls).
 */
export function callLoadedFile(call, filename) {
  return (call.loadedFiles || []).some((file) => file === filename || file.endsWith(`/${filename}`));
}

export function fileLoaded(trace, filename) {
  return trace.toolCalls.some((call) => callLoadedFile(call, filename));
}

export function summarizeTrace(trace) {
  return {
    totalCalls: trace.toolCalls.length,
    byName: trace.toolCalls.reduce((acc, c) => ((acc[c.name] = (acc[c.name] ?? 0) + 1), acc), {}),
    bashCommands: trace.bashCommands,
    readPaths: trace.readPaths,
    writePaths: trace.writePaths,
    fileMutations: trace.toolCalls
      .filter((call) => call.mutatedPaths?.length)
      .map((call) => ({ tool: call.name, paths: call.mutatedPaths })),
    questionCalls: trace.questionCalls,
    questionAnswers: trace.questionAnswers,
  };
}
