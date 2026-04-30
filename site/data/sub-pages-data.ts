/**
 * Command category and relationship data for docs pages.
 * Extracted from scripts/lib/sub-pages-data.js for use in Astro templates.
 */

export const SKILL_CATEGORIES: Record<string, string> = {
  impeccable: 'create',
  craft: 'create',
  shape: 'create',
  critique: 'evaluate',
  audit: 'evaluate',
  typeset: 'refine',
  layout: 'refine',
  colorize: 'refine',
  animate: 'refine',
  delight: 'refine',
  bolder: 'refine',
  quieter: 'refine',
  overdrive: 'refine',
  distill: 'simplify',
  clarify: 'simplify',
  adapt: 'simplify',
  polish: 'harden',
  optimize: 'harden',
  harden: 'harden',
  onboard: 'harden',
  teach: 'system',
  document: 'system',
  extract: 'system',
  live: 'system',
};

export const CATEGORY_ORDER = ['create', 'evaluate', 'refine', 'simplify', 'harden', 'system'];

export const CATEGORY_LABELS: Record<string, string> = {
  create: 'Create',
  evaluate: 'Evaluate',
  refine: 'Refine',
  simplify: 'Simplify',
  harden: 'Harden',
  system: 'System',
};

export const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  create: 'Build something new, from a blank page to a working feature.',
  evaluate: 'Review what you have. Score it, critique it, find what to fix.',
  refine: 'Improve one dimension at a time: type, layout, color, motion.',
  simplify: 'Strip complexity. Remove what does not earn its place.',
  harden: 'Make it production-ready. Edge cases, performance, polish.',
  system: 'Setup and tooling. Design system work, extraction, organization.',
};

export const COMMAND_RELATIONSHIPS: Record<string, {
  leadsTo?: string[];
  pairs?: string;
  combinesWith?: string[];
}> = {
  craft: { combinesWith: ['shape'] },
  shape: { combinesWith: ['craft'] },
  audit: { leadsTo: ['harden', 'optimize', 'adapt', 'clarify'] },
  critique: { leadsTo: ['polish', 'distill', 'bolder', 'quieter', 'typeset', 'layout'] },
  typeset: { combinesWith: ['bolder', 'polish'] },
  layout: { combinesWith: ['distill', 'adapt'] },
  colorize: { combinesWith: ['bolder', 'delight'] },
  animate: { combinesWith: ['delight'] },
  delight: { combinesWith: ['bolder', 'animate'] },
  bolder: { pairs: 'quieter' },
  quieter: { pairs: 'bolder' },
  overdrive: { combinesWith: ['animate', 'delight'] },
  distill: { combinesWith: ['quieter', 'polish'] },
  clarify: { combinesWith: ['polish', 'adapt'] },
  adapt: { combinesWith: ['polish', 'clarify'] },
  polish: {},
  optimize: {},
  harden: { combinesWith: ['optimize'] },
  onboard: { combinesWith: ['clarify', 'delight'] },
  teach: { combinesWith: ['document'] },
  document: { combinesWith: ['teach', 'extract'] },
  extract: { combinesWith: ['document'] },
  live: {},
};
