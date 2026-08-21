/**
 * Category map for user-invocable skills, consumed by the provider
 * transformers. The site-side page data model (sub-pages-data.js) lives in
 * the private impeccable-site repo and keeps its own copy.
 */

export const SKILL_CATEGORIES = {
  // CREATE - build something new
  // craft is deliberately unmapped: it is a deprecated compatibility alias
  // (see the router table), and a command without a category stays out of
  // the generated argument-hint while continuing to route.
  impeccable: 'create',
  shape: 'create',
  // EVALUATE - review and assess
  'design-context': 'system',
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
  init: 'system',
  document: 'system',
  extract: 'system',
  live: 'system',
};

export const CATEGORY_ORDER = ['create', 'evaluate', 'refine', 'simplify', 'harden', 'system'];
