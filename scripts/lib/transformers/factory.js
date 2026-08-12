import path from 'path';
import {
  cleanDir,
  ensureDir,
  writeFile,
  generateYamlFrontmatter,
  generateYamlDocument,
  replacePlaceholders,
  replaceScriptProviderMarker,
  compileProviderBlocks,
  stripRuleMarkers,
} from '../utils.js';
import { SKILL_CATEGORIES, CATEGORY_ORDER } from '../skill-categories.js';
import { hooksJsonFor } from './hooks.js';

// Preamble prepended to every generated degraded-mode fallback reference file.
// These files are single-sourced from skill/agents/ so a harness with no
// subagent capability runs each role inline from the same specialized text.
const DEGRADED_PREAMBLE = `<!-- Generated from skill/agents/ at build time. Do not edit; edit the agent definition. -->
This harness has no subagent capability, so you are running this role inline. Step fully out of the work you just finished, adopt only this file's instructions for the pass, and disclose the substitution in one line when you report. Where the text below addresses a parent agent, you are both parties: produce the full output contract first, then act on it yourself.`;

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

// GitHub Copilot custom agents are markdown files named `<name>.agent.md`
// (project scope: `.github/agents/`; user scope: `~/.copilot/agents/`). Only
// the portable frontmatter fields are emitted: `name` and `description`.
// `tools` is omitted deliberately -- omitting it grants access to all tools,
// and Copilot's tool vocabulary differs from ours -- and Copilot has no
// documented model/effort/max-turns equivalents. VS Code-specific fields
// (handoffs, argument-hint) are ignored elsewhere, so none are emitted.
function buildCopilotAgent(agent, body) {
  const frontmatter = {
    name: agent.name,
    description: agent.description,
  };

  return `${generateYamlFrontmatter(frontmatter)}\n${body.trim()}\n`;
}

// Cursor subagents are plain markdown files with YAML frontmatter (project
// scope: `.cursor/agents/`; user scope: `~/.cursor/agents/`). Fields: name,
// description (drives auto-delegation), model (`inherit` maps directly to our
// value), readonly, is_background. `readonly` is derived from the agent's own
// tool list: a role that declares tools but neither Write nor Edit is a
// reader, and Cursor can enforce that. effort/max-turns are skipped: Cursor's
// effort option requires an explicit model id, incompatible with `inherit`.
function buildCursorAgent(agent, body) {
  const frontmatter = {
    name: agent.name,
    description: agent.description,
    model: agent.model || 'inherit',
  };

  const tools = String(agent.tools || '').split(',').map(t => t.trim()).filter(Boolean);
  if (tools.length > 0 && !tools.includes('Write') && !tools.includes('Edit')) {
    frontmatter.readonly = true;
  }
  // The parent thread waits on each role's return; none of these run detached.
  frontmatter.is_background = false;

  return `${generateYamlFrontmatter(frontmatter)}\n${body.trim()}\n`;
}

/**
 * Render an agent's markdown body for one provider.
 *
 * Every surface that ships an agent body (the degraded fallback reference, the
 * Codex .toml nested inside the skill, and the native agent file) goes through
 * here, so all three resolve provider blocks, {{placeholders}}, rule markers,
 * and {{scripts_path}} the same way. The nested Codex .toml used to skip the
 * last two and shipped `node {{scripts_path}}/embed-prompt.mjs` literally.
 */
function renderAgentBody(agent, { providerTags, placeholderKey, allSkillNames, scriptsPath }) {
  let body = compileProviderBlocks(agent.body, providerTags);
  body = replacePlaceholders(body, placeholderKey, [], allSkillNames);
  body = stripRuleMarkers(body);
  return body.replace(/\{\{scripts_path\}\}/g, scriptsPath);
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

  if (config.agentFormat === 'copilot-agent-md') {
    return {
      filename: `${agent.name}.agent.md`,
      content: buildCopilotAgent(agent, body),
    };
  }

  if (config.agentFormat === 'cursor-md') {
    return {
      filename: `${agent.name}.md`,
      content: buildCursorAgent(agent, body),
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

      // Generate degraded-mode fallback reference files from the shipped
      // subagent definitions. Single-sourced from skill/agents/ so a harness
      // with no subagent capability runs each role inline from the same
      // specialized text. Role name = agent name minus the `impeccable-`
      // prefix. These pass through the same provider-block compilation and
      // placeholder replacement as ordinary reference files, so <codex> blocks
      // and {{placeholders}} resolve identically.
      if (skill.agents && skill.agents.length > 0) {
        const degradedDir = path.join(skillDir, 'reference', 'degraded');
        ensureDir(degradedDir);
        for (const agent of skill.agents) {
          const role = agent.name.replace(/^impeccable-/, '');
          const body = renderAgentBody(agent, { providerTags, placeholderKey, allSkillNames, scriptsPath });
          const content = `${DEGRADED_PREAMBLE}\n\n${body.replace(/^\s+/, '')}`;
          writeFile(path.join(degradedDir, `${role}.md`), content);
          refCount++;
        }
      }

      // Copy script files
      if (skill.scripts && skill.scripts.length > 0) {
        const scriptsOutDir = path.join(skillDir, 'scripts');
        ensureDir(scriptsOutDir);
        for (const script of skill.scripts) {
          const scriptContent = replaceScriptProviderMarker(script.content, placeholderKey, provider);
          writeFile(path.join(scriptsOutDir, script.name), scriptContent);
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
          const agentBody = renderAgentBody(agent, { providerTags, placeholderKey, allSkillNames, scriptsPath });
          const filename = `${agent.codexName || agent.name.replace(/-/g, '_')}.toml`;
          ensureDir(path.join(skillDir, 'agents'));
          writeFile(path.join(skillDir, 'agents', filename), buildCodexAgent(agent, agentBody));
        }
      }
    }

    // Ship an explicit slash-command surface for OpenCode. OpenCode registers
    // skill commands natively but its TUI autocomplete hides them by deliberate
    // design (anomalyco/opencode#25439); this file also pins execution policy
    // (agent: build, subtask: true) and routes through OpenCode's skill tool,
    // which resolves the skill base dir for any install scope. Menu visibility
    // is the only part contingent on OpenCode's design; the rest is intentional.
    // Schema restricted to what OpenCode recognises (description, agent, model,
    // variant, subtask).
    if (provider === 'opencode' && skills.length > 0) {
      const commandsDir = path.join(providerDir, `${configDir}/commands`);
      ensureDir(commandsDir);
      for (const skill of skills) {
        const bridgeBody = `Call skill({ name: "${skill.name}" }) and follow its \`Setup\` and \`Commands\` sections to handle $ARGUMENTS.\n`;
        const bridgeFrontmatter = generateYamlFrontmatter({
          description: skill.description,
          agent: 'build',
          subtask: true,
        });
        writeFile(path.join(commandsDir, `${skill.name}.md`), `${bridgeFrontmatter}\n${bridgeBody}`.replace(/\n+$/, '\n'));
      }
    }

    if (config.agentFormat) {
      const agentsDir = path.join(providerDir, `${configDir}/agents`);
      for (const skill of skills) {
        const scriptsPath = `${configDir}/skills/${skill.name}/scripts`;
        for (const agent of skill.agents || []) {
          // Agents can declare `providers: <list>` to limit which harnesses
          // they emit to. Default (no field) ships everywhere with agentFormat.
          if (agent.providers && !agent.providers.includes(provider)) continue;
          const body = renderAgentBody(agent, { providerTags, placeholderKey, allSkillNames, scriptsPath });
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
      const manifest = hooksJsonFor(config.emitHooks, { configDir });
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
