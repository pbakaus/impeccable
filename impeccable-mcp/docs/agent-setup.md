# Agent Setup Playbook

Use this playbook when a user asks an agent to set up the Impeccable MCP bridge for them. The bridge is for MCP clients that cannot directly install or run the local Impeccable skill folder.

## Non-Negotiables

- Deploy from the Impeccable repo root, not from `impeccable-mcp/` alone.
- Keep the MCP bridge read-only. Do not add workspace write tools during setup.
- Generate a new server key for each hosted deployment.
- Do not commit, print, or store generated keys in docs, examples, logs, or memory.
- Treat `skill/SKILL.src.md`, `skill/reference/*.md`, `skill/scripts/command-metadata.json`, `docs/HARNESSES.md`, and `cli/engine/detect-antipatterns.mjs` as the source of truth.

## Required Inputs

Collect or infer these before mutating external services:

- Hosting target, for example Railway, Fly, Render, or another HTTPS host.
- Git repo and branch to deploy.
- MCP client surface and whether it supports custom headers or bearer auth.
- Whether the user wants an open test deployment or a keyed deployment.

If the user does not specify a host and Railway is available, Railway is the shortest supported path because `railway.json` is included at the repo root.

## Setup Steps

1. Confirm repo shape:

   ```bash
   test -f skill/SKILL.src.md
   test -f impeccable-mcp/package.json
   test -f railway.json
   ```

2. Verify locally before deployment:

   ```bash
   cd impeccable-mcp
   npm ci
   npm run verify
   ```

3. Generate a deployment key:

   ```bash
   openssl rand -base64 32
   ```

4. Configure hosting from the repo root:

   ```text
   Build command: cd impeccable-mcp && npm ci && npm run build
   Start command: cd impeccable-mcp && npm start
   Healthcheck path: /health
   ```

5. Set environment variables:

   ```text
   NODE_ENV=production
   IMPECCABLE_MCP_KEYS=<generated key>
   ```

   Use `IMPECCABLE_SOURCE_ROOT=/app` only if deployed source-root discovery fails.

6. Connect the MCP client to:

   ```text
   https://<deployment-domain>/mcp
   ```

7. Configure one auth header:

   ```text
   x-impeccable-mcp-key: <generated key>
   ```

   Or, if the client has a bearer-token field:

   ```text
   Authorization: Bearer <generated key>
   ```

8. Verify the hosted server:

   ```bash
   curl -fsS https://<deployment-domain>/health
   ```

   Then verify the MCP endpoint with a remote MCP client or inspector using the configured auth header.

## Expected MCP Usage

Tell the consuming agent to start with `impeccable_start`. A correct client flow is:

1. `impeccable_start` with the UI/design request and target.
2. `fetch` for the returned command and register references when supported.
3. `impeccable_workflow` for the routed command.
4. `impeccable_detect_markup` when markup or style text is available.
5. `impeccable_checkpoint` with `before_final` before declaring work complete when native Impeccable hooks are unavailable.

## Troubleshooting

- `401 missing_or_invalid_impeccable_mcp_key`: the client did not send a configured key. Check the header name and value.
- `/health` works but MCP calls fail: verify the client is connecting to `/mcp` and sending the auth header on MCP requests.
- Source files are missing at runtime: redeploy from the repo root or set `IMPECCABLE_SOURCE_ROOT` to the deployed repo root.
- The client ignores the connector: invoke it explicitly by name and ask it to call `impeccable_start` first.
- Native hooks are unavailable: use `impeccable_detect_markup` and `impeccable_checkpoint` as explicit bridge calls. Do not claim provider-native hooks are installed.
