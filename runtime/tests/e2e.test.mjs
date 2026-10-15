import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from '../apps/server/src/index.mjs';
import { run } from '../apps/cli/src/index.mjs';

async function fixture(t, token = null) {
  const directory = await mkdtemp(join(tmpdir(), 'skillhub-e2e-'));
  const home = join(directory, 'home');
  const { server, store } = await createServer({ dataDir: join(directory, 'data'), token });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const address = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, data) => {
    const response = await fetch(address + path, {
      method: data ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  await call('/api/content', { id: 'collaboration', kind: 'rule', title: 'Collaboration', body: 'confirmed scope: execute' });
  await call('/api/bundles', { id: 'personal', name: 'Personal', items: ['collaboration'] });
  const release = await call('/api/releases', { bundleId: 'personal', version: '1.0.0' });
  await call('/api/channels', { bundleId: 'personal', channel: 'stable', releaseId: release.id });
  return { home, store, address, call, release };
}

test('real API and CLI stage three targets, update and roll back immutable releases', async t => {
  const { home, address, call, release, store } = await fixture(t);
  assert.equal(release.id, 'personal@1.0.0');
  const base = ['--server', address, '--home', home];
  const quiet = () => {};
  const originalArtifacts = {};
  assert.equal((await run(['list', ...base], quiet))[0].id, 'personal');
  for (const client of ['codex', 'kimi', 'zcode']) {
    const installed = await run(['install', 'personal', '--client', client, ...base], quiet);
    assert.equal(installed.releaseId, release.id);
    assert.equal(installed.loaded, false);
    assert.equal(installed.status, 'staged');
    originalArtifacts[client] = await call(`/api/artifacts/${release.id}/${client}`);
    assert.deepEqual(JSON.parse(await readFile(join(home, 'cache', release.id, `${client}.json`), 'utf8')), originalArtifacts[client]);
  }
  const before = await run(['doctor', '--home', home], quiet);
  assert.equal(before.status, 'ok');
  assert.equal(before.clients.length, 3);
  await call('/api/content', { id: 'collaboration', kind: 'rule', title: 'Collaboration', body: 'updated: execute with concise output' });
  const next = await call('/api/releases', { bundleId: 'personal', version: '1.1.0' });
  await call('/api/channels', { bundleId: 'personal', channel: 'stable', releaseId: next.id });
  for (const client of ['codex', 'kimi', 'zcode']) {
    assert.equal((await run(['install', 'personal', '--client', client, ...base], quiet)).releaseId, 'personal@1.1.0');
    assert.deepEqual(await call(`/api/artifacts/${release.id}/${client}`), originalArtifacts[client]);
    assert.equal((await run(['rollback', '--release', release.id, '--client', client, '--home', home], quiet)).releaseId, release.id);
  }
  await call('/api/channels', { bundleId: 'personal', channel: 'stable', releaseId: release.id });
  assert.equal((await call('/api/resolve?bundle=personal')).id, release.id);
  const after = await run(['doctor', '--home', home], quiet);
  assert.equal(after.status, 'ok');
  assert.ok(after.clients.every(client => client.releaseId === release.id && client.loaded === false));
  // Public arbitrary lookup keys must never resolve inherited object properties.
  for (const id of ['__proto__', 'constructor', 'toString', 'missing']) {
    await assert.rejects(store.getRelease(id), /Unknown release/);
    await assert.rejects(store.resolveRelease('personal', id), /not found/);
  }
  await assert.rejects(store.getArtifact(release.id, '__proto__'), /not found/);
  assert.equal({}.polluted, undefined);
});

test('CLI token environment authenticates the real API without shared env mutation', async t => {
  const { home, address } = await fixture(t, 'e2e-private-token');
  const cli = fileURLToPath(new URL('../apps/cli/src/index.mjs', import.meta.url));
  const execute = token => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'list', '--server', address, '--home', home], { env: { ...process.env, SKILLHUB_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
  const authorized = await execute('e2e-private-token');
  assert.equal(authorized.code, 0);
  assert.equal(JSON.parse(authorized.stdout)[0].id, 'personal');
  const unauthorized = await execute('wrong-token');
  assert.equal(unauthorized.code, 1);
  assert.match(unauthorized.stderr, /401/);
  assert.equal((await fetch(address + '/api/bundles')).status, 401);
});
