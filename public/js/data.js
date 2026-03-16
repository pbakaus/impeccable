// ============================================
// DATA: Skill focus areas, command processes, relationships
// ============================================

// Items that are fully complete and ready for public use
// All others will show "Coming Soon"
export const readySkills = [
  'frontend-design'  // Consolidated skill with all design domains
];

export const readyCommands = [
  'normalize'  // First command to be fully completed
];

// Commands marked as beta — shown with a badge in the UI
export const betaCommands = [
  'overdrive'
];

// Consolidated frontend-design skill with reference domains
export const skillFocusAreas = {
  'frontend-design': [
    { area: 'Typography', detail: 'Scale, rhythm, hierarchy, expression' },
    { area: 'Color & Contrast', detail: 'Accessibility, systems, theming' },
    { area: 'Spatial Design', detail: 'Layout, spacing, composition' },
    { area: 'Responsive', detail: 'Fluid layouts, touch targets' },
    { area: 'Interaction', detail: 'States, feedback, affordances' },
    { area: 'Motion', detail: 'Micro-interactions, transitions' },
    { area: 'UX Writing', detail: 'Clarity, voice, error messages' }
  ]
};

// Reference domains within the frontend-design skill
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
  'teach-impeccable': ['Gather', 'Clarify', 'Document', 'Save'],
  'audit': ['Scan', 'Document', 'Prioritize', 'Recommend'],
  'critique': ['Evaluate', 'Critique', 'Prioritize', 'Suggest'],
  'normalize': ['Analyze', 'Identify', 'Align', 'Verify'],
  'polish': ['Review', 'Refine', 'Verify'],
  'optimize': ['Profile', 'Identify', 'Improve', 'Measure'],
  'harden': ['Test', 'Handle', 'Wrap', 'Validate'],
  'clarify': ['Read', 'Simplify', 'Improve', 'Test'],
  'quieter': ['Analyze', 'Reduce', 'Refine'],
  'bolder': ['Analyze', 'Amplify', 'Impact'],
  'distill': ['Audit', 'Remove', 'Clarify'],
  'animate': ['Identify', 'Design', 'Implement', 'Polish'],
  'colorize': ['Analyze', 'Strategy', 'Apply', 'Balance'],
  'delight': ['Identify', 'Design', 'Implement'],
  'extract': ['Identify', 'Abstract', 'Document'],
  'adapt': ['Analyze', 'Adjust', 'Optimize'],
  'onboard': ['Map', 'Design', 'Guide'],
  'typeset': ['Assess', 'Select', 'Scale', 'Refine'],
  'arrange': ['Assess', 'Grid', 'Rhythm', 'Balance'],
  'overdrive': ['Assess', 'Choose', 'Build', 'Polish']
};

export const commandCategories = {
  'teach-impeccable': 'system',
  'audit': 'diagnostic',
  'critique': 'diagnostic',
  'normalize': 'quality',
  'polish': 'quality',
  'optimize': 'quality',
  'harden': 'quality',
  'clarify': 'adaptation',
  'quieter': 'intensity',
  'bolder': 'intensity',
  'distill': 'adaptation',
  'animate': 'enhancement',
  'colorize': 'enhancement',
  'delight': 'enhancement',
  'extract': 'system',
  'adapt': 'adaptation',
  'onboard': 'enhancement',
  'typeset': 'enhancement',
  'arrange': 'enhancement',
  'overdrive': 'enhancement'
};

// Skill relationships - now consolidated into frontend-design skill
// The frontend-design skill contains all domains as reference files
export const skillRelationships = {
  'frontend-design': {
    description: 'Comprehensive design intelligence with progressive reference loading',
    referenceDomains: ['typography', 'color-and-contrast', 'spatial-design', 'responsive-design', 'interaction-design', 'motion-design', 'ux-writing']
  }
};

export const commandRelationships = {
  'teach-impeccable': { flow: 'Setup: One-time project context gathering' },
  'audit': { leadsTo: ['normalize', 'harden', 'optimize', 'adapt', 'clarify'], flow: 'Diagnostic: Technical quality audit' },
  'critique': { leadsTo: ['polish', 'distill', 'bolder', 'quieter', 'typeset', 'arrange'], flow: 'Diagnostic: UX and design review' },
  'normalize': { combinesWith: ['clarify', 'adapt'], flow: 'Quality: Align with design system' },
  'polish': { flow: 'Quality: Final pass before shipping' },
  'optimize': { flow: 'Quality: Performance improvements' },
  'harden': { combinesWith: ['optimize'], flow: 'Quality: Error handling & edge cases' },
  'clarify': { combinesWith: ['normalize', 'adapt'], flow: 'Adaptation: Improve UX copy' },
  'quieter': { pairs: 'bolder', flow: 'Intensity: Tone down bold designs' },
  'bolder': { pairs: 'quieter', flow: 'Intensity: Amplify timid designs' },
  'distill': { combinesWith: ['quieter', 'normalize'], flow: 'Adaptation: Strip to essence' },
  'animate': { combinesWith: ['delight'], flow: 'Enhancement: Add motion' },
  'colorize': { combinesWith: ['bolder', 'delight'], flow: 'Enhancement: Add strategic color' },
  'delight': { combinesWith: ['bolder', 'animate'], flow: 'Enhancement: Add personality' },
  'extract': { flow: 'System: Create design system elements' },
  'adapt': { combinesWith: ['normalize', 'clarify'], flow: 'Adaptation: Different devices/contexts' },
  'onboard': { combinesWith: ['clarify', 'delight'], flow: 'Enhancement: Onboarding & empty states' },
  'typeset': { combinesWith: ['bolder', 'normalize'], flow: 'Enhancement: Fix typography' },
  'arrange': { combinesWith: ['distill', 'adapt'], flow: 'Enhancement: Fix layout & spacing' },
  'overdrive': { combinesWith: ['animate', 'delight'], flow: 'Enhancement: Technically extraordinary effects' }
};

