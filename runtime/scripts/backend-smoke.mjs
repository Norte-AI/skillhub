import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { configuredDatabaseUrl } from './db-config.mjs';

const base = process.env.SKILLHUB_SERVER_URL || 'http://127.0.0.1:4317';
const headers = process.env.SKILLHUB_TOKEN ? { Authorization: `Bearer ${process.env.SKILLHUB_TOKEN}` } : {};
const http = new Client({ name: 'skillhub-smoke', version: '1.0.0' });
const stdio = new Client({ name: 'skillhub-smoke', version: '1.0.0' });
try {
  for (const path of ['/health', '/ready']) {
    const response = await fetch(new URL(path, base), { headers });
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  }
  const response = await fetch(new URL('/api/resolve?bundle=personal', base), { headers });
  if (!response.ok) throw new Error(`Sample release unavailable (${response.status}); initialize sample data first`);
  const release = await response.json();
  await http.connect(new StreamableHTTPClientTransport(new URL('/mcp', base), { requestInit: { headers } }));
  await stdio.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../apps/mcp/src/index.mjs', import.meta.url))], env: { ...process.env, SKILLHUB_DATABASE_URL: configuredDatabaseUrl() } }));
  for (const client of [http, stdio]) {
    const result = await client.callTool({ name: 'resolve_bundle', arguments: { bundleId: 'personal' } });
    if (result.isError || JSON.parse(result.content[0].text).releaseId !== release.id) throw new Error('HTTP and STDIO release mismatch');
    const tools = await client.listTools();
    if (tools.tools.length !== 5) throw new Error('Expected five MCP tools');
  }
  console.log(JSON.stringify({ status: 'ok', server: base, releaseId: release.id, checks: ['HTTP health', 'database readiness', 'MCP Streamable HTTP', 'MCP PostgreSQL STDIO', 'fixed release consistency'] }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await Promise.allSettled([http.close(), stdio.close()]); }
