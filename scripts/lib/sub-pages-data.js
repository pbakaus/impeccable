/**
 * Build the data model used by the skill / anti-pattern / tutorial page
 * generators.
 *
 * Single source of truth:
 * - skill/SKILL.md                       → skill frontmatter + body
 * - skill/reference/*.md                  → skill reference files
 * - src/detect-antipatterns.mjs           → ANTIPATTERNS array (parsed)
 * - site/content/skills/{id}.md           → optional editorial wrapper
 * - site/content/tutorials/{slug}.md       → full tutorial content
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSourceFiles, parseFrontmatter, replacePlaceholders } from './utils.js';
import {
  DETECTION_LAYERS,
  VISUAL_EXAMPLES,
  LLM_ONLY_RULES,
  GALLERY_ITEMS,
} from '../../site/data/anti-patterns-catalog.js';

export {
  LAYER_LABELS,
  LAYER_DESCRIPTIONS,
  GALLERY_ITEMS,
} from '../../site/data/anti-patterns-catalog.js';

/**
 * Skills that should be excluded from the index and not get a detail page.
 * These are deprecated shims or internal skills that users shouldn't browse.
 */
const EXCLUDED_SKILLS = new Set([
  'frontend-design',   // deprecated, renamed to impeccable
  'teach-impeccable',  // deprecated, folded into /impeccable teach
  'arrange',           // renamed to layout
  'normalize',         // merged into /polish
]);

/**
 * Hand-curated category map for user-invocable skills.
 * Mirrors public/js/data.js commandCategories. Validated below: the
 * generator fails if any user-invocable skill is missing from this map.
 */
export const SKILL_CATEGORIES = {
  // CREATE - build something new
  impeccable: 'create',
  craft: 'create',
  shape: 'create',
  // EVALUATE - review and assess
  critique: 'evaluate',
  audit: 'evaluate',
  // REFINE - improve existing design
  typeset: 'refine',
  layout: 'refine',
  colorize: 'refine',
  animate: 'refine',
  delight: 'refine',
  bolder: 'refine',
  quieter: 'refine',
  overdrive: 'refine',
  // SIMPLIFY - reduce and clarify
  distill: 'simplify',
  clarify: 'simplify',
  adapt: 'simplify',
  // HARDEN - production-ready
  polish: 'harden',
  optimize: 'harden',
  harden: 'harden',
  onboard: 'harden',
  // SYSTEM - setup and tooling
  teach: 'system',
  document: 'system',
  extract: 'system',
  live: 'system',
};

export const CATEGORY_ORDER = ['create', 'evaluate', 'refine', 'simplify', 'harden', 'system'];

export const CATEGORY_LABELS = {
  create: 'Create',
  evaluate: 'Evaluate',
  refine: 'Refine',
  simplify: 'Simplify',
  harden: 'Harden',
  system: 'System',
};

export const CATEGORY_DESCRIPTIONS = {
  create: 'Build something new, from a blank page to a working feature.',
  evaluate: 'Review what you have. Score it, critique it, find what to fix.',
  refine: 'Improve one dimension at a time: type, layout, color, motion.',
  simplify: 'Strip complexity. Remove what does not earn its place.',
  harden: 'Make it production-ready. Edge cases, performance, polish.',
  system: 'Setup and tooling. Design system work, extraction, organization.',
};

/**
 * How commands relate to each other. Mirrors public/js/data.js so the server
 * can render the docs overview without loading the client bundle.
 *
 * - leadsTo: commands that typically follow this one (used for evaluators)
 * - pairs: the inverse counterpart (bolder <-> quieter)
 * - combinesWith: commands that work well alongside this one
 */
export const COMMAND_RELATIONSHIPS = {
  // Create
  craft: { combinesWith: ['shape'] },
  shape: { combinesWith: ['craft'] },
  // Evaluate (these are the "diagnostics" that lead to fixes)
  audit: { leadsTo: ['harden', 'optimize', 'adapt', 'clarify'] },
  critique: { leadsTo: ['polish', 'distill', 'bolder', 'quieter', 'typeset', 'layout'] },
  // Refine
  typeset: { combinesWith: ['bolder', 'polish'] },
  layout: { combinesWith: ['distill', 'adapt'] },
  colorize: { combinesWith: ['bolder', 'delight'] },
  animate: { combinesWith: ['delight'] },
  delight: { combinesWith: ['bolder', 'animate'] },
  bolder: { pairs: 'quieter' },
  quieter: { pairs: 'bolder' },
  overdrive: { combinesWith: ['animate', 'delight'] },
  // Simplify
  distill: { combinesWith: ['quieter', 'polish'] },
  clarify: { combinesWith: ['polish', 'adapt'] },
  adapt: { combinesWith: ['polish', 'clarify'] },
  // Harden
  polish: {},
  optimize: {},
  harden: { combinesWith: ['optimize'] },
  onboard: { combinesWith: ['clarify', 'delight'] },
  // System
  teach: { combinesWith: ['document'] },
  document: { combinesWith: ['teach', 'extract'] },
  extract: { combinesWith: ['document'] },
  live: {},
};

/**
 * Parse the ANTIPATTERNS array out of src/detect-antipatterns.mjs.
 * Mirrors the trick in scripts/build.js validateAntipatternRules() so we
 * don't have to run the browser-only module.
 */
export function readAntipatternRules(rootDir) {
  const detectPath = path.join(rootDir, 'src/detect-antipatterns.mjs');
  const src = fs.readFileSync(detectPath, 'utf-8');
  const match = src.match(/const ANTIPATTERNS = \[([\s\S]*?)\n\];/);
  if (!match) {
    throw new Error(`Could not extract ANTIPATTERNS from ${detectPath}`);
  }
  // eslint-disable-next-line no-new-func
  return new Function(`return [${match[1]}]`)();
}

/**
 * Read an optional editorial wrapper file for a skill or tutorial.
 * Returns { frontmatter, body } or null if the file doesn't exist.
 */
export function readEditorialWrapper(contentDir, kind, slug) {
  const filePath = path.join(contentDir, kind, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseFrontmatter(content);
}

/**
 * Load the per-command before/after demo data from public/js/demos/commands.
 * Returns a { [skillId]: { id, caption, before, after } } map.
 * Skills without a demo file are simply missing from the map; the caller
 * should treat a missing entry as "no demo".
 */
export async function loadCommandDemos(rootDir) {
  const demosDir = path.join(rootDir, 'site/public/js/demos/commands');
  if (!fs.existsSync(demosDir)) return {};

  const demos = {};
  const files = fs
    .readdirSync(demosDir)
    .filter((f) => f.endsWith('.js') && f !== 'index.js');

  for (const file of files) {
    const full = path.join(demosDir, file);
    try {
      const mod = await import(pathToFileURL(full).href);
      const demo = mod.default;
      if (demo && demo.id) {
        demos[demo.id] = demo;
      }
    } catch (err) {
      // Demo files occasionally import other demo modules or use features
      // that don't survive dynamic import. Log and move on rather than
      // failing the whole generator.
      console.warn(`[sub-pages] Could not load demo ${file}: ${err.message}`);
    }
  }
  return demos;
}

/**
 * Build the full sub-page data model.
 *
 * @param {string} rootDir - repo root
 * @returns {{
 *   skills: Array,
 *   skillsByCategory: Record<string, Array>,
 *   knownSkillIds: Set<string>,
 *   rules: Array,
 *   tutorials: Array,
 * }}
 */
export async function buildSubPageData(rootDir) {
  const { skills: rawSkills } = readSourceFiles(rootDir);
  const contentDir = path.join(rootDir, 'site/content');
  const commandDemos = await loadCommandDemos(rootDir);

  // After the v3.0 consolidation there's only one source skill (impeccable).
  // Its reference/ directory holds one file per command (audit.md, polish.md, ...).
  // We synthesize a virtual skill entry for each sub-command so the sub-page
  // generators can keep rendering per-command pages, index cards, etc.
  const impeccableSkill = rawSkills.find((s) => s.name === 'impeccable');
  const metadataPath = path.join(rootDir, 'skill/scripts/command-metadata.json');
  let commandMetadata = {};
  if (fs.existsSync(metadataPath)) {
    commandMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  }

  // Reference files and skill bodies use {{command_prefix}} placeholders that
  // are normally replaced by the provider transformer at build time. For web
  // rendering, resolve them here using the claude-code provider as the canonical
  // form ("/" prefix). The list of all command names includes the root skill
  // plus all sub-commands from metadata so cross-references render correctly.
  const allCommandNames = ['impeccable', ...Object.keys(commandMetadata)];
  const resolvePlaceholders = (content) =>
    replacePlaceholders(content, 'claude-code', [], allCommandNames);

  const skills = [];

  // 1. The root impeccable skill itself.
  if (impeccableSkill && !EXCLUDED_SKILLS.has(impeccableSkill.name)) {
    const editorial = readEditorialWrapper(contentDir, 'skills', 'impeccable');
    const demo = commandDemos['impeccable'] || null;
    skills.push({
      id: 'impeccable',
      name: 'impeccable',
      description: impeccableSkill.description,
      argumentHint: impeccableSkill.argumentHint,
      category: SKILL_CATEGORIES['impeccable'],
      body: resolvePlaceholders(impeccableSkill.body),
      references: (impeccableSkill.references || []).map((r) => ({
        ...r,
        content: resolvePlaceholders(r.content),
      })),
      editorial,
      demo,
      isSubCommand: false,
    });
  }

  // 2. One virtual entry per sub-command, body sourced from its reference file.
  if (impeccableSkill) {
    for (const [cmdId, meta] of Object.entries(commandMetadata)) {
      if (EXCLUDED_SKILLS.has(cmdId)) continue;
      const refFile = impeccableSkill.references?.find((r) => r.name === cmdId);
      if (!refFile) continue; // no reference file = no page

      const editorial = readEditorialWrapper(contentDir, 'skills', cmdId);
      const demo = commandDemos[cmdId] || null;
      skills.push({
        id: cmdId,
        name: cmdId,
        description: meta.description,
        argumentHint: meta.argumentHint,
        category: SKILL_CATEGORIES[cmdId],
        body: resolvePlaceholders(refFile.content),
        references: [], // sub-commands don't have their own references
        editorial,
        demo,
        isSubCommand: true,
      });
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));

  // Validate the category map covers every skill entry.
  const missing = skills.filter((s) => !s.category).map((s) => s.id);
  if (missing.length > 0) {
    throw new Error(
      `SKILL_CATEGORIES in scripts/lib/sub-pages-data.js is missing entries for: ${missing.join(', ')}`,
    );
  }

  const knownSkillIds = new Set(skills.map((s) => s.id));

  const skillsByCategory = {};
  for (const cat of CATEGORY_ORDER) skillsByCategory[cat] = [];
  for (const skill of skills) skillsByCategory[skill.category].push(skill);

  // Anti-pattern rules, enriched with catalog metadata and merged with
  // LLM-only rules from the skill's DON'T list.
  const detectedRules = readAntipatternRules(rootDir).map((r) => ({
    ...r,
    layer: DETECTION_LAYERS[r.id] || 'cli',
    visual: VISUAL_EXAMPLES[r.id] || null,
  }));
  const llmRules = LLM_ONLY_RULES.map((r) => ({
    ...r,
    layer: 'llm',
    visual: VISUAL_EXAMPLES[r.id] || null,
  }));
  const rules = [...detectedRules, ...llmRules];

  // Tutorials: each required file in site/content/tutorials/.
  const tutorialsDir = path.join(contentDir, 'tutorials');
  const tutorials = [];
  if (fs.existsSync(tutorialsDir)) {
    const files = fs.readdirSync(tutorialsDir).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      const slug = path.basename(file, '.md');
      const raw = fs.readFileSync(path.join(tutorialsDir, file), 'utf-8');
      const { frontmatter, body } = parseFrontmatter(raw);
      tutorials.push({
        slug,
        title: frontmatter.title || slug,
        description: frontmatter.description || '',
        tagline: frontmatter.tagline || '',
        order: frontmatter.order ? Number(frontmatter.order) : 99,
        body,
      });
    }
    tutorials.sort((a, b) => a.order - b.order);
  }

  return {
    skills,
    skillsByCategory,
    knownSkillIds,
    rules,
    tutorials,
  };
}
