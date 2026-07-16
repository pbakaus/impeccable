/**
 * Sandboxed scenario runner for skill-behavior tests.
 *
 * Each scenario:
 *   1. Creates a temp workspace.
 *   2. Symlinks the real .claude/skills/impeccable into the workspace so
 *      scripts (context.mjs, etc.) resolve from the canonical path
 *      the skill references.
 *   3. Optionally writes PRODUCT.md / DESIGN.md fixtures.
 *   4. Inlines SKILL.md as the system prompt (placeholders stripped to
 *      neutral values so the same body works for all providers).
 *   5. Runs Vercel AI SDK generateText with workspace-scoped tools
 *      (bash, read, write, list, ask_user_question).
 *   6. Captures every tool call and returns a trace + the raw response
 *      messages (so multi-turn scenarios can append to them).
 *
 * The harness deliberately mirrors the live-mode E2E pattern: real LLM,
 * no mocks, but tightly bounded execution surface so we observe the routing
 * behavior of the skill without paying for full-fledged design work.
 */
import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SKILL_SOURCE_DIR = path.join(REPO_ROOT, 'skill');
const MAX_BASH_OUTPUT_BYTES = 200_000;

/**
 * Strip the YAML frontmatter and replace `{{...}}` placeholders so SKILL.md
 * is provider-neutral when inlined.
 */
function loadSkillBody() {
  let md = fs.readFileSync(path.join(SKILL_SOURCE_DIR, 'SKILL.src.md'), 'utf8');
  // Strip frontmatter.
  if (md.startsWith('---')) {
    const end = md.indexOf('\n---', 3);
    if (end !== -1) md = md.slice(end + 4).trimStart();
  }
  // The source uses placeholders that the build step replaces per-provider.
  // For the test harness we want a single body that works for any provider,
  // and the scripts the skill references live at .claude/skills/impeccable/
  // (the workspace symlink), so hard-code those values.
  md = md
    .replaceAll('{{model}}', 'the assistant')
    .replaceAll('{{command_prefix}}', '/')
    .replaceAll('{{ask_instruction}}', 'Use the ask_user_question tool.')
    .replaceAll('{{config_file}}', 'AGENTS.md')
    .replaceAll('{{scripts_path}}', '.claude/skills/impeccable/scripts')
    .replaceAll('{{command_hint}}', 'command');
  return md.trim();
}

export const SKILL_BODY = loadSkillBody();

/**
 * Create a temp workspace and prepopulate it.
 *
 * - `.claude/skills/impeccable` is symlinked at the SOURCE skill dir (not
 *   the built `.claude/skills/impeccable/`) so the test exercises whatever
 *   is in `skill/` right now, without needing `bun run build` to refresh
 *   the harness output dirs. The trade-off: reference files surface their
 *   raw `{{placeholders}}`, but the assertions only check tool calls, not
 *   their content.
 * - `files` lets the test seed PRODUCT.md / DESIGN.md (or anything else).
 * - `skillVersion` switches from symlink to a real COPY of the skill dir and
 *   writes a `SKILL.md` carrying that version. context.mjs reads its own
 *   version from that sibling file, so this is required for any scenario that
 *   exercises the update-check path (the source dir has only SKILL.src.md).
 */
export function prepareWorkspace({ files = {}, skillVersion = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-skill-test-'));
  const skillDest = path.join(dir, '.claude', 'skills', 'impeccable');
  fs.mkdirSync(path.join(dir, '.claude', 'skills'), { recursive: true });
  if (skillVersion) {
    fs.cpSync(SKILL_SOURCE_DIR, skillDest, { recursive: true });
    fs.writeFileSync(path.join(skillDest, 'SKILL.md'), `---\nname: impeccable\nversion: ${skillVersion}\n---\n\nbody\n`);
  } else {
    fs.symlinkSync(SKILL_SOURCE_DIR, skillDest, 'dir');
  }
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

function execBash(workspace, command, timeoutMs = 20_000, extraEnv = {}) {
  return new Promise((resolve) => {
    const proc = spawn('bash', ['-lc', command], { cwd: workspace, env: { ...process.env, ...extraEnv } });
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

export function makeTools(workspace, extraEnv = {}, simulatedUser = {}) {
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
    trace.toolCalls.push({ name, input });
    if (name === 'bash' && typeof input?.command === 'string') trace.bashCommands.push(input.command);
    if (name === 'read' && typeof input?.path === 'string') trace.readPaths.push(input.path);
    if (name === 'write' && typeof input?.path === 'string') trace.writePaths.push(input.path);
    if (name === 'list' && typeof input?.path === 'string') trace.listPaths.push(input.path);
    if (name === 'ask_user_question') trace.questionCalls.push(input);
  }
  const tools = {
    bash: tool({
      description:
        'Run a bash command in the workspace root. Use this to invoke skill scripts (e.g. `node .claude/skills/impeccable/scripts/context.mjs`).',
      inputSchema: z.object({
        command: z.string().describe('The bash command to execute.'),
      }),
      execute: async ({ command }) => {
        record('bash', { command });
        const res = await execBash(workspace, command, 20_000, extraEnv);
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
        record('read', { path: p });
        const resolved = safeResolve(workspace, p);
        if (typeof resolved !== 'string') return `Error: ${resolved.error}`;
        if (!fs.existsSync(resolved)) return `File not found: ${p}`;
        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) return `Path is a directory: ${p}. Use list instead.`;
        return fs.readFileSync(resolved, 'utf8');
      },
    }),
    write: tool({
      description: 'Write or overwrite a file in the workspace. Creates parent directories as needed.',
      inputSchema: z.object({
        path: z.string().describe('Workspace-relative file path.'),
        contents: z.string().describe('Full file contents.'),
      }),
      execute: async ({ path: p, contents }) => {
        record('write', { path: p, contents });
        const resolved = safeResolve(workspace, p);
        if (typeof resolved !== 'string') return `Error: ${resolved.error}`;
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, contents);
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
export async function runTurn({ workspace, model, userPrompt, priorMessages = [], maxSteps = 8, env = {}, simulatedUser = {} }) {
  const { tools, trace } = makeTools(workspace, env, simulatedUser);
  const messages = [
    ...priorMessages,
    { role: 'user', content: userPrompt },
  ];
  let result;
  try {
    result = await generateText({
      model,
      system: SKILL_BODY,
      messages,
      tools,
      stopWhen: [stepCountIs(maxSteps)],
    });
  } catch (err) {
    throw new Error(`LLM behavior turn failed before completing: ${String(err)}`, { cause: err });
  }
  const generatedResponseMessages = result.responseMessages ?? result.response?.messages ?? [];
  const responseMessages = [...messages, ...generatedResponseMessages];
  return {
    trace,
    text: result.text ?? '',
    finishReason: result.finishReason,
    usage: result.usage,
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
export function fileLoaded(trace, filename) {
  return readsMatching(trace, filename).length > 0 || bashCommandsMatching(trace, filename).length > 0;
}

export function summarizeTrace(trace) {
  return {
    totalCalls: trace.toolCalls.length,
    byName: trace.toolCalls.reduce((acc, c) => ((acc[c.name] = (acc[c.name] ?? 0) + 1), acc), {}),
    bashCommands: trace.bashCommands,
    readPaths: trace.readPaths,
    writePaths: trace.writePaths,
    questionCalls: trace.questionCalls,
    questionAnswers: trace.questionAnswers,
  };
}
