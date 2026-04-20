# MCP Protocol Tests

This directory contains tests for verifying the MCP (Model Context Protocol) server implementation.

## test-mcp.ts

Comprehensive test suite that validates:
- MCP server connectivity over SSE (Server-Sent Events)
- Tool listing and metadata
- Tool invocation with proper return format
- Widget resource configuration
- MIME types and ChatGPT compatibility

## Running Tests

### Against Local Server

```bash
# Start local servers first
cd pizzaz_server_node && pnpm start  # Terminal 1
pnpm -w run serve                     # Terminal 2

# Run tests
pnpm exec tsx tests/test-mcp.ts
```

### Against Production/Dev Environment

```bash
# Test against your tunneled endpoint
MCP_URL=https://pizzaz.lazzloe.com/mcp pnpm exec tsx tests/test-mcp.ts
```

### Using Environment Variables

The test automatically discovers the MCP URL in this order:

1. `MCP_URL` - Full MCP endpoint URL
2. `MCP_TUNNEL_ID` - Cloudflare tunnel ID (constructs URL)
3. `ASSETS_TUNNEL_ID` - Falls back to asset tunnel
4. Default: `http://localhost:8000/mcp`

## Test Output

Successful test output:
```
🔍 Discovering MCP URL...
MCP Endpoint: https://pizzaz.lazzloe.com/mcp

🔌 Connecting to MCP server...
✅ Connected to MCP server

✓ Testing list tools...
  ✅ All 5 tools present with correct metadata
✓ Testing tool invocation...
  ✅ Tool invocation successful with correct metadata
✓ Testing widget resource...
  ✅ Widget resource has correct MIME type and metadata
✓ Testing list resources...
  ✅ All 5 resources properly configured

============================================================
🎉 All MCP protocol tests passed!
```

## What the Tests Verify

1. **SSE Connection**: Ensures the server properly handles Server-Sent Events
2. **Tool Metadata**: Validates OpenAI-specific metadata fields:
   - `openai/outputTemplate`
   - `openai/toolInvocation/invoking`
   - `openai/toolInvocation/invoked`
   - `openai/widgetAccessible`
   - `openai/resultCanProduceWidget`
3. **Tool Invocation**: Confirms tools return `structuredContent` for widget rendering
4. **Resource Configuration**: Verifies widget resources use `text/html+skybridge` MIME type
5. **ChatGPT Compatibility**: Ensures all requirements for ChatGPT Apps integration

## Troubleshooting

**Error: SSE error**
- Check that the MCP server is running
- Verify the URL is accessible (try with curl)
- For tunneled endpoints, ensure firewall allows HTTPS traffic

**Error: Tool invocation missing structuredContent**
- Update pizzaz_server_node/src/server.ts to return `structuredContent`
- Rebuild and restart the server

**Connection timeout**
- Increase timeout in test file if testing slow connections
- Check SSH tunnel is active: `ps aux | grep ssh`
