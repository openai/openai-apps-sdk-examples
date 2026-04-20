#!/usr/bin/env tsx
/**
 * MCP Protocol Tests - Validates ChatGPT-compatible MCP implementation
 * Environment-agnostic: works in local dev (with tunnels) and CI/CD (with env vars)
 */

// Polyfill EventSource for Node.js
import { EventSource } from 'eventsource';
(global as any).EventSource = EventSource;

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

async function discoverMcpUrl(): Promise<string> {
  // Priority 1: Full MCP URL from environment (CI/CD, production, or dev override)
  if (process.env.MCP_URL) {
    return process.env.MCP_URL;
  }

  // Priority 2: Construct from Cloudflare tunnel ID (local dev)
  if (process.env.MCP_TUNNEL_ID) {
    return `https://${process.env.MCP_TUNNEL_ID}.cfargotunnel.com/mcp`;
  }

  throw new Error(
    'No MCP URL found. Please either:\n' +
    '  1. Run: ./scripts/setup-tunnels.sh (creates .env with tunnel IDs), or\n' +
    '  2. Set MCP_URL environment variable'
  );
}

async function main() {
  console.log('🔍 Discovering MCP URL...\n');

  const mcpEndpoint = await discoverMcpUrl();
  console.log(`MCP Endpoint: ${mcpEndpoint}\n`);

  console.log('🔌 Connecting to MCP server...');

  const transport = new SSEClientTransport(new URL(mcpEndpoint));
  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✅ Connected to MCP server\n');

  let errors = 0;

  // Test 1: List tools
  try {
    console.log('✓ Testing list tools...');
    const { tools } = await client.listTools();

    const expectedTools = ['pizza-map', 'pizza-carousel', 'pizza-albums', 'pizza-list', 'pizza-shop'];
    const foundTools = tools.map(t => t.name);

    if (tools.length !== expectedTools.length) {
      console.error(`  ❌ Expected ${expectedTools.length} tools, got ${tools.length}`);
      errors++;
    }

    for (const expected of expectedTools) {
      if (!foundTools.includes(expected)) {
        console.error(`  ❌ Missing tool: ${expected}`);
        errors++;
      }
    }

    // Validate critical metadata
    const sampleTool = tools[0];
    if (!sampleTool._meta || !sampleTool._meta['openai/outputTemplate']) {
      console.error('  ❌ Tool missing openai/outputTemplate metadata');
      errors++;
    }
    if (!sampleTool._meta['openai/widgetAccessible']) {
      console.error('  ❌ Tool missing openai/widgetAccessible metadata');
      errors++;
    }

    if (errors === 0) {
      console.log(`  ✅ All ${tools.length} tools present with correct metadata`);
    }
  } catch (error) {
    console.error(`  ❌ List tools failed: ${error}`);
    errors++;
  }

  // Test 2: Call a tool
  try {
    console.log('✓ Testing tool invocation...');
    const result = await client.callTool({
      name: 'pizza-map',
      arguments: { pizzaTopping: 'pepperoni' }
    });

    // Validate response structure
    if (!result.content || result.content.length === 0) {
      console.error('  ❌ Tool result missing content');
      errors++;
    }

    if (!result._meta) {
      console.error('  ❌ Tool result missing _meta');
      errors++;
    } else {
      if (!result._meta['openai/toolInvocation/invoking']) {
        console.error('  ❌ Missing openai/toolInvocation/invoking metadata');
        errors++;
      }
      if (!result._meta['openai/toolInvocation/invoked']) {
        console.error('  ❌ Missing openai/toolInvocation/invoked metadata');
        errors++;
      }
    }

    if (!result.structuredContent) {
      console.error('  ❌ Tool result missing structuredContent');
      errors++;
    }

    if (errors === 0) {
      console.log('  ✅ Tool invocation successful with correct metadata');
    }
  } catch (error) {
    console.error(`  ❌ Tool invocation failed: ${error}`);
    errors++;
  }

  // Test 3: Read a widget resource
  try {
    console.log('✓ Testing widget resource...');
    const result = await client.readResource({
      uri: 'ui://widget/pizza-map.html'
    });

    if (!result.contents || result.contents.length === 0) {
      console.error('  ❌ Resource missing contents');
      errors++;
    } else {
      const content = result.contents[0];

      if (content.mimeType !== 'text/html+skybridge') {
        console.error(`  ❌ Wrong MIME type: ${content.mimeType} (expected text/html+skybridge)`);
        errors++;
      }

      if (!content.text || content.text.length === 0) {
        console.error('  ❌ Resource HTML is empty');
        errors++;
      }

      if (!content._meta || !content._meta['openai/widgetAccessible']) {
        console.error('  ❌ Resource missing widget metadata');
        errors++;
      }
    }

    if (errors === 0) {
      console.log('  ✅ Widget resource has correct MIME type and metadata');
    }
  } catch (error) {
    console.error(`  ❌ Resource read failed: ${error}`);
    errors++;
  }

  // Test 4: List resources
  try {
    console.log('✓ Testing list resources...');
    const { resources } = await client.listResources();

    if (resources.length !== 5) {
      console.error(`  ❌ Expected 5 resources, got ${resources.length}`);
      errors++;
    }

    const allHaveMetadata = resources.every(r => r._meta && r.mimeType === 'text/html+skybridge');
    if (!allHaveMetadata) {
      console.error('  ❌ Some resources missing metadata or wrong MIME type');
      errors++;
    }

    if (errors === 0) {
      console.log(`  ✅ All ${resources.length} resources properly configured`);
    }
  } catch (error) {
    console.error(`  ❌ List resources failed: ${error}`);
    errors++;
  }

  await client.close();
  console.log('\n' + '='.repeat(60));

  if (errors === 0) {
    console.log('🎉 All MCP protocol tests passed!\n');
    console.log('✓ ChatGPT-compatible MCP implementation verified');
    console.log('✓ All tools have correct metadata');
    console.log('✓ Widget resources use proper MIME types');
    console.log('✓ Tool invocations return required fields\n');
    console.log('📋 Ready for ChatGPT:');
    console.log(`   ${mcpEndpoint}\n`);
    process.exit(0);
  } else {
    console.error(`❌ ${errors} test(s) failed\n`);
    console.error('Fix these issues before connecting to ChatGPT\n');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
