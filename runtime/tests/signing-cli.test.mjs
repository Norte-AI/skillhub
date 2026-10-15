import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { HubStore, digest } from '../packages/core/index.mjs';
import { generateSigningKeyPair } from '../packages/signing/index.mjs';
import { run, digest as contentDigest } from '../apps/cli/src/index.mjs';

async function fixture(t, signed = true) {
  const directory = await mkdtemp(join(tmpdir(), 'skillhub-signed-cli-'));
  const home = join(directory, 'home');
  const key = generateSigningKeyPair();
  const store = await new HubStore({ dataDir: join(directory, 'data'), ...(signed ? { signingKey: key } : {}) }).init();
  await store.saveContent({ id: 'rules', kind: 'rule', title: 'Rules', body: 'v1 rules' });
  await store.saveBundle({ id: 'demo', name: 'Demo', items: ['rules'], targets: ['codex'] });
  const v1 = await store.buildRelease('demo', '1.0.0');
  await store.saveContent({ id: 'rules', kind: 'rule', title: 'Rules', body: 'v2 rules' });
  const v2 = await store.buildRelease('demo', '1.1.0');
  const releases = { [v1.id]: v1, [v2.id]: v2 };
  let stable = v1.id;
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/api/resolve?')) return res.end(JSON.stringify({ releaseId: stable }));
    const match = req.url.match(/^\/api\/artifacts\/([^/]+)\/codex$/);
    const release = releases[decodeURIComponent(match?.[1] ?? '')];
    if (!release) { res.statusCode = 404; return res.end('{}'); }
    res.end(JSON.stringify(release.artifacts.codex));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let closed = false;
  const stop = async () => { if (!closed) { closed = true; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  const trustedFile = join(directory, 'trusted-keys.json');
  await writeFile(trustedFile, JSON.stringify({ [key.keyId]: key.publicKey }));
  const base = ['--home', home, '--server', `http://127.0.0.1:${server.address().port}`];
  const strict = ['--trusted-keys', trustedFile];
  return { home, key, v1, v2, trustedFile, base, strict, stop, setStable: id => { stable = id; } };
}
const quiet = () => {};

test('signed CLI install, update, offline rollback and doctor verify fixed trusted key', async t => {
  const f = await fixture(t);
  const first = await run(['install', 'demo', '--client', 'codex', ...f.base, ...f.strict], quiet);
  assert.equal(first.signatureVerified, true); assert.equal(first.loaded, false);
  f.setStable(f.v2.id);
  assert.equal((await run(['install', 'demo', '--client', 'codex', ...f.base, ...f.strict], quiet)).releaseId, f.v2.id);
  await f.stop();
  const restored = await run(['rollback', '--release', f.v1.id, '--client', 'codex', ...f.base, ...f.strict], quiet);
  assert.equal(restored.releaseId, f.v1.id); assert.equal(restored.signatureVerified, true);
  assert.equal((await run(['doctor', ...f.base, ...f.strict], quiet)).status, 'ok');
});

test('signed cache tamper with recomputed hashes fails doctor and rollback without changing active state', async t => {
  const f = await fixture(t);
  await run(['install', 'demo', '--client', 'codex', ...f.base, ...f.strict], quiet);
  f.setStable(f.v2.id);
  await run(['install', 'demo', '--client', 'codex', ...f.base, ...f.strict], quiet);
  const statePath = join(f.home, 'state', 'codex.json'); const previous = await readFile(statePath, 'utf8');
  const cachePath = join(f.home, 'cache', f.v1.id, 'codex.json');
  const changed = JSON.parse(await readFile(cachePath, 'utf8'));
  changed.content = 'attacker rules'; changed.manifest.digest = contentDigest(changed.content);
  changed.digest = digest({ manifest: changed.manifest, content: changed.content });
  await writeFile(cachePath, JSON.stringify(changed));
  await f.stop();
  const report = await run(['doctor', ...f.base, ...f.strict], quiet);
  assert.equal(report.status, 'error'); assert.ok(report.problems.some(problem => /signature/i.test(problem.error)));
  await assert.rejects(run(['rollback', '--release', f.v1.id, '--client', 'codex', ...f.base, ...f.strict], quiet), { code: 'SIGNATURE_INVALID' });
  assert.equal(await readFile(statePath, 'utf8'), previous);
});

test('trusted-key mode rejects unsigned artifacts; legacy mode still stages them', async t => {
  const f = await fixture(t, false);
  await assert.rejects(run(['install', 'demo', '--client', 'codex', ...f.base, ...f.strict], quiet), { code: 'SIGNATURE_INVALID' });
  await assert.rejects(readFile(join(f.home, 'state', 'codex.json')), { code: 'ENOENT' });
  const legacy = await run(['install', 'demo', '--client', 'codex', ...f.base], quiet);
  assert.equal(legacy.signatureVerified, false);
  assert.equal((await run(['doctor', ...f.base, ...f.strict], quiet)).status, 'error');
});

test('CLI rejects signed artifact when configured trust contains a different publisher key', async t => {
  const f = await fixture(t); const other = generateSigningKeyPair();
  await writeFile(f.trustedFile, JSON.stringify({ [f.key.keyId]: other.publicKey }));
  await assert.rejects(run(['install', 'demo', '--client', 'codex', ...f.base, ...f.strict], quiet), { code: 'SIGNATURE_INVALID' });
  await assert.rejects(readFile(join(f.home, 'state', 'codex.json')), { code: 'ENOENT' });
});
