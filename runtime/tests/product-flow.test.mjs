import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../apps/server/src/index.mjs';
import { generateSigningKeyPair, verifyReleaseSignatures } from '../packages/signing/index.mjs';

test('web upload review native build and Git publication form a usable signed product flow', async t => {
  const root = await mkdtemp(join(tmpdir(), 'skillhub-product-')); t.after(() => rm(root, { recursive: true, force: true }));
  const key = generateSigningKeyPair();
  const app = await createServer({ dataDir: join(root, 'data'), gitRootDir: join(root, 'git'), signingKey: key, token: 'admin', allowLocalAdmin: false });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = async (path, body, expected = 201) => {
    const res = await fetch(base + path, { method: 'POST', headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await res.json(); assert.equal(res.status, expected, JSON.stringify(value)); return value;
  };
  const get = async path => { const res = await fetch(base + path, { headers: { Authorization: 'Bearer admin' } }); assert.equal(res.status, 200); return res.json(); };
  for (const path of ['/', '/assets/app.js', '/assets/style.css']) {
    const res = await fetch(base + path); assert.equal(res.status, 200); assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.ok((await res.text()).length > 500);
  }
  const submission = await post('/api/submissions', { contentId: 'check-release', title: '检查发布', body: '---\nname: check-release\ndescription: Check releases before publishing\n---\nRead references/checklist.md', resources: [{ path: 'references/checklist.md', body: 'Verify tests and rollback' }] });
  assert.equal(submission.status, 'pending'); assert.deepEqual(await get('/api/content'), []);
  await post(`/api/submissions/${submission.id}/reviews`, { decision: 'approve', comment: 'Reviewed content and resources' }, 200);
  await post('/api/bundles', { id: 'release-tools', name: 'Release tools', items: ['check-release'], targets: ['codex', 'kimi', 'zcode'] });
  const job = await post('/api/builds', { bundleId: 'release-tools', version: '1.0.0' }, 202);
  let result;
  for (let i = 0; i < 100; i++) {
    result = (await get('/api/builds')).find(value => value.id === job.id);
    if (['ready', 'failed'].includes(result.status)) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(result.status, 'ready', JSON.stringify(result));
  const release = await get('/api/releases/release-tools@1.0.0');
  assert.equal(verifyReleaseSignatures(release, { [key.keyId]: key.publicKey }), true);
  await post('/api/channels', { bundleId: 'release-tools', channel: 'stable', releaseId: release.id, expectedGeneration: 0 }, 200);
  await post('/api/marketplace/publish', { bundleId: 'release-tools', releaseId: release.id });
  const git = await post('/api/git-marketplaces/publish', { target: 'codex' });
  assert.equal(git.plugins[0].releaseId, release.id);
  const discovery = await fetch(base + '/git/codex.git/info/refs?service=git-upload-pack');
  assert.equal(discovery.status, 200); assert.match(discovery.headers.get('content-type'), /git-upload-pack/);
});

test('editor reviewer and publisher HTTP permissions enforce review separation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'skillhub-roles-')); t.after(() => rm(root, { recursive: true, force: true }));
  const app = await createServer({ dataDir: root, token: 'admin', staffTokens: { editor: 'edit', reviewer: 'review', publisher: 'publish' } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (path, token, body, expected) => {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
  };
  await request('/api/submissions', undefined, undefined, 401);
  const submission = await request('/api/submissions', 'edit', { contentId: 'review-demo', body: '---\nname: review-demo\ndescription: Test\n---\nTest' }, 201);
  await request(`/api/submissions/${submission.id}/reviews`, 'edit', { decision: 'approve', comment: 'self approval' }, 403);
  await request(`/api/submissions/${submission.id}/reviews`, 'publish', { decision: 'approve', comment: 'wrong role' }, 403);
  await request(`/api/submissions/${submission.id}/reviews`, 'review', { decision: 'approve', comment: 'approved by reviewer' }, 200);
  await request('/api/bundles', 'edit', { id: 'demo', name: 'Demo', items: ['review-demo'], targets: ['codex'] }, 201);
  await request('/api/releases', 'edit', { bundleId: 'demo', version: '1.0.0' }, 403);
  await request('/api/releases', 'review', { bundleId: 'demo', version: '1.0.0' }, 403);
  await request('/api/releases', 'publish', { bundleId: 'demo', version: '1.0.0' }, 201);
  await request('/api/devices', 'review', undefined, 403);
  await request('/api/content', 'edit', { id: 'skip-review', kind: 'skill', title: 'Skip', body: 'Should fail' }, 403);
  assert.equal((await request('/api/content', 'edit', undefined, 200))[0].submissionId, submission.id);
});
