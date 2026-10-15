import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { HubStore } from '../packages/core/index.mjs';
import { createMcpServer } from '../apps/mcp/src/index.mjs';

test('MCP advertises tools, returns fixed snapshots and release differences, reports errors', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'skillhub-mcp-'));
  const store = await new HubStore({ dataDir }).init();
  await store.saveContent({ id: 'rule', kind: 'rule', title: 'Rule', body: 'First version' });
  await store.saveBundle({ id: 'demo', name: 'Demo', items: ['rule'] });
  const first = await store.buildRelease('demo', '1.0.0');
  await store.setChannel('demo', 'stable', first.id);
  const server = createMcpServer(store);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); await rm(dataDir, { recursive: true, force: true }); });
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['get_bundle', 'get_content', 'get_release_diff', 'report_receipt', 'resolve_bundle']);
  const call = async (name, args) => client.callTool({ name, arguments: args });
  const resolved = await call('resolve_bundle', { bundleId: 'demo' });
  assert.equal(resolved.structuredContent.releaseId, first.id);
  // A separate writer models the HTTP service updating disk after MCP startup.
  const writer = await new HubStore({ dataDir }).init();
  await writer.saveContent({ id: 'rule', kind: 'rule', title: 'Rule', body: 'Second version' });
  const second = await writer.buildRelease('demo', '1.1.0');
  await writer.setChannel('demo', 'stable', second.id);
  const old = await call('get_content', { releaseId: first.id, target: 'kimi', contentId: 'rule' });
  assert.equal(old.structuredContent.items[0].body, 'First version');
  assert.equal((await call('resolve_bundle', { bundleId: 'demo' })).structuredContent.releaseId, second.id);
  assert.equal((await call('get_bundle', { releaseId: first.id })).structuredContent.version, '1.0.0');
  const difference = await call('get_release_diff', { fromReleaseId: first.id, toReleaseId: second.id });
  assert.deepEqual(difference.structuredContent.changed, [{ id: 'rule', fromRevision: 1, toRevision: 2 }]);
  assert.equal((await call('get_content', { releaseId: first.id, contentId: 'missing' })).isError, true);
  assert.equal((await call('get_bundle', { releaseId: 'missing' })).isError, true);
  assert.equal((await call('get_content', { releaseId: first.id, target: 'unknown' })).isError, true);
});

test('MCP standalone entry speaks stdio using the configured data directory', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'skillhub-mcp-stdio-'));
  const store = await new HubStore({ dataDir }).init();
  await store.saveContent({ id: 'rule', kind: 'rule', title: 'Rule', body: 'Stdio rules' });
  await store.saveBundle({ id: 'demo', name: 'Demo', items: ['rule'] });
  const release = await store.buildRelease('demo', '1.0.0');
  await store.setChannel('demo', 'stable', release.id);
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../apps/mcp/src/index.mjs', import.meta.url))], env: { SKILLHUB_DATA_DIR: dataDir }, stderr: 'pipe' });
  t.after(async () => { await client.close(); await rm(dataDir, { recursive: true, force: true }); });
  await client.connect(transport);
  const result = await client.callTool({ name: 'resolve_bundle', arguments: { bundleId: 'demo' } });
  assert.equal(result.structuredContent.releaseId, release.id);
});
