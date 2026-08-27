/** The design-context store: the one place that knows where design context lives.
 *
 * Layout, under the project root:
 *
 *   .impeccable/design-context/
 *     context.json    { schemaVersion, modes, context }  the chat half of the interview
 *     answers.json    the questionnaire submission, flat FormData shape
 *     assets/         brand files the user supplied
 *     fonts/          font faces the user uploaded
 *     cue.png         the chosen hero, copied at submit so the document stands alone
 *     runtime/        session.json, journal.jsonl, draft.json  (gitignored)
 *     exports/        design-context.md, design-context.bundle.json  (gitignored)
 *
 * Two rules hold this together. Every write goes through writeJsonAtomic, so a
 * reader never sees a torn file. Every read comes off disk, so no process ever
 * answers from a copy the file has moved past.
 *
 * Zero dependencies beyond node: builtins, like every other picker script.
 */

import fs from 'node:fs';
import { readFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const STORE_DIR = '.impeccable/design-context';
export const WORKSPACE_DIR = '.impeccable/visual-cues';
/* The shape of context.json. Bump only when the shape changes, never for a release. */
export const SCHEMA_VERSION = 1;

const LEGACY_DIR = '.impeccable/design-interview';
const LEGACY_FONTS_PREFIX = `${LEGACY_DIR}/fonts/`;

export function paths(cwd = process.cwd()) {
  const store = path.resolve(cwd, STORE_DIR);
  const runtime = path.join(store, 'runtime');
  return {
    storeDir: store,
    contextJson: path.join(store, 'context.json'),
    answersJson: path.join(store, 'answers.json'),
    assetsDir: path.join(store, 'assets'),
    fontsDir: path.join(store, 'fonts'),
    cuePng: path.join(store, 'cue.png'),
    runtimeDir: runtime,
    sessionJson: path.join(runtime, 'session.json'),
    journalJsonl: path.join(runtime, 'journal.jsonl'),
    draftJson: path.join(runtime, 'draft.json'),
    exportsDir: path.join(store, 'exports'),
    workspaceDir: path.resolve(cwd, WORKSPACE_DIR),
    cuesJson: path.resolve(cwd, WORKSPACE_DIR, 'cues.json'),
    fontsManifestJson: path.resolve(cwd, WORKSPACE_DIR, 'fonts.json'),
  };
}

/** The project-relative path an uploaded font is reported by, and stored under. */
export function fontRelativePath(name) {
  return path.join(STORE_DIR, 'fonts', name);
}

export async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, filePath);
}

export async function readJsonSoft(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export const readContext = (cwd = process.cwd()) => readJsonSoft(paths(cwd).contextJson);
export const writeContext = (value, cwd = process.cwd()) => writeJsonAtomic(paths(cwd).contextJson, value);
export const readAnswers = (cwd = process.cwd()) => readJsonSoft(paths(cwd).answersJson);
export const writeAnswers = (value, cwd = process.cwd()) => writeJsonAtomic(paths(cwd).answersJson, value);
export const readDraft = (cwd = process.cwd()) => readJsonSoft(paths(cwd).draftJson);
export const writeDraft = (value, cwd = process.cwd()) => writeJsonAtomic(paths(cwd).draftJson, value);
export const clearDraft = (cwd = process.cwd()) => rm(paths(cwd).draftJson, { force: true }).catch(() => {});

/* ============================================================
   The journal: append-only, replayed on every read.
   ============================================================ */

/** Append one event, stamped with the next seq and a timestamp. Returns the seq. */
export function appendJournal(event, cwd = process.cwd()) {
  const { runtimeDir, journalJsonl } = paths(cwd);
  const seq = replayJournal(cwd).lastSeq + 1;
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.appendFileSync(journalJsonl, `${JSON.stringify({ seq, ts: new Date().toISOString(), ...event })}\n`);
  return seq;
}

/**
 * Fold the journal into the state a booting session needs.
 *
 * Lines the fold cannot use are collected rather than thrown: a legacy
 * doc-edits.jsonl record carries { at, type: 'color' } and no seq, and a torn
 * final line is possible after a hard kill. Neither can move lastSeq or
 * resurrect a batch, so both are diagnostics, not failures.
 */
export function replayJournal(cwd = process.cwd()) {
  const { journalJsonl } = paths(cwd);
  const state = { lastSeq: 0, pendingBatch: null, entries: [], diagnostics: [] };

  let raw;
  try {
    raw = fs.readFileSync(journalJsonl, 'utf8');
  } catch {
    return state;
  }

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      state.diagnostics.push({ reason: 'unparseable', line: line.slice(0, 200) });
      continue;
    }
    if (!entry || typeof entry !== 'object' || !Number.isInteger(entry.seq)) {
      state.diagnostics.push({ reason: 'legacy-or-unsequenced', type: entry?.type || null });
      continue;
    }
    state.entries.push(entry);
    if (entry.seq > state.lastSeq) state.lastSeq = entry.seq;
    if (entry.type === 'batch') {
      state.pendingBatch = entry.status === 'pending' ? entry : null;
    }
  }
  return state;
}

/* ============================================================
   Migration from the pre-store layout.
   ============================================================ */

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    /* EPERM means the process exists and is not ours to signal. */
    return error.code === 'EPERM';
  }
}

async function moveFile(from, to) {
  if (fs.existsSync(to) || !fs.existsSync(from)) return false;
  await mkdir(path.dirname(to), { recursive: true });
  await rename(from, to);
  return true;
}

/* Directories move child by child: renaming onto an existing directory fails,
   and a run interrupted halfway leaves a destination that already exists. */
async function moveDirContents(fromDir, toDir) {
  if (!fs.existsSync(fromDir)) return;
  await mkdir(toDir, { recursive: true });
  for (const name of fs.readdirSync(fromDir)) {
    await moveFile(path.join(fromDir, name), path.join(toDir, name));
  }
  try {
    if (fs.readdirSync(fromDir).length === 0) fs.rmdirSync(fromDir);
  } catch {
    /* Something arrived between the read and the remove; leaving it is safe. */
  }
}

/** Uploaded-face paths were recorded as strings inside the answers themselves. */
function rewriteFontSources(answers) {
  if (!answers || typeof answers !== 'object') return null;
  let touched = false;
  for (const [key, value] of Object.entries(answers)) {
    if (typeof value !== 'string' || !value.includes(LEGACY_FONTS_PREFIX)) continue;
    answers[key] = value.split(LEGACY_FONTS_PREFIX).join(`${STORE_DIR}/fonts/`);
    touched = true;
  }
  return touched ? answers : null;
}

/**
 * Bring a pre-store project onto the current layout. Idempotent and silent:
 * a project that is already current, or was never interviewed, does nothing.
 *
 * A live session of the old shape holds the old paths in its own constants, so
 * migrating under it would strand its writes. That case defers to the next boot.
 */
export async function migrate(cwd = process.cwd()) {
  const legacyDir = path.resolve(cwd, LEGACY_DIR);
  if (!fs.existsSync(legacyDir)) {
    await migrateContextFromCues(cwd);
    return { migrated: false, deferred: false };
  }

  const legacySession = path.join(legacyDir, 'doc-session.json');
  const session = await readJsonSoft(legacySession);
  if (session && pidAlive(session.pid)) return { migrated: false, deferred: true };

  const target = paths(cwd);
  await moveFile(path.join(legacyDir, 'answers.json'), target.answersJson);
  await moveFile(path.join(legacyDir, 'doc-edits.jsonl'), target.journalJsonl);
  await moveDirContents(path.join(legacyDir, 'assets'), target.assetsDir);
  await moveDirContents(path.join(legacyDir, 'fonts'), target.fontsDir);

  const answers = await readJsonSoft(target.answersJson);
  const rewritten = rewriteFontSources(answers);
  if (rewritten) await writeJsonAtomic(target.answersJson, rewritten);

  await rm(legacySession, { force: true }).catch(() => {});
  try {
    if (fs.readdirSync(legacyDir).length === 0) fs.rmdirSync(legacyDir);
  } catch {
    /* Files the migration does not own stay where they are. */
  }

  await migrateContextFromCues(cwd);
  return { migrated: true, deferred: false };
}

/* The chat half of the interview used to ride inside the cue manifest. It is
   not a generation artifact, so it moves to the store; cues.json keeps its
   cues and palette and is left untouched. */
async function migrateContextFromCues(cwd) {
  const target = paths(cwd);
  if (fs.existsSync(target.contextJson)) return;
  const cues = await readJsonSoft(target.cuesJson);
  if (!cues) return;
  const hasModes = Array.isArray(cues.modes);
  const hasContext = cues.context && typeof cues.context === 'object';
  if (!hasModes && !hasContext) return;
  await writeJsonAtomic(target.contextJson, {
    schemaVersion: SCHEMA_VERSION,
    ...(hasModes ? { modes: cues.modes } : {}),
    ...(hasContext ? { context: cues.context } : {}),
  });
}
