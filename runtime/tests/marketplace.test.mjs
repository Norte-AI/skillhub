import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HubStore } from '../packages/core/index.mjs';

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'skillhub-market-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = await new HubStore({ dataDir }).init();
  await store.saveContent({ id: 'rule', kind: 'rule', title: 'Rule', body: 'Original' });
  await store.saveBundle({ id: 'personal', name: 'Personal Tools', description: 'Team workflow', tags: ['productivity'], targets: ['codex', 'zcode'], items: ['rule'] });
  const release = await store.buildRelease('personal', '1.0.0');
  return { store, dataDir, release };
}

test('market includes only published fixed releases and searches names, descriptions, tags and targets', async t => {
  const { store, release } = await fixture(t);
  assert.deepEqual(await store.listListings(), []);
  await store.publishListing({ bundleId: 'personal', releaseId: release.id });
  for (const query of ['PERSONAL', 'workflow', 'productivity']) assert.equal((await store.listListings({ query }))[0].releaseId, release.id);
  assert.equal((await store.listListings({ query: 'productivity', target: 'codex' })).length, 1);
  assert.equal((await store.listListings({ target: 'kimi' })).length, 0);
  assert.equal((await store.listListings({ query: 'absent' })).length, 0);
  const listing = await store.getListing('personal');
  assert.equal(listing.visibility, 'private');
  assert.equal(listing.digest, release.digest);
  assert.equal(listing.compatibility.codex.adapterStatus, 'generic-package');
  assert.equal(listing.compatibility.codex.verified, false);
  assert.equal(listing.compatibility.codex.loaded, false);
  listing.name = 'Caller mutation';
  await store.saveBundle({ id: 'personal', name: 'Changed draft', tags: ['draft'], targets: ['kimi'], items: ['rule'] });
  await store.saveContent({ id: 'rule', kind: 'rule', title: 'Rule', body: 'Changed draft content' });
  assert.equal((await store.getListing('personal')).name, 'Personal Tools');
  assert.deepEqual((await store.getListing('personal')).targets, ['codex', 'zcode']);
  assert.equal((await store.listListings({ query: 'draft' })).length, 0);
});

test('listing update, unpublish and republish retain immutable history across restart', async t => {
  const { store, release, dataDir } = await fixture(t);
  await store.publishListing({ bundleId: 'personal', releaseId: release.id });
  await store.saveBundle({ id: 'personal', name: 'Personal v2', items: ['rule'] });
  const next = await store.buildRelease('personal', '1.1.0');
  await store.setChannel('personal', 'stable', release.id);
  await store.publishListing({ bundleId: 'personal', releaseId: next.id, visibility: 'public' });
  assert.equal((await store.listListings())[0].releaseId, next.id);
  assert.equal((await store.resolveRelease('personal')).id, release.id);
  const unpublished = await store.unpublishListing('personal');
  assert.equal(unpublished.status, 'unpublished');
  assert.deepEqual(await store.listListings(), []);
  assert.equal((await store.getRelease(next.id)).status, 'ready');
  assert.equal((await store.unpublishListing('personal')).generation, 3);
  const reopened = await new HubStore({ dataDir }).init();
  const historical = await reopened.getListing('personal');
  assert.deepEqual(historical.history.map(event => event.action), ['publish', 'publish', 'unpublish']);
  assert.equal(historical.history[0].name, 'Personal Tools');
  assert.equal(historical.history[0].releaseId, release.id);
  const republished = await reopened.publishListing({ bundleId: 'personal', releaseId: release.id });
  assert.equal(republished.generation, 4);
  assert.equal(republished.name, 'Personal Tools');
  assert.equal(republished.history.length, 4);
});

test('migrates old store and rejects missing, mismatched or non-ready release listing', async t => {
  const { store, dataDir, release } = await fixture(t);
  const filename = join(dataDir, 'hub.json');
  const state = JSON.parse(await readFile(filename, 'utf8'));
  delete state.listings;
  state.releases[release.id].status = 'failed';
  await writeFile(filename, JSON.stringify(state));
  const reopened = await new HubStore({ dataDir }).init();
  assert.deepEqual(await reopened.listListings(), []);
  await assert.rejects(reopened.publishListing({ bundleId: 'personal', releaseId: release.id }), /ready release/);
  await assert.rejects(store.publishListing({ bundleId: 'other', releaseId: release.id }), /ready release/);
  await assert.rejects(store.publishListing({ bundleId: 'personal', releaseId: 'stable' }), /ready release/);
  await assert.rejects(store.publishListing({ bundleId: 'personal', releaseId: '__proto__' }), /ready release/);
  await assert.rejects(store.publishListing({ bundleId: 'personal', releaseId: release.id, visibility: 'hidden' }), /visibility/);
  await assert.rejects(store.getListing('constructor'), /Invalid bundle/);
  await assert.rejects(store.getListing('missing'), /Unknown listing/);
  await assert.rejects(store.unpublishListing('missing'), /Unknown listing/);
  await assert.rejects(store.listListings({ target: 'unknown' }), /Unsupported target/);
  assert.deepEqual(await store.listListings(), []);
});
