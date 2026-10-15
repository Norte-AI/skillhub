import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, canAccess } from '../packages/auth/index.mjs';

const request = token => ({ headers: token ? { authorization: `Bearer ${token}` } : {}, socket: { remoteAddress: '127.0.0.1' } });
const store = { authenticateDeviceToken: async token => token === 'device-token' ? { role: 'device', deviceId: 'd' } : null };
const staffTokens = { editor: 'editor-token', reviewer: 'reviewer-token', publisher: 'publisher-token' };

test('staff tokens authenticate distinct roles and retain admin/device authentication', async () => {
  const options = { adminToken: 'admin-token', staffTokens, store };
  for (const role of ['editor', 'reviewer', 'publisher', 'admin']) {
    assert.deepEqual(await authenticate(request(`${role}-token`), options), { role });
  }
  assert.deepEqual(await authenticate(request('device-token'), options), { role: 'device', deviceId: 'd' });
  assert.equal(await authenticate(request('editor-token-extra'), options), null);
  assert.equal(await authenticate({ headers: { authorization: 'Bearer editor-token extra' } }, options), null);
});

test('staff configuration prevents anonymous local administrator bypass', async () => {
  assert.equal(await authenticate(request(), { staffTokens, store, allowLocalAdmin: true }), null);
});

test('staff environment tokens are supported and explicit role tokens override them', async t => {
  const previous = process.env.SKILLHUB_EDITOR_TOKEN;
  process.env.SKILLHUB_EDITOR_TOKEN = 'env-editor';
  t.after(() => { if (previous === undefined) delete process.env.SKILLHUB_EDITOR_TOKEN; else process.env.SKILLHUB_EDITOR_TOKEN = previous; });
  assert.deepEqual(await authenticate(request('env-editor'), { store }), { role: 'editor' });
  assert.equal(await authenticate(request('env-editor'), { staffTokens: { editor: 'explicit-editor' }, store }), null);
  assert.deepEqual(await authenticate(request('explicit-editor'), { staffTokens: { editor: 'explicit-editor' }, store }), { role: 'editor' });
});

test('staff route matrix separates editing, reviewing and publication', () => {
  const roles = ['editor', 'reviewer', 'publisher'];
  for (const role of roles) {
    const identity = { role };
    for (const path of ['/api/content', '/api/bundles', '/api/releases?bundle=b', '/api/releases/b-1', '/api/submissions/s1', '/api/builds/job1', '/api/audit', '/api/marketplace/b']) {
      assert.equal(canAccess(identity, { method: 'GET', path }), true, `${role} reads ${path}`);
    }
    for (const path of ['/api/devices', '/api/devices/d/token', '/api/receipts', '/api/sessions', '/mcp', '/api/unknown']) {
      for (const method of ['GET', 'POST']) assert.equal(canAccess(identity, { method, path }), false, `${role} denied ${method} ${path}`);
    }
    assert.equal(canAccess(identity, { method: 'DELETE', path: '/api/content' }), false);
  }
  const writes = {
    editor: ['/api/submissions', '/api/content', '/api/bundles'],
    reviewer: ['/api/submissions/s1/reviews'],
    publisher: ['/api/builds', '/api/releases', '/api/channels', '/api/marketplace/publish', '/api/marketplace/unpublish', '/api/git-marketplaces/publish'],
  };
  for (const role of roles) for (const [owner, paths] of Object.entries(writes)) for (const path of paths) {
    assert.equal(canAccess({ role }, { method: 'POST', path }), role === owner, `${role} ${path}`);
  }
  assert.equal(canAccess({ role: 'reviewer' }, { method: 'POST', path: '/api/submissions/s1/reviews/extra' }), false);
  assert.equal(canAccess({ role: 'editor' }, { method: 'POST', path: '/api/content/item' }), false);
});

test('missing and unknown identities deny access; admin and devices preserve existing filters', () => {
  assert.equal(canAccess(null, { method: 'GET', path: '/api/content' }), false);
  assert.equal(canAccess({ role: 'unknown' }, { method: 'GET', path: '/api/content' }), false);
  assert.equal(canAccess({ role: 'admin' }, { method: 'POST', path: '/api/devices/d/token' }), true);
  assert.equal(canAccess({ role: 'device' }, { method: 'GET', path: '/api/releases/r' }), true);
});
