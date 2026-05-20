// ============================================
// DATA: Skill focus areas, command processes, relationships
// ============================================

// Items that are fully complete and ready for public use
// All others will show "Coming Soon"
export const readySkills = [
  'impeccable'  // Consolidated skill with all design domains
];

export const readyCommands = [
  'layout'  // First command to be fully completed
];

// Commands marked as alpha — shown with a badge in the UI
export const alphaCommands = [
  'live'
];

// Consolidated impeccable skill with reference domains
export const skillFocusAreas = {
  'impeccable': [
    { area: 'Typography', detail: 'Scale, rhythm, hierarchy, expression' },
    { area: 'Color & Contrast', detail: 'Accessibility, systems, theming' },
    { area: 'Spatial Design', detail: 'Layout, spacing, composition' },
    { area: 'Responsive', detail: 'Fluid layouts, touch targets' },
    { area: 'Interaction', detail: 'States, feedback, affordances' },
    { area: 'Motion', detail: 'Micro-interactions, transitions' },
    { area: 'UX Writing', detail: 'Clarity, voice, error messages' }
  ]
};

// Guideline counts per dimension (verified from reference files)
export const dimensionGuidelineCounts = {
  'Typography': 33,
  'Color & Contrast': 29,
  'Spatial Design': 27,
  'Motion': 32,
  'Interaction': 36,
  'Responsive': 23,
  'UX Writing': 32
};

// Reference domains within the impeccable skill
export const skillReferenceDomains = [
  'typography',
  'color-and-contrast',
  'spatial-design',
  'responsive-design',
  'interaction-design',
  'motion-design',
  'ux-writing'
];

export const commandProcessSteps = {
  'impeccable': ['Direct', 'Design', 'Build', 'Refine'],
  'craft': ['Shape', 'Reference', 'Build', 'Iterate'],
  'shape': ['Interview', 'Synthesize', 'Brief', 'Confirm'],
  'overdrive': ['Assess', 'Choose', 'Build', 'Polish'],
  'critique': ['Evaluate', 'Critique', 'Prioritize', 'Suggest'],
  'audit': ['Scan', 'Document', 'Prioritize', 'Recommend'],
  'typeset': ['Assess', 'Select', 'Scale', 'Refine'],
  'layout': ['Assess', 'Grid', 'Rhythm', 'Balance'],
  'colorize': ['Analyze', 'Strategy', 'Apply', 'Balance'],
  'animate': ['Identify', 'Design', 'Implement', 'Polish'],
  'delight': ['Identify', 'Design', 'Implement'],
  'bolder': ['Analyze', 'Amplify', 'Impact'],
  'quieter': ['Analyze', 'Reduce', 'Refine'],
  'distill': ['Audit', 'Remove', 'Clarify'],
  'clarify': ['Read', 'Simplify', 'Improve', 'Test'],
  'adapt': ['Analyze', 'Adjust', 'Optimize'],
  'polish': ['Discover', 'Review', 'Refine', 'Verify'],
  'optimize': ['Profile', 'Identify', 'Improve', 'Measure'],
  'harden': ['Assess', 'Implement', 'Test', 'Verify'],
  'onboard': ['Identify', 'Design', 'Guide', 'Measure'],
  'teach': ['Explore', 'Interview', 'Synthesize', 'Save'],
  'document': ['Scan', 'Extract', 'Describe', 'Write'],
  'extract': ['Identify', 'Abstract', 'Migrate', 'Document'],
  'live': ['Start', 'Select', 'Generate', 'Accept']
};

export const commandCategories = {
  // CREATE - build something new
  'impeccable': 'create',
  'craft': 'create',
  'shape': 'create',
  // EVALUATE - review and assess
  'critique': 'evaluate',
  'audit': 'evaluate',
  // REFINE - improve existing design
  'typeset': 'refine',
  'layout': 'refine',
  'colorize': 'refine',
  'animate': 'refine',
  'delight': 'refine',
  'bolder': 'refine',
  'quieter': 'refine',
  'overdrive': 'refine',
  // SIMPLIFY - reduce and clarify
  'distill': 'simplify',
  'clarify': 'simplify',
  'adapt': 'simplify',
  // HARDEN - production-ready
  'polish': 'harden',
  'optimize': 'harden',
  'harden': 'harden',
  'onboard': 'harden',
  // SYSTEM - setup and tooling
  'teach': 'system',
  'document': 'system',
  'extract': 'system',
  'live': 'system'
};

// Skill relationships - now consolidated into impeccable skill
// The impeccable skill contains all domains as reference files
export const skillRelationships = {
  'impeccable': {
    description: 'Comprehensive design intelligence with progressive reference loading',
    referenceDomains: ['typography', 'color-and-contrast', 'spatial-design', 'responsive-design', 'interaction-design', 'motion-design', 'ux-writing']
  }
};

export const commandRelationships = {
  'impeccable': { flow: 'Create: Freeform design with full design intelligence' },
  'craft': { flow: 'Create: Full shape-then-build flow with visual iteration' },
  'shape': { flow: 'Create: Plan UX and UI through structured discovery' },
  'critique': { leadsTo: ['polish', 'distill', 'bolder', 'quieter', 'typeset', 'layout'], flow: 'Evaluate: UX and design review with scoring' },
  'audit': { leadsTo: ['harden', 'optimize', 'adapt', 'clarify'], flow: 'Evaluate: Technical quality audit' },
  'typeset': { combinesWith: ['bolder', 'polish'], flow: 'Refine: Fix typography and type hierarchy' },
  'layout': { combinesWith: ['distill', 'adapt'], flow: 'Refine: Fix layout and spacing' },
  'colorize': { combinesWith: ['bolder', 'delight'], flow: 'Refine: Add strategic color' },
  'animate': { combinesWith: ['delight'], flow: 'Refine: Add purposeful motion' },
  'delight': { combinesWith: ['bolder', 'animate'], flow: 'Refine: Add personality and joy' },
  'bolder': { pairs: 'quieter', flow: 'Refine: Amplify timid designs' },
  'quieter': { pairs: 'bolder', flow: 'Refine: Tone down aggressive designs' },
  'overdrive': { combinesWith: ['animate', 'delight'], flow: 'Refine: Technically extraordinary effects' },
  'distill': { combinesWith: ['quieter', 'polish'], flow: 'Simplify: Strip to essence' },
  'clarify': { combinesWith: ['polish', 'adapt'], flow: 'Simplify: Improve UX copy' },
  'adapt': { combinesWith: ['polish', 'clarify'], flow: 'Simplify: Adapt for different contexts' },
  'polish': { flow: 'Harden: Final pass and design system alignment' },
  'optimize': { flow: 'Harden: Performance improvements' },
  'harden': { combinesWith: ['optimize'], flow: 'Harden: Edge cases, error handling, and i18n' },
  'onboard': { combinesWith: ['clarify', 'delight'], flow: 'Harden: First-run experiences and empty states' },
  'teach': { flow: 'System: One-time project design context setup' },
  'extract': { flow: 'System: Extract design system components and tokens' },
  'live': { flow: 'System: Visual variant mode in the browser' }
};
