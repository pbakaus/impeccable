/**
 * Build the data model used by the skill / anti-pattern / tutorial page
 * generators.
 *
 * Single source of truth:
 * - source/skills/{id}/SKILL.md          → skill frontmatter + body
 * - source/skills/{id}/reference/*.md     → skill reference files
 * - src/detect-antipatterns.mjs           → ANTIPATTERNS array (parsed)
 * - content/site/skills/{id}.md           → optional editorial wrapper
 * - content/site/tutorials/{slug}.md       → full tutorial content
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSourceFiles, parseFrontmatter } from './utils.js';
import { ANTIPATTERNS } from '../../src/detect-antipatterns.mjs';
import {
  DETECTION_LAYERS,
  VISUAL_EXAMPLES,
  LLM_ONLY_RULES,
  GALLERY_ITEMS,
} from '../../content/site/anti-patterns-catalog.js';

export {
  LAYER_LABELS,
  LAYER_DESCRIPTIONS,
  GALLERY_ITEMS,
} from '../../content/site/anti-patterns-catalog.js';

/**
 * Skills that should be excluded from the index and not get a detail page.
 * These are deprecated shims or internal skills that users shouldn't browse.
 */
const EXCLUDED_SKILLS = new Set([
  'frontend-design',   // deprecated, renamed to impeccable
  'teach-impeccable',  // deprecated, folded into /impeccable teach
  'arrange',           // renamed to layout
  'normalize',         // merged into /polish
  'onboard',           // merged into /harden
  'extract',           // merged into /impeccable extract
]);

/**
 * Hand-curated category map for user-invocable skills.
 * Mirrors public/js/data.js commandCategories. Validated below: the
 * generator fails if any user-invocable skill is missing from this map.
 */
const SKILL_CATEGORIES = {
  // CREATE - build something new
  impeccable: 'create',
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
};

export const CATEGORY_ORDER = ['create', 'evaluate', 'refine', 'simplify', 'harden'];

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
 * Returns the ANTIPATTERNS array from src/detect-antipatterns.mjs.
 * Previously extracted via regex + new Function(); now uses a direct ESM import.
 */
export function readAntipatternRules(_rootDir) {
  return ANTIPATTERNS;
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
  const demosDir = path.join(rootDir, 'public/js/demos/commands');
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
  const contentDir = path.join(rootDir, 'content/site');
  const commandDemos = await loadCommandDemos(rootDir);

  // Filter to user-invocable, non-deprecated skills.
  const skills = rawSkills
    .filter((s) => s.userInvocable && !EXCLUDED_SKILLS.has(s.name))
    .map((s) => {
      const category = SKILL_CATEGORIES[s.name];
      const editorial = readEditorialWrapper(contentDir, 'skills', s.name);
      const demo = commandDemos[s.name] || null;
      return {
        id: s.name,
        name: s.name,
        description: s.description,
        argumentHint: s.argumentHint,
        category,
        body: s.body,
        references: s.references,
        editorial, // may be null
        demo, // may be null (e.g. /shape has no demo)
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Validate the category map covers every user-invocable skill.
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

  // Tutorials: each required file in content/site/tutorials/.
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
