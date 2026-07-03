# Railway Deploy

Create a new Railway project only after local verification is clean.

Expected project name:

```text
impeccable-mcp
```

Deployment settings:

- GitHub repo: `MattMagg/impeccable`
- Branch: `feat/impeccable-mcp`
- Root directory: `impeccable-mcp`
- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Healthcheck path: `/health`

Variables:

```text
NODE_ENV=production
IMPECCABLE_MCP_KEYS=<generated secret>
```

Optional:

```text
IMPECCABLE_SOURCE_ROOT=/app
```

Only set `IMPECCABLE_SOURCE_ROOT` if Railway's build layout prevents automatic source-root discovery.

Verification:

```bash
curl -fsS https://<railway-domain>/health
```

Then verify `https://<railway-domain>/mcp` with an MCP inspector or a compatible remote MCP client.
