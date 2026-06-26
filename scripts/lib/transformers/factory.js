import path from 'path';
import {
  cleanDir,
  ensureDir,
  writeFile,
  generateYamlFrontmatter,
  generateYamlDocument,
  replacePlaceholders,
  compileProviderBlocks,
  stripRuleMarkers,
} from '../utils.js';
import { SKILL_CATEGORIES, CATEGORY_ORDER } from '../sub-pages-data.js';
import { hooksJsonFor } from './hooks.js';

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

// Provider builds that Codex loads as a skill (it reads skills from .agents/skills,
// and the .codex build mirrors it). For these, the Codex subagent .toml travels
// INSIDE the skill's agents/ folder, which Codex auto-discovers once the skill is
// installed -- so no separate .codex/agents/ sidecar copy is needed.
const CODEX_SKILL_PROVIDERS = new Set(['agents', 'codex']);

function humanizeSkillName(name) {
  return name
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function summarizeDescription(description, maxLength = 88) {
  if (!description || description.length <= maxLength) return description;
  const clipped = description.slice(0, maxLength - 1);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > 48 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}...`;
}

function buildOpenAIMetadata(skill) {
  const displayName = humanizeSkillName(skill.name);
  return {
    interface: {
      display_name: displayName,
      short_description: summarizeDescription(skill.description),
      default_prompt: `Use ${displayName} to redesign, critique, audit, or polish this frontend.`,
    },
  };
}

function formatTomlString(value) {
  return JSON.stringify(String(value));
}

function formatTomlMultiline(value) {
  const normalized = String(value).trim().replace(/\r\n/g, '\n');
  if (!normalized.includes("'''")) {
    return `'''\n${normalized}\n'''`;
  }
  return `"""\n${normalized.replace(/\\/g, '\\\\').replace(/"""/g, '\\"""')}\n"""`;
}

function formatTomlArray(values) {
  return `[${values.map(formatTomlString).join(', ')}]`;
}

function buildCodexAgent(agent, body) {
  const lines = [
    `name = ${formatTomlString(agent.codexName || agent.name.replace(/-/g, '_'))}`,
    `description = ${formatTomlString(agent.description)}`,
  ];

  if (agent.effort) {
    lines.push(`model_reasoning_effort = ${formatTomlString(agent.effort)}`);
  }

  if (agent.nicknameCandidates?.length) {
    lines.push(`nickname_candidates = ${formatTomlArray(agent.nicknameCandidates)}`);
  }

  lines.push(`developer_instructions = ${formatTomlMultiline(body)}`);
  return `${lines.join('\n')}\n`;
}

function buildClaudeAgent(agent, body) {
  const frontmatter = {
    name: agent.claudeName || agent.name,
    description: agent.description,
  };

  if (agent.tools) frontmatter.tools = agent.tools;
  if (agent.model) frontmatter.model = agent.model;
  if (agent.effort) frontmatter.effort = agent.effort;
  if (agent.maxTurns) frontmatter.maxTurns = agent.maxTurns;

  return `${generateYamlFrontmatter(frontmatter)}\n${body.trim()}\n`;
}

function buildAgentFile(config, agent, body) {
  if (config.agentFormat === 'codex-toml') {
    return {
      filename: `${agent.codexName || agent.name.replace(/-/g, '_')}.toml`,
      content: buildCodexAgent(agent, body),
    };
  }

  if (config.agentFormat === 'claude-md') {
    return {
      filename: `${agent.claudeName || agent.name}.md`,
      content: buildClaudeAgent(agent, body),
    };
  }

  return null;
}

/**
 * Create a transformer function for a given provider config.
 *
 * @param {Object} config - Provider configuration from providers.js
 * @returns {Function} transform(skills, distDir, options?)
 */
export function createTransformer(config) {
  const {
    provider,
    configDir,
    displayName,
    frontmatterFields = [],
    bodyTransform,
    placeholderProvider,
    providerTags = [provider],
    writeOpenAIMetadata = false,
    includeVersion = true,
  } = config;
  const placeholderKey = placeholderProvider || provider;

  const activeFields = frontmatterFields
    .map((name) => FIELD_SPECS[name])
    .filter(Boolean);

  return function transform(skills, distDir, options = {}) {
    const { skillsVersion = '' } = options;
    const providerDir = path.join(distDir, provider);
    const skillsDir = path.join(providerDir, `${configDir}/skills`);

    cleanDir(providerDir);
    ensureDir(skillsDir);

    const allSkillNames = skills.map((s) => s.name);
    const commandNames = skills
      .filter((s) => s.userInvocable)
      .map((s) => s.name);

    let refCount = 0;
    let scriptCount = 0;
    let agentCount = 0;

    for (const skill of skills) {
      const skillName = skill.name;
      const skillDir = path.join(skillsDir, skillName);

      // Build frontmatter
      const frontmatterObj = {
        name: skillName,
        description: skill.description,
      };
      if (skillsVersion && includeVersion) frontmatterObj.version = skillsVersion;

      for (const spec of activeFields) {
        if (spec.condition && !spec.condition(skill)) continue;
        const val = spec.value ? spec.value(skill) : skill[spec.sourceKey];
        if (val) frontmatterObj[spec.yamlKey] = val;
      }

      // Replace {{command_hint}} in argument-hint with command names from metadata,
      // grouped by category with middle dots between groups for natural line-breaking.
      if (frontmatterObj['argument-hint']?.includes('{{command_hint}}')) {
        const metaScript = skill.scripts?.find(s => s.name === 'command-metadata.json');
        if (metaScript) {
          const commands = Object.keys(JSON.parse(metaScript.content));
          // Derive groups from SKILL_CATEGORIES, excluding the parent skill name
          const grouped = CATEGORY_ORDER
            .map(cat => commands.filter(c => SKILL_CATEGORIES[c] === cat).join('|'))
            .filter(Boolean)
            .join(' · ');
          frontmatterObj['argument-hint'] = frontmatterObj['argument-hint'].replace(
            '{{command_hint}}',
            grouped
          );
        }
      }

      const frontmatter = generateYamlFrontmatter(frontmatterObj);

      // Build body
      let skillBody = compileProviderBlocks(skill.body, providerTags);
      skillBody = replacePlaceholders(skillBody, placeholderKey, commandNames, allSkillNames);
      skillBody = stripRuleMarkers(skillBody);

      // Replace {{scripts_path}} with provider-aware path to skill's scripts directory
      const scriptsPath = `${configDir}/skills/${skillName}/scripts`;
      skillBody = skillBody.replace(/\{\{scripts_path\}\}/g, scriptsPath);
      if (bodyTransform) skillBody = bodyTransform(skillBody, skill);

      const content = `${frontmatter}\n\n${skillBody}`.replace(/\{\{scripts_path\}\}/g, scriptsPath);
      writeFile(path.join(skillDir, 'SKILL.md'), content);

      if (writeOpenAIMetadata) {
        const openaiMetadata = buildOpenAIMetadata(skill);
        writeFile(path.join(skillDir, 'agents', 'openai.yaml'), generateYamlDocument(openaiMetadata));
      }

      // Copy reference files
      if (skill.references && skill.references.length > 0) {
        const refDir = path.join(skillDir, 'reference');
        ensureDir(refDir);
        for (const ref of skill.references) {
          let refContent = compileProviderBlocks(ref.content, providerTags);
          refContent = replacePlaceholders(refContent, placeholderKey, [], allSkillNames);
          refContent = stripRuleMarkers(refContent);
          refContent = refContent.replace(/\{\{scripts_path\}\}/g, scriptsPath);
          writeFile(path.join(refDir, `${ref.name}.md`), refContent);
          refCount++;
        }
      }

      // Copy script files
      if (skill.scripts && skill.scripts.length > 0) {
        const scriptsOutDir = path.join(skillDir, 'scripts');
        ensureDir(scriptsOutDir);
        for (const script of skill.scripts) {
          writeFile(path.join(scriptsOutDir, script.name), script.content);
          scriptCount++;
        }
      }

      // Bundle the Codex subagent .toml inside the skill's agents/ folder for the
      // variants Codex loads as a skill. Codex auto-discovers agents nested in an
      // installed skill, so this in-skill copy is the whole delivery -- the
      // skills/ install carries it and no .codex/agents/ sidecar copy is required.
      if (CODEX_SKILL_PROVIDERS.has(provider)) {
        for (const agent of skill.agents || []) {
          if (agent.providers && !agent.providers.includes('codex')) continue;
          let agentBody = compileProviderBlocks(agent.body, providerTags);
          agentBody = replacePlaceholders(agentBody, placeholderKey, [], allSkillNames);
          const filename = `${agent.codexName || agent.name.replace(/-/g, '_')}.toml`;
          ensureDir(path.join(skillDir, 'agents'));
          writeFile(path.join(skillDir, 'agents', filename), buildCodexAgent(agent, agentBody));
        }
      }
    }

    if (config.agentFormat) {
      const agentsDir = path.join(providerDir, `${configDir}/agents`);
      for (const skill of skills) {
        for (const agent of skill.agents || []) {
          // Agents can declare `providers: <list>` to limit which harnesses
          // they emit to. Default (no field) ships everywhere with agentFormat.
          if (agent.providers && !agent.providers.includes(provider)) continue;
          let body = compileProviderBlocks(agent.body, providerTags);
          body = replacePlaceholders(body, placeholderKey, [], allSkillNames);
          const agentFile = buildAgentFile(config, agent, body);
          if (!agentFile) continue;
          ensureDir(agentsDir);
          writeFile(path.join(agentsDir, agentFile.filename), agentFile.content);
          agentCount++;
        }
      }
    }

    // Emit the provider hook manifest when the provider opts in.
    // Claude Code uses `.claude/settings.json`, Codex uses project-local
    // `.codex/hooks.json`, and Cursor uses `.cursor/hooks.json`.
    let hooksEmitted = false;
    if (config.emitHooks) {
      const manifest = hooksJsonFor(config.emitHooks);
      if (manifest) {
        const hooksRel = config.hooksManifestRel || path.join('hooks', 'hooks.json');
        writeFile(path.join(providerDir, configDir, hooksRel), JSON.stringify(manifest, null, 2) + '\n');
        hooksEmitted = true;
      }
    }

    const skillWord = skills.length === 1 ? 'skill' : 'skills';
    const refInfo = refCount > 0 ? ` (${refCount} reference files)` : '';
    const scriptInfo = scriptCount > 0 ? ` (${scriptCount} script files)` : '';
    const agentInfo = agentCount > 0 ? ` (${agentCount} agent files)` : '';
    const hooksInfo = hooksEmitted
      ? ` (${config.hooksManifestRel || path.join('hooks', 'hooks.json')})`
      : '';
    console.log(`✓ ${displayName}: ${skills.length} ${skillWord}${refInfo}${scriptInfo}${agentInfo}${hooksInfo}`);
  };
}
