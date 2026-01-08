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
  'review': ['Evaluate', 'Critique', 'Prioritize', 'Suggest'],
  'normalize': ['Analyze', 'Identify', 'Align', 'Verify'],
  'polish': ['Review', 'Refine', 'Verify'],
  'optimize': ['Profile', 'Identify', 'Improve', 'Measure'],
  'harden': ['Test', 'Handle', 'Wrap', 'Validate'],
  'clarify': ['Read', 'Simplify', 'Improve', 'Test'],
  'quieter': ['Analyze', 'Reduce', 'Refine'],
  'bolder': ['Analyze', 'Amplify', 'Impact'],
  'simplify': ['Audit', 'Remove', 'Clarify'],
  'animate': ['Identify', 'Design', 'Implement', 'Polish'],
  'colorize': ['Analyze', 'Strategy', 'Apply', 'Balance'],
  'delight': ['Identify', 'Design', 'Implement'],
  'extract': ['Identify', 'Abstract', 'Document'],
  'adapt': ['Analyze', 'Adjust', 'Optimize'],
  'onboard': ['Map', 'Design', 'Guide']
};

export const commandCategories = {
  'teach-impeccable': 'system',
  'audit': 'diagnostic',
  'review': 'diagnostic',
  'normalize': 'quality',
  'polish': 'quality',
  'optimize': 'quality',
  'harden': 'quality',
  'clarify': 'adaptation',
  'quieter': 'intensity',
  'bolder': 'intensity',
  'simplify': 'adaptation',
  'animate': 'enhancement',
  'colorize': 'enhancement',
  'delight': 'enhancement',
  'extract': 'system',
  'adapt': 'adaptation',
  'onboard': 'system'
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
  'review': { leadsTo: ['polish', 'simplify', 'bolder', 'quieter'], flow: 'Diagnostic: UX and design review' },
  'normalize': { combinesWith: ['clarify', 'adapt'], flow: 'Quality: Align with design system' },
  'polish': { flow: 'Quality: Final pass before shipping' },
  'optimize': { flow: 'Quality: Performance improvements' },
  'harden': { combinesWith: ['optimize'], flow: 'Quality: Error handling & edge cases' },
  'clarify': { combinesWith: ['normalize', 'adapt'], flow: 'Adaptation: Improve UX copy' },
  'quieter': { pairs: 'bolder', flow: 'Intensity: Tone down bold designs' },
  'bolder': { pairs: 'quieter', flow: 'Intensity: Amplify timid designs' },
  'simplify': { combinesWith: ['quieter', 'normalize'], flow: 'Adaptation: Strip to essence' },
  'animate': { combinesWith: ['delight'], flow: 'Enhancement: Add motion' },
  'colorize': { combinesWith: ['bolder', 'delight'], flow: 'Enhancement: Add strategic color' },
  'delight': { combinesWith: ['bolder', 'animate'], flow: 'Enhancement: Add personality' },
  'extract': { flow: 'System: Create design system elements' },
  'adapt': { combinesWith: ['normalize', 'clarify'], flow: 'Adaptation: Different devices/contexts' },
  'onboard': { flow: 'System: Onboarding & empty states' }
};

