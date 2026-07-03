# Railway Deploy

Create a new Railway project only after local verification is clean.

Expected project name:

```text
impeccable-mcp
```

Deployment settings:

- GitHub repo: the Impeccable repo or your fork
- Branch: the branch containing `impeccable-mcp/`
- Root directory: repo root
- Build command: `cd impeccable-mcp && npm ci && npm run build`
- Start command: `cd impeccable-mcp && npm start`
- Healthcheck path: `/health`

Variables:

```text
NODE_ENV=production
IMPECCABLE_MCP_KEYS=<generated secret>
```

Generate a key locally before setting the Railway variable:

```bash
openssl rand -base64 32
```

Use the generated value as either `x-impeccable-mcp-key` or `Authorization: Bearer <key>` in compatible MCP clients. To rotate keys, replace `IMPECCABLE_MCP_KEYS` and redeploy.

Optional:

```text
IMPECCABLE_SOURCE_ROOT=/app
```

Only set `IMPECCABLE_SOURCE_ROOT` if Railway's build layout prevents automatic source-root discovery.
Do not deploy only the `impeccable-mcp/` directory: the server reads source-backed Impeccable files from the repo root.

Verification:

```bash
curl -fsS https://<railway-domain>/health
```

Then verify `https://<railway-domain>/mcp` with an MCP inspector or a compatible remote MCP client.
