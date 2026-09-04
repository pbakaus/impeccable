# Platform packages

Templates for the `@impeccable/cli-<os>-<arch>` packages the `impeccable` npm
shim (`cli/bin/cli.js`) declares as `optionalDependencies`. npm installs only
the one matching the host (`os` / `cpu` fields), and the shim resolves
`<package>/bin/impeccable[.exe]` from it before falling back to the user cache
or a download.

They are **published from the engine release**, not built here: `bun run
release:platform-packages` (`scripts/publish-platform-packages.mjs`) copies each template, sets `version` to the engine version, drops the
built binary at `bin/impeccable[.exe]` (executable), and publishes it under
`@impeccable`. The version pinned in this repo's `package.json`
`optionalDependencies` must equal `ENGINE_VERSION`.

Targets: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `windows-x64`.
