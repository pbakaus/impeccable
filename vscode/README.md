# Impeccable for GitHub Copilot

Design guidance and tools for building, critiquing, auditing, and refining interfaces with GitHub Copilot in VS Code.

## Use

Requires VS Code 1.109.3 or later, GitHub Copilot Chat access, and a trusted local checkout. Open Copilot Chat in Agent mode and try:

- `/impeccable polish` to refine the current interface.
- `/impeccable audit` to inspect accessibility and implementation quality.
- `/impeccable shape` to plan a new interface.

Copilot can also discover the skill automatically for relevant design requests. Supporting references load only when needed.

## What gets installed

This extension bundles the skill, references, and engine launchers. It has no extension runtime, activation events, telemetry code, update command, or automatic detector hooks. Installing it does not copy files into your project or edit `copilot-instructions.md`. Marketplace updates replace the bundled skill.

When Copilot invokes an engine command, the launcher uses an available engine or downloads its pinned version from Impeccable's GitHub releases into your user cache. Downloads are checksum-verified. The engine runs on your machine with Copilot's normal command approval controls; no Node.js installation is required. The first download needs network access. On Windows without a POSIX shell, use the `.cmd` launcher (in PowerShell, invoke a quoted path with `&`).

Commands you request may edit your project or launch local previews. This is not an editor diagnostics extension, and it does not block saves. Native custom-agent sidecars and automatic hooks from other installation methods are not registered by this skill-only package; the skill includes its inline role fallbacks.

Avoid installing another Impeccable skill copy in the same workspace or user profile: duplicate skill names can make selection ambiguous. Browser-only VS Code without a terminal is unsupported. Remote SSH, WSL, and container setups need the extension and engine on the workspace host and are not yet smoke-tested.

[Documentation](https://impeccable.style/docs) · [Source and issues](https://github.com/pbakaus/impeccable)
