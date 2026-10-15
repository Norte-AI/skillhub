import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../apps/server/src/index.mjs';

test('API publishes locked releases and enforces configured authentication', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'skillhub-api-'));
  const { server, close } = await createServer({ dataDir, token: 'test-only' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await close(); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/bundles`)).status, 401);
  const call = async (path, data) => {
    const response = await fetch(base + path, { method: data ? 'POST' : 'GET', headers: { Authorization: 'Bearer test-only', 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  await call('/api/content', { id: 'r', kind: 'rule', title: 'Rule', body: 'original' });
  await call('/api/bundles', { id: 'b', name: 'Bundle', items: ['r'] });
  const release = await call('/api/releases', { bundleId: 'b', version: '1.0.0' });
  await call('/api/channels', { bundleId: 'b', channel: 'stable', releaseId: release.id });
  assert.deepEqual(await call('/api/marketplace'), []);
  await call('/api/marketplace/publish', { bundleId: 'b', releaseId: release.id });
  assert.equal((await call('/api/marketplace?target=codex'))[0].releaseId, release.id);
  assert.equal((await call('/api/marketplace/b')).compatibility.codex.verified, false);
  await call('/api/marketplace/unpublish', { bundleId: 'b' });
  assert.deepEqual(await call('/api/marketplace'), []);
  assert.equal((await call('/api/resolve?bundle=b')).id, release.id);
  await call('/api/content', { id: 'r', kind: 'rule', title: 'Rule', body: 'changed' });
  const artifact = await call(`/api/artifacts/${release.id}/codex`);
  assert.match(artifact.content, /original/);
  assert.doesNotMatch(artifact.content, /changed/);
  assert.equal((await fetch(`${base}/api/artifacts/${release.id}/unknown`, { headers: { Authorization: 'Bearer test-only' } })).status, 400);
});
