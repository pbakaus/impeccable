# VS Code skill distribution

The VS Code extension is a declarative delivery channel for the GitHub Copilot skill. `bun run build` stages `dist/vscode/` from the GitHub provider output; `bun run package:vscode` builds and packages a VSIX with pinned `@vscode/vsce` tooling. Nothing is published by either command.

The package version follows `.claude-plugin/plugin.json`. Do not independently bump it for feature work. The Marketplace identifier is `renaissance-geek.impeccable`, under the registered Renaissance Geek publisher. Initial extension publication is a separate maintainer step; publisher registration alone does not publish the extension.

## Scope

- Register `skills/impeccable/SKILL.md` through `contributes.chatSkills`.
- Include its references, inline role fallbacks, launchers, and pinned engine version. Do not bundle engine binaries.
- Resolve launcher paths from the loaded skill, not `.github/skills` in the workspace. Preserve the project's working directory.
- No extension entrypoint, activation events, automatic hooks, custom-agent registrations, settings mutations, or workspace copying.
- Marketplace updates own the bundled files. No separate extension update command.

VS Code 1.109 introduced the contribution point; 1.109.3 added skill slash commands. The manifest therefore requires `^1.109.3`. Register the **SKILL.md file**, not the containing folder; early release-note examples used the folder form. Supporting files remain adjacent and are referenced by relative Markdown links.

Sources: [release notes](https://code.visualstudio.com/updates/v1_109), [contribution-point reference](https://code.visualstudio.com/api/references/contribution-points#contributes.chatSkills), [supporting-file clarification](https://github.com/microsoft/vscode/issues/304721#issuecomment-4152956892).

## Validation

`node --test tests/vscode-extension.test.mjs` checks the generated manifest, linked resources, launcher relocation (including spaces and project cwd), lack of repo-install sidecars, and deterministic rebuilding. The core suite includes these checks. CI also runs `vsce package` on the staged directory.

Before publishing, install the VSIX into a separate VS Code profile and extensions directory:

```sh
code --user-data-dir /absolute/path/to/test-profile \
  --extensions-dir /absolute/path/to/test-extensions \
  --install-extension dist/vscode/impeccable-<version>.vsix
code --user-data-dir /absolute/path/to/test-profile \
  --extensions-dir /absolute/path/to/test-extensions \
  /absolute/path/to/synthetic-project
```

Use an otherwise skill-free fixture with PRODUCT.md, DESIGN.md, and a small HTML file. Disable discovery of user-level Impeccable copies in that test profile to avoid testing the wrong installation. Sign into Copilot without enabling Settings Sync.

Check that `/impeccable` is discoverable, the loaded SKILL.md is inside the installed extension, a command-specific reference resolves there, and the launcher runs with cwd at the fixture. Record any requested command approvals. Also check that installation itself created no `.github/` directory or instructions file in the fixture. A launcher subprocess test alone is not a Copilot behavior test.

Test the oldest supported editor as well as current stable before publication. Windows and remote workspaces need separate smoke checks; do not infer them from a macOS local run. Plain browser-only VS Code cannot run the native launcher.

Initial macOS packaging checks: the VSIX installs in VS Code 1.109.3 (which resolves Copilot Chat 0.37.9) and 1.136.1. The installed launcher loads the synthetic project's context correctly. The older editor has only been install-tested, not behavior-tested.

### Recorded Copilot smoke (September 7, 2026)

VS Code 1.136.1, Copilot Chat 0.64.1, Auto routed to GPT-5.6 Luna. A single read-only `/impeccable polish index.html` compatibility request passed:

- `/impeccable` appeared in the slash picker after reloading the window following initial folder trust. Before that reload, the extension was installed but absent from the skill list.
- Copilot invoked the quoted absolute `skills/impeccable/scripts/impeccable` path inside the installed extension, with `context --target index.html`. One command approval was granted; default permission settings remained unchanged.
- The loader resolved the synthetic project root and its PRODUCT.md and DESIGN.md. Copilot then read `reference/polish.md` from the same extension, followed by the three fixture files.
- The completed report correctly described the fixture. The project still contained only its original three files, with unchanged contents. No workspace skill copy, server, or image-generation call was created.

This is one packaging/path-resolution smoke, not an activation-reliability or design-quality evaluation. It does not establish Windows, remote-host, or minimum-version behavior.
