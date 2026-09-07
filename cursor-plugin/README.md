# Impeccable for Cursor

Design and refine interfaces with Impeccable: one skill, specialist agents, and a pre-edit design check. Invoke `/impeccable polish`, `/impeccable audit`, or describe the design work you want.

## Installation

This native Cursor plugin is being prepared for marketplace review; it is not yet a published listing. For the existing project install, run:

```sh
npx impeccable install --providers=cursor --scope=project
```

Use either that installation or the plugin, not both, to avoid duplicate skills and hooks. The plugin does not copy files into your project's `.cursor` directory. Its launcher downloads the pinned Impeccable engine on first use if it is not already cached; no Node runtime is needed for the plugin itself. Agent and shell permissions remain controlled by Cursor. Optional image generation requires its own provider credentials and approval.

## Local plugin preview

From the Impeccable repository, run `bun run build`. Cursor's documented local-plugin loader accepts a copy or symlink of `dist/cursor-plugin` under `~/.cursor/plugins/local/impeccable`. Reload Cursor, then inspect Customize for the skill, four agents, and `preToolUse` hook. Do not overwrite an existing installation. A marketplace installation with the same name takes precedence over a local preview.

For an isolated project smoke test, a project-scoped `workspaceOpen` hook can return `pluginPaths` containing the absolute staging-directory path. This avoids installing a user-wide plugin. Test the context launcher from a synthetic project outside the plugin directory and inspect hook execution in Cursor's Hooks output.

The pre-edit hook uses Cursor's existing POSIX launcher integration. Windows shell behavior and remote environments require separate verification before advertising support for this plugin's hook.

## Verification status

Automated checks cover real Cursor-provider packaging, reference links, four agent files, executable permissions, version drift, and hook relocation into a path containing spaces. A direct staged-launcher invocation correctly loaded context from a separate synthetic project. Full non-billed regression tests and source-first/release builds passed.

Live discovery, agent handoff, and hook dispatch inside Cursor remain pending. The isolated profile loaded the test project's `workspaceOpen` configuration, but UI automation could not reliably distinguish that window from the normal signed-in profile; the interactive check was paused rather than counted as a pass.

## Maintainer submission checklist

- Public repository: https://github.com/pbakaus/impeccable
- Marketplace manifest: `.cursor-plugin/marketplace.json`; plugin source: `cursor-plugin/`.
- Native manifest, skill, agents, hook, logo, and license are generated from source by `bun run build:release` and kept current by the generated-output workflow. Do not hand-edit `cursor-plugin/`.
- Verify `/impeccable` discovery, an installed-path context invocation, agent discovery and handoff paths, and a real pre-edit hook event in Cursor.
- After merge and verification, submit the repository at https://cursor.com/marketplace/publish. Submission and publication require maintainer approval. Replace this preparation notice and add the actual listing link only after acceptance.

References: [Cursor plugins](https://cursor.com/docs/plugins), [plugin reference](https://cursor.com/docs/reference/plugins), [hooks](https://cursor.com/docs/hooks).
