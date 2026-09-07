# Impeccable for Cursor

Design and refine interfaces with Impeccable: one skill, specialist agents, and a pre-edit design check. Invoke `/impeccable polish`, `/impeccable audit`, or describe the design work you want.

## Installation

This native Cursor plugin is being prepared for marketplace review; it is not yet a published listing. For the existing project install, run:

```sh
npx impeccable install --providers=cursor --scope=project
```

Use either that installation or the plugin, not both, to avoid duplicate skills and hooks. The plugin does not copy files into your project's `.cursor` directory. Its launcher downloads the pinned Impeccable engine on first use if it is not already cached; no Node runtime is needed for the plugin itself. Agent and shell permissions remain controlled by Cursor. Optional image generation requires its own provider credentials and approval.

## Local plugin preview

From the Impeccable repository, run `bun run build`, then copy `dist/cursor-plugin` into `~/.cursor/plugins/local/impeccable`. Do not overwrite an existing installation. Cursor 3.15.6 rejects symlinks whose targets are outside its local-plugin directory, so use a real copy. Reload Cursor, then inspect Customize for the skill and four agents, and Hooks for `preToolUse` execution. A marketplace installation with the same name takes precedence over a local preview. Local plugins are user-wide, even when testing with a separate editor profile; remove the temporary copy when finished.

Use a synthetic project outside the plugin directory to test context resolution. The documented `workspaceOpen`/`pluginPaths` alternative did not execute reliably during the 3.15.6 smoke test; it is not the verified preview path.

The pre-edit hook uses Cursor's existing POSIX launcher integration. Windows shell behavior and remote environments require separate verification before advertising support for this plugin's hook.

## Verification status

Automated checks cover real Cursor-provider packaging, reference links, four agent files, executable permissions, version drift, and hook relocation into a path containing spaces. A direct staged-launcher invocation correctly loaded context from a separate synthetic project. Full non-billed regression tests and source-first/release builds passed.

On macOS with Cursor 3.15.6, the local plugin loaded with zero parser failures and exposed one skill plus four agents. A real `/impeccable` request ran the installed launcher once against the synthetic project and read the installed polish reference, without editing project files. Native `preToolUse` logs confirmed execution from the installed plugin with valid responses. Installing alongside a separate user skill produces duplicate slash-menu entries; choose one installation method.

A native `impeccable-asset-producer` handoff resolved the supplied skill scripts path and confirmed the launcher exists, without generating assets. A separate one-attribute fixture edit exercised `preToolUse` on Cursor's native `Write` tool: the installed hook exited 0 and returned valid JSON. The fixture was restored and the temporary local plugin removed afterward. Windows and remote runtime checks remain outstanding.

## Maintainer submission checklist

- Public repository: https://github.com/pbakaus/impeccable
- Marketplace manifest: `.cursor-plugin/marketplace.json`; plugin source: `cursor-plugin/`.
- Native manifest, skill, agents, hook, logo, and license are generated from source by `bun run build:release` and kept current by the generated-output workflow. Do not hand-edit `cursor-plugin/`.
- Verify `/impeccable` discovery, an installed-path context invocation, agent discovery and handoff paths, and a real pre-edit hook event in Cursor.
- After merge and verification, submit the repository at https://cursor.com/marketplace/publish. Submission and publication require maintainer approval. Replace this preparation notice and add the actual listing link only after acceptance.

References: [Cursor plugins](https://cursor.com/docs/plugins), [plugin reference](https://cursor.com/docs/reference/plugins), [hooks](https://cursor.com/docs/hooks).
