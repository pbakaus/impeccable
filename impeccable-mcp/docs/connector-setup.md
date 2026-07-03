# Connector Setup

Connect any compatible remote MCP client to:

```text
https://<railway-domain>/mcp
```

If a connector UI strips the path or sends MCP requests to the origin, the hosted server also accepts MCP `POST` requests at:

```text
https://<railway-domain>
```

If `IMPECCABLE_MCP_KEYS` is configured, send:

```text
x-impeccable-mcp-key: <key>
```

Start with read tools only. The MVP does not expose write tools and does not edit client workspace files.

When a client does not choose the connector automatically, invoke it explicitly as `@Impeccable` and ask it to call:

1. `impeccable_workflow`
2. `impeccable_checkpoint`
3. `impeccable_detect_markup` when markup or style text is available
4. `impeccable_checkpoint` with `before_final`
