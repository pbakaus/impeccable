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

The MCP server is a bridge to the real Impeccable skill entrypoint. It does not install local skill folders or run provider-native hooks inside the client.

When a client does not choose the connector automatically, invoke it explicitly as `@Impeccable` and ask it to call:

1. `impeccable_start` with the UI/design request and target
2. `fetch` for the returned command/register references when the client supports it
3. `impeccable_workflow` for the routed command
4. `impeccable_detect_markup` when markup or style text is available
5. `impeccable_checkpoint` with `before_final` when native Impeccable hooks are unavailable
