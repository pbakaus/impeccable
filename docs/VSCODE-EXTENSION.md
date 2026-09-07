# VS Code skill distribution

The VS Code extension is a declarative delivery channel for the GitHub Copilot skill. `bun run build` stages `dist/vscode/` from the GitHub provider output; `bun run package:vscode` builds and packages a VSIX with pinned `@vscode/vsce` tooling. Nothing is published by either command.

Install [Impeccable from the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=renaissance-geek.impeccable), published by Renaissance Geek, or run `code --install-extension renaissance-geek.impeccable`. Requires VS Code 1.109.3+, Copilot Chat access, and a trusted local workspace. Use Chat in Agent mode, for example `/impeccable polish`. Avoid duplicate Impeccable skill installations in the same workspace/profile.

The package version follows `.claude-plugin/plugin.json`. Do not independently bump it for feature work. Publication and updates are separate maintainer steps; building or packaging does not publish.

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

Initial macOS packaging checks: the VSIX installs in VS Code 1.109.3 (which resolves Copilot Chat 0.37.9) and 1.136.1. Both editor versions also passed the read-only Copilot behavior smoke below.

### Recorded Copilot smoke (September 7, 2026)

VS Code 1.136.1, Copilot Chat 0.64.1, Auto routed to GPT-5.6 Luna. A single read-only `/impeccable polish index.html` compatibility request passed:

- `/impeccable` appeared in the slash picker after reloading the window following initial folder trust. Before that reload, the extension was installed but absent from the skill list.
- Copilot invoked the quoted absolute `skills/impeccable/scripts/impeccable` path inside the installed extension, with `context --target index.html`. One command approval was granted; default permission settings remained unchanged.
- The loader resolved the synthetic project root and its PRODUCT.md and DESIGN.md. Copilot then read `reference/polish.md` from the same extension, followed by the three fixture files.
- The completed report correctly described the fixture. The project still contained only its original three files, with unchanged contents. No workspace skill copy, server, or image-generation call was created.

The final `renaissance-geek.impeccable` 4.2.2 VSIX also passed the same read-only smoke in VS Code 1.109.3 / Copilot Chat 0.37.9 (Auto selected GPT-5.3-Codex): slash discovery, the installed launcher, project context, and the polish reference all resolved correctly. One scoped command approval was granted, and all three fixture files remained unchanged.

After publication, `code --install-extension renaissance-geek.impeccable` installed 4.2.2 into fresh isolated profile/extensions directories in VS Code 1.136.1. All 55 extension payload files matched the tested VSIX (ignoring VS Code's added `package.json` installation metadata). Its installed launcher loaded the same fixture context successfully; fixture hashes and file inventory stayed unchanged. This Marketplace check verified download/install and payload identity, not an additional Copilot conversation.

These are packaging/path-resolution smokes, not activation-reliability or design-quality evaluations. They do not establish Windows or remote-host behavior.
