export function buildCodexPluginManifest(rootManifest) {
  return {
    name: rootManifest.name,
    version: rootManifest.version,
    description: 'Design and refine frontend interfaces with coding agents.',
    author: {
      name: 'Renaissance Geek Inc',
      url: rootManifest.homepage,
    },
    homepage: rootManifest.homepage,
    repository: rootManifest.repository,
    license: 'Apache-2.0',
    keywords: [
      'design',
      'frontend',
      'ui',
      'ux',
      'accessibility',
      'anti-patterns',
    ],
    skills: './skills/',
    interface: {
      displayName: 'Impeccable',
      shortDescription: 'Design and refine interfaces',
      longDescription: 'Create, critique, and refine frontend interfaces with your coding agent. Impeccable provides 23 focused design commands, live browser iteration for exploring visual directions, and automatic checks that flag common design anti-patterns as you work.',
      developerName: 'Renaissance Geek Inc',
      category: 'Creativity',
      capabilities: ['Interactive', 'Read', 'Write'],
      websiteURL: rootManifest.homepage,
      privacyPolicyURL: `${rootManifest.homepage}/privacy`,
      termsOfServiceURL: `${rootManifest.repository}/blob/main/LICENSE`,
      defaultPrompt: [
        'critique this interface and prioritize what to fix.',
        'craft a distinctive landing page, then polish the result.',
        'start impeccable live so I can explore bolder or more delightful variants.',
      ],
      brandColor: '#E2AE38',
      composerIcon: './assets/icon.png',
      logo: './assets/icon.png',
      screenshots: [],
    },
  };
}
