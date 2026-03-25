import path from 'path';
import { cleanDir, ensureDir, writeFile, generateYamlFrontmatter, replacePlaceholders, prefixSkillReferences, PROVIDER_PLACEHOLDERS } from '../utils.js';

/**
 * Map from frontmatter field name to extraction spec.
 *
 * - sourceKey: property name on the skill object
 * - yamlKey: key name in YAML frontmatter
 * - condition: if provided, field is only emitted when this returns true
 * - value: if provided, use this instead of skill[sourceKey]
 */
const FIELD_SPECS = {
  'user-invocable': {
    sourceKey: 'userInvocable',
    yamlKey: 'user-invocable',
    condition: (skill) => skill.userInvocable,
    value: () => true,
  },
  'argument-hint': {
    sourceKey: 'argumentHint',
    yamlKey: 'argument-hint',
    condition: (skill) => skill.userInvocable && skill.argumentHint,
  },
  license: {
    sourceKey: 'license',
    yamlKey: 'license',
  },
  compatibility: {
    sourceKey: 'compatibility',
    yamlKey: 'compatibility',
  },
  metadata: {
    sourceKey: 'metadata',
    yamlKey: 'metadata',
  },
  'allowed-tools': {
    sourceKey: 'allowedTools',
    yamlKey: 'allowed-tools',
  },
};

/**
 * Create a transformer function for a given provider config.
 *
 * @param {Object} config - Provider configuration from providers.js
 * @returns {Function} transform(skills, distDir, options?)
 */
export function createTransformer(config) {
  const { provider, configDir, displayName, frontmatterFields = [], bodyTransform, placeholderProvider } = config;
  const placeholderKey = placeholderProvider || provider;

  const activeFields = frontmatterFields
    .map((name) => FIELD_SPECS[name])
    .filter(Boolean);

  return function transform(skills, distDir, options = {}) {
    const { prefix = '', outputSuffix = '' } = options;
    const providerDir = path.join(distDir, `${provider}${outputSuffix}`);
    const skillsDir = path.join(providerDir, `${configDir}/skills`);

    cleanDir(providerDir);
    ensureDir(skillsDir);

    const allSkillNames = skills.map((s) => s.name);
    const commandNames = skills
      .filter((s) => s.userInvocable)
      .map((s) => `${prefix}${s.name}`);

    let refCount = 0;

    for (const skill of skills) {
      const skillName = `${prefix}${skill.name}`;
      const skillDir = path.join(skillsDir, skillName);

      // Build frontmatter
      const frontmatterObj = {
        name: skillName,
        description: skill.description,
      };

      for (const spec of activeFields) {
        if (spec.condition && !spec.condition(skill)) continue;
        const val = spec.value ? spec.value(skill) : skill[spec.sourceKey];
        if (val) frontmatterObj[spec.yamlKey] = val;
      }

      const frontmatter = generateYamlFrontmatter(frontmatterObj);

      // Build body
      const cmdPrefix = (PROVIDER_PLACEHOLDERS[placeholderKey] || {}).command_prefix || '/';
      let skillBody = replacePlaceholders(skill.body, placeholderKey, commandNames, allSkillNames);
      if (prefix) skillBody = prefixSkillReferences(skillBody, prefix, allSkillNames, cmdPrefix);
      if (bodyTransform) skillBody = bodyTransform(skillBody, skill);

      const content = `${frontmatter}\n\n${skillBody}`;
      writeFile(path.join(skillDir, 'SKILL.md'), content);

      // Copy reference files
      if (skill.references && skill.references.length > 0) {
        const refDir = path.join(skillDir, 'reference');
        ensureDir(refDir);
        for (const ref of skill.references) {
          const refContent = replacePlaceholders(ref.content, placeholderKey, [], allSkillNames);
          writeFile(path.join(refDir, `${ref.name}.md`), refContent);
          refCount++;
        }
      }
    }

    const userInvocableCount = skills.filter((s) => s.userInvocable).length;
    const refInfo = refCount > 0 ? ` (${refCount} reference files)` : '';
    const prefixInfo = prefix ? ` [${prefix}prefixed]` : '';
    console.log(`✓ ${displayName}${prefixInfo}: ${skills.length} skills (${userInvocableCount} user-invocable)${refInfo}`);
  };
}
