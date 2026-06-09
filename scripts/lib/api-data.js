import path from 'path';
import fs from 'fs';

/**
 * Generate static API data for Cloudflare Pages deployment.
 * Pre-builds all API responses as JSON files so they can be served
 * as static assets via _redirects rewrites (no function invocations needed).
 *
 * Shared by the production build (scripts/build.js, writing into site/public/)
 * and the dev prebuild (scripts/gen-dev-api.mjs) so `bun run dev` serves the
 * same payloads `app.js` fetches in production. `outDir` is the directory that
 * gets a `_data/api/` tree; `rootDir` is the repo root.
 */
export function generateApiData(outDir, skills, patterns, rootDir) {
  const apiDir = path.join(outDir, '_data', 'api');
  fs.mkdirSync(apiDir, { recursive: true });

  // skills.json
  const skillsData = skills.map(s => ({
    id: path.basename(path.dirname(s.filePath)),
    name: s.name,
    description: s.description,
    userInvocable: s.userInvocable,
  }));
  fs.writeFileSync(path.join(apiDir, 'skills.json'), JSON.stringify(skillsData));

  // commands.json - after v3.0 consolidation, commands are sub-commands of
  // /impeccable. Load them from command-metadata.json and include the root
  // impeccable skill itself so UI surfaces like the cheatsheet can list them.
  // Each entry also picks up a short `tagline` from its editorial file
  // (site/content/skills/<id>.md) when one exists. Taglines are used by UI
  // surfaces that need a human-friendly one-liner, while `description` stays
  // optimized for auto-trigger keyword matching in the AI harness.
  const readTagline = (id) => {
    const editorialPath = path.join(rootDir, 'site/content/skills', `${id}.md`);
    if (!fs.existsSync(editorialPath)) return null;
    const raw = fs.readFileSync(editorialPath, 'utf-8');
    const match = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    const taglineMatch = match[1].match(/tagline:\s*"([^"]+)"/);
    return taglineMatch ? taglineMatch[1] : null;
  };

  const metadataPath = path.join(rootDir, 'skill/scripts/command-metadata.json');
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`command-metadata.json is missing at ${metadataPath}. This file is required to generate the commands API.`);
  }
  const impeccable = skills.find(s => s.name === 'impeccable');
  if (!impeccable) {
    throw new Error('impeccable skill not found at skill/SKILL.src.md. The build system expects exactly one skill at that path.');
  }

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  const commandsData = [
    {
      id: 'impeccable',
      name: 'impeccable',
      description: impeccable.description,
      tagline: readTagline('impeccable'),
      userInvocable: true,
    },
    ...Object.entries(metadata).map(([id, meta]) => ({
      id,
      name: id,
      description: meta.description,
      tagline: readTagline(id),
      userInvocable: true,
    })),
  ];
  fs.writeFileSync(path.join(apiDir, 'commands.json'), JSON.stringify(commandsData));

  // patterns.json
  fs.writeFileSync(path.join(apiDir, 'patterns.json'), JSON.stringify(patterns));

  // version.json - a tiny endpoint the installed skill polls on boot
  // (skill/scripts/context.mjs) to nudge users toward `npx impeccable skills
  // update`. Kept deliberately small so the boot-time check is cheap, unlike
  // the full bundle download `skills check` performs. The skills version is
  // the canonical one in the Claude plugin manifest.
  const pluginManifestPath = path.join(rootDir, '.claude-plugin/plugin.json');
  const skillsVersion = JSON.parse(fs.readFileSync(pluginManifestPath, 'utf-8')).version;
  fs.writeFileSync(path.join(apiDir, 'version.json'), JSON.stringify({ skills: skillsVersion }));

  // command-source/{id}.json (one per skill)
  const cmdSourceDir = path.join(apiDir, 'command-source');
  fs.mkdirSync(cmdSourceDir, { recursive: true });
  for (const skill of skills) {
    const id = path.basename(path.dirname(skill.filePath));
    const content = fs.readFileSync(skill.filePath, 'utf-8');
    fs.writeFileSync(
      path.join(cmdSourceDir, `${id}.json`),
      JSON.stringify({ content })
    );
  }

  const skillWord = skillsData.length === 1 ? 'skill' : 'skills';
  console.log(`✓ Generated static API data (${skillsData.length} ${skillWord}, ${commandsData.length} commands)`);
}
