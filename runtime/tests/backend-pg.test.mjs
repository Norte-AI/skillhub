import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { PostgresStore } from '../packages/storage/index.mjs';
import { createServer } from '../apps/server/src/index.mjs';

const databaseUrl = process.env.SKILLHUB_TEST_DATABASE_URL;
test('PostgreSQL-backed HTTP and MCP share publication, locked sessions, receipts and revoked device access', { skip: !databaseUrl }, async t => {
  const schema = `backend_${randomBytes(6).toString('hex')}`;
  const store = new PostgresStore({ connectionString: databaseUrl, schema });
  const peer = new PostgresStore({ connectionString: databaseUrl, schema });
  const adminToken = 'local-test-admin';
  const app = await createServer({ store, token: adminToken, allowLocalAdmin: false });
  await peer.init();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let mcp;
  t.after(async () => {
    await mcp?.close();
    await app.close(); await peer.close();
    const cleanup = new Pool({ connectionString: databaseUrl });
    try { await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await cleanup.end(); }
  });
  const request = async (path, data, token = adminToken) => {
    const response = await fetch(base + path, { method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const ok = async (path, data, token) => {
    const result = await request(path, data, token);
    assert.ok(result.status < 300, `${path}: ${JSON.stringify(result)}`);
    return result.body;
  };
  await ok('/api/content', { id: 'r', kind: 'rule', title: 'Rule', body: 'fixed v1' });
  await ok('/api/bundles', { id: 'personal', name: 'Personal', items: ['r'] });
  const old = await ok('/api/releases', { bundleId: 'personal', version: '1.0.0' });
  await ok('/api/channels', { bundleId: 'personal', channel: 'stable', releaseId: old.id, expectedGeneration: 0 });
  await ok('/api/marketplace/publish', { bundleId: 'personal', releaseId: old.id });
  await ok('/api/devices', { id: 'laptop', name: 'Laptop', client: 'codex', assignments: ['personal'] });
  const credential = await ok('/api/devices/laptop/token', {});
  assert.equal((await request('/api/content', undefined, credential.token)).status, 403);
  await ok('/api/sessions', { id: 'session', releaseIds: [old.id] }, credential.token);
  mcp = new Client({ name: 'backend-test', version: '1.0.0' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${credential.token}` } } }));
  const resolved = await mcp.callTool({ name: 'resolve_bundle', arguments: { bundleId: 'personal' } });
  assert.equal(JSON.parse(resolved.content[0].text).releaseId, old.id);
  await peer.saveContent({ id: 'r', kind: 'rule', title: 'Rule', body: 'new v2' });
  const next = await peer.buildRelease('personal', '1.1.0');
  const competing = await Promise.all([
    request('/api/channels', { bundleId: 'personal', channel: 'stable', releaseId: next.id, expectedGeneration: 1 }),
    request('/api/channels', { bundleId: 'personal', channel: 'stable', releaseId: old.id, expectedGeneration: 1 }),
  ]);
  assert.deepEqual(competing.map(r => r.status).sort(), [200, 409]);
  const fixed = await mcp.callTool({ name: 'get_content', arguments: { releaseId: old.id } });
  assert.match(fixed.content[0].text, /fixed v1/); assert.doesNotMatch(fixed.content[0].text, /new v2/);
  const receipt = await mcp.callTool({ name: 'report_receipt', arguments: { id: 'fetched', sessionId: 'session', releaseId: old.id, kind: 'fetched', digest: old.digest } });
  assert.ok(!receipt.isError, JSON.stringify(receipt));
  const reports = await peer.listReceipts({ deviceId: 'laptop' });
  assert.equal(reports.length, 1); assert.equal(reports[0].trusted, false);
  assert.ok((await peer.listAudit()).some(event => event.actor?.deviceId === 'laptop'));
  assert.equal((await request('/api/receipts', { id: 'fake', releaseId: old.id, kind: 'injected' }, credential.token)).status, 403);
  await peer.revokeDeviceToken('laptop');
  assert.equal((await request('/api/bundles', undefined, credential.token)).status, 401);
  await assert.rejects(mcp.callTool({ name: 'get_bundle', arguments: { releaseId: old.id } }));
  // Simulate an idle connection lost during a database restart. The pool must
  // consume its background error and establish a replacement connection.
  const idle = await store.pool.connect();
  const processId = (await idle.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  idle.release();
  const backgroundError = new Promise(resolve => store.pool.once('error', resolve));
  const controller = new Pool({ connectionString: databaseUrl });
  try { await controller.query('SELECT pg_terminate_backend($1)', [processId]); }
  finally { await controller.end(); }
  await backgroundError;
  assert.ok(store.lastPoolErrorAt);
  assert.equal((await store.getRelease(old.id)).digest, old.digest);
  assert.equal((await request('/ready', undefined, adminToken)).status, 200);
});
