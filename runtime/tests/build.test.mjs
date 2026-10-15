import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HubStore } from '../packages/core/index.mjs';
import { enqueueBuild, listBuilds, createBuildWorker } from '../packages/build/index.mjs';
import { generateSigningKeyPair, verifyReleaseSignatures } from '../packages/signing/index.mjs';
async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'skillhub-build-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = await new HubStore({ dataDir, ...options }).init();
  await store.saveContent({ id: 'rule', kind: 'rule', title: 'Rule', body: 'Do this' });
  await store.saveBundle({ id: 'bundle', name: 'Bundle', items: ['rule'], targets: ['codex'] });
  return store;
}
test('durable build queue deduplicates pending work and produces signed immutable releases', async t => {
  const key = generateSigningKeyPair(); const store = await fixture(t, { signingKey: key });
  const job = await enqueueBuild(store, { bundleId: 'bundle', version: '1.0.0' });
  await assert.rejects(enqueueBuild(store, { bundleId: 'bundle', version: '1.0.0' }), /already queued/);
  const worker = createBuildWorker(store); t.after(() => worker.close()); await worker.kick();
  const result = (await listBuilds(store)).find(value => value.id === job.id);
  assert.equal(result.status, 'ready');
  const release = await store.getRelease(result.releaseId);
  assert.equal(verifyReleaseSignatures(release, { [key.keyId]: key.publicKey }), true);
  await assert.rejects(enqueueBuild(store, { bundleId: 'bundle', version: '1.0.0' }), /already published/);
});
test('restart recovers expired jobs and reports build failures without publishing a release', async t => {
  const store = await fixture(t);
  const job = await enqueueBuild(store, { bundleId: 'bundle', version: '1.0.0' });
  await store.mutate(state => Object.assign(state.builds[job.id], { status: 'running', owner: 'old', leaseUntil: new Date(0).toISOString() }));
  const worker = createBuildWorker(store); await worker.kick(); await worker.close();
  assert.equal((await listBuilds(store))[0].status, 'ready');
  const broken = await enqueueBuild(store, { bundleId: 'bundle', version: '2.0.0' });
  await store.mutate(state => { state.bundles.bundle.items = ['missing']; });
  const failing = createBuildWorker(store); await failing.kick(); await failing.close();
  assert.equal((await listBuilds(store)).find(value => value.id === broken.id).status, 'failed');
  await assert.rejects(store.getRelease('bundle@2.0.0'), /Unknown release/);
});
test('two workers claim one queued job once', async t => {
  const store = await fixture(t);
  await enqueueBuild(store, { bundleId: 'bundle', version: '1.0.0' });
  const a = createBuildWorker(store), b = createBuildWorker(store);
  await Promise.all([a.kick(), b.kick()]); await Promise.all([a.close(), b.close()]);
  assert.equal((await store.listReleases()).length, 1);
  assert.equal((await listBuilds(store))[0].status, 'ready');
});
test('queued inputs cannot silently change and invalid native exports never become ready releases', async t => {
  const store = await fixture(t);
  await enqueueBuild(store, { bundleId: 'bundle', version: '1.0.0' });
  await store.saveContent({ id: 'rule', kind: 'rule', title: 'Rule', body: 'Changed after queue' });
  let worker = createBuildWorker(store); await worker.kick(); await worker.close();
  assert.equal((await listBuilds(store))[0].status, 'failed');
  await assert.rejects(store.getRelease('bundle@1.0.0'), /Unknown release/);
  await store.saveContent({ id: 'bad-name', kind: 'skill', title: 'Bad', body: '---\nname: other-name\ndescription: Example\n---\nDo task' });
  await store.saveBundle({ id: 'bad', name: 'Bad', items: ['bad-name'], targets: ['codex'] });
  await enqueueBuild(store, { bundleId: 'bad', version: '1.0.0' });
  worker = createBuildWorker(store); await worker.kick(); await worker.close();
  assert.equal((await listBuilds(store)).find(job => job.bundleId === 'bad').status, 'failed');
  await assert.rejects(store.getRelease('bad@1.0.0'), /Unknown release/);
});
