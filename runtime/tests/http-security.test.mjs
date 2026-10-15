import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../apps/server/src/index.mjs';

async function fixture(t, overrides = {}, options = {}) {
  let closed = false;
  const store = {
    init: async () => {}, close: async () => { closed = true; },
    listBundles: async () => [{ id: 'assigned' }, { id: 'private' }],
    listContent: async () => [], listListings: async () => [{ bundleId: 'assigned' }, { bundleId: 'private' }],
    getDevice: async () => ({ id: 'dev', assignments: ['assigned'] }),
    getRelease: async id => ({ id, bundleId: id.startsWith('private') ? 'private' : 'assigned' }),
    listReleases: async () => [{ id: 'assigned@1.0.0', bundleId: 'assigned' }, { id: 'private@1.0.0', bundleId: 'private' }],
    listSessionBindings: async () => [{ id: 'mine', deviceId: 'dev' }, { id: 'other', deviceId: 'second' }],
    listReceipts: async ({ deviceId }) => [{ id: 'receipt', deviceId }],
    bindSession: async input => input, reportReceipt: async input => ({ ...input, trusted: false }),
    saveContent: async input => input, listDevices: async () => [{ id: 'dev', name: 'Device', assignments: ['assigned'], tokenHash: 'hidden', tokenDigest: 'hidden-too' }],
    ...overrides
  };
  const app = await createServer({ store, authenticate: async req => req.headers.authorization === 'Bearer device' ? { role: 'device', deviceId: 'dev' } : req.headers.authorization === 'Bearer admin' ? { role: 'admin' } : null, ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = (path, { role = 'admin', method = 'GET', body, headers = {} } = {}) => fetch(base + path, { method, headers: { Authorization: `Bearer ${role}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
  return { app, call, closed: () => closed };
}

test('HTTP rejects malformed objects, MIME and oversized byte streams with accurate statuses', async t => {
  const { call } = await fixture(t, {}, { maxBodyBytes: 200 });
  for (const body of ['null', '[]', '{']) assert.equal((await call('/api/content', { method: 'POST', body })).status, 400);
  assert.equal((await call('/api/content', { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  const oversized = await call('/api/content', { method: 'POST', body: JSON.stringify({ body: '汉'.repeat(100) }) });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error, 'Request body is too large');
});

test('HTTP maps domain errors and hides unexpected exception details', async t => {
  let code = 'NOT_FOUND';
  const { call } = await fixture(t, { getRelease: async () => { throw Object.assign(new Error(code === 'INTERNAL' ? '/secret/db password=value' : 'Domain error'), { code }); } });
  assert.equal((await call('/api/releases/missing')).status, 404);
  code = 'CONFLICT'; assert.equal((await call('/api/releases/missing')).status, 409);
  code = 'VALIDATION_ERROR'; assert.equal((await call('/api/releases/missing')).status, 400);
  code = 'INTERNAL'; const response = await call('/api/releases/missing'); assert.equal(response.status, 500); assert.deepEqual(await response.json(), { error: 'Internal server error' });
});

test('devices can only read assigned bundles and write their own untrusted telemetry', async t => {
  const { call } = await fixture(t);
  assert.deepEqual(await (await call('/api/bundles', { role: 'device' })).json(), [{ id: 'assigned' }]);
  assert.equal((await call('/api/releases/private@1.0.0', { role: 'device' })).status, 403);
  assert.equal((await call('/api/content', { role: 'device' })).status, 403);
  assert.equal((await call('/api/devices', { role: 'device' })).status, 403);
  assert.equal((await call('/api/bundles', { role: 'device', method: 'POST', body: {} })).status, 403);
  const own = { id: 'r', releaseId: 'assigned@1.0.0', kind: 'installed', source: 'verified', evidence: 'client evidence' };
  const receipt = await call('/api/receipts', { role: 'device', method: 'POST', body: own });
  assert.equal(receipt.status, 201); const saved = await receipt.json(); assert.equal(saved.deviceId, 'dev'); assert.equal(saved.source, 'client-reported'); assert.equal(saved.trusted, false);
  assert.equal((await call('/api/receipts', { role: 'device', method: 'POST', body: { ...own, deviceId: 'other' } })).status, 403);
  assert.equal((await call('/api/receipts', { role: 'device', method: 'POST', body: { ...own, kind: 'verified' } })).status, 403);
  assert.equal((await call('/api/receipts', { role: 'device', method: 'POST', body: { ...own, sessionId: 'other' } })).status, 403);
  const devices = await (await call('/api/devices')).json(); assert.deepEqual(devices, [{ id: 'dev', name: 'Device', assignments: ['assigned'] }]);
});

test('list pagination preserves old arrays and readiness distinguishes storage failures', async t => {
  let ready = true;
  const { app, call, closed } = await fixture(t, { health: async () => { if (!ready) throw new Error('database unavailable'); } });
  assert.deepEqual(await (await call('/api/bundles?limit=1')).json(), { items: [{ id: 'assigned' }], nextCursor: '1' });
  assert.equal((await call('/api/bundles?limit=0')).status, 400);
  assert.equal((await call('/health', { role: 'none' })).status, 200);
  assert.equal((await call('/ready', { role: 'none' })).status, 200);
  ready = false; assert.equal((await call('/ready')).status, 503);
  await app.close(); assert.equal(closed(), true);
});

test('channel compare-and-swap generation is passed to storage and MCP shares authentication', async t => {
  let channelArgs; let mcpIdentity;
  const { call } = await fixture(t, { setChannel: async (...args) => { channelArgs = args; return { generation: 3 }; } }, { handleMcpRequest: async (req, res, { identity }) => { mcpIdentity = identity; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); } });
  assert.equal((await call('/api/channels', { method: 'POST', body: { bundleId: 'assigned', channel: 'stable', releaseId: 'assigned@1.0.0', expectedGeneration: 2 } })).status, 200);
  assert.deepEqual(channelArgs, ['assigned', 'stable', 'assigned@1.0.0', { expectedGeneration: 2 }]);
  assert.equal((await call('/mcp', { role: 'none', method: 'POST', body: {} })).status, 401);
  assert.equal((await call('/mcp', { role: 'device', method: 'POST', body: {} })).status, 200);
  assert.equal(mcpIdentity.deviceId, 'dev');
});


test('HTTP rejects untrusted Host names even when Origin matches the forged host', async t => {
  const { call } = await fixture(t);
  assert.equal((await call('/api/bundles', { headers: { Host: 'attacker.invalid', Origin: 'http://attacker.invalid' } })).status, 403);
  assert.equal((await call('/mcp', { method: 'POST', body: {}, headers: { Host: 'attacker.invalid', Origin: 'http://attacker.invalid' } })).status, 403);
});
